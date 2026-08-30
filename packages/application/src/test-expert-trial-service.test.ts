import { describe, expect, it, vi } from "vitest";
import { segmentParticipant } from "./test-expert-segmentation.js";
import { WarmupStateMachine } from "./test-expert-warmup.js";
import { TestExpertTrialService } from "./test-expert-trial-service.js";

class TrialDouble {
  readonly reservations = new Map<
    string,
    {
      reservationId: string;
      requestKey: string;
      digest: string;
      outcome?: string;
    }
  >();
  readonly redemptions = new Set<string>();
  async createOrGetRedemption(_input: {
    campaignVersionId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const id = "redemption-1";
    this.redemptions.add(id);
    return { id };
  }
  async reserveAiTurn(input: {
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
  }) {
    const existing = [...this.reservations.values()].find(
      (row) => row.requestKey === input.requestKey,
    );
    if (existing) {
      if (existing.digest !== input.requestDigest)
        throw new Error("request_idempotency_conflict");
      return {
        reservationId: existing.reservationId,
        redemptionId: input.redemptionId,
        requestKey: input.requestKey,
        units: 2 as const,
        status: (existing.outcome ?? "reserved") as
          "reserved" | "unknown" | "applied" | "not_applied",
      };
    }
    const row = {
      reservationId: `reservation-${this.reservations.size + 1}`,
      requestKey: input.requestKey,
      digest: input.requestDigest,
    };
    this.reservations.set(row.reservationId, row);
    return {
      reservationId: row.reservationId,
      redemptionId: input.redemptionId,
      requestKey: input.requestKey,
      units: 2 as const,
      status: "reserved" as const,
    };
  }
  async recordOutcome(input: { reservationId: string; outcome: string }) {
    const row = this.reservations.get(input.reservationId)!;
    row.outcome = input.outcome;
    return {
      consumedUnits: input.outcome === "applied" ? 2 : 0,
      reservedUnits: input.outcome === "unknown" ? 2 : 0,
      grantedUnits: 100 as const,
    };
  }
  async summary(_redemptionId?: string) {
    const outcomes = [...this.reservations.values()].map((row) => row.outcome);
    return {
      grantedUnits: 100 as const,
      consumedUnits:
        outcomes.filter((outcome) => outcome === "applied").length * 2,
      reservedUnits:
        outcomes.filter(
          (outcome) => outcome === "unknown" || outcome === undefined,
        ).length * 2,
    };
  }
}

describe("test expert deterministic application boundary", () => {
  it("keeps warmup and qualification at zero trial units", () => {
    const machine = new WarmupStateMachine();
    const first = machine.next({ state: "start", answer: "Татьяна" });
    expect(first).toMatchObject({ state: "specialization", trialUnits: 0 });
    const complete = machine.next({
      state: "specialization",
      answer: "психолог",
    });
    expect(complete).toMatchObject({
      state: "complete",
      trialUnits: 0,
      qualification: { specialization: "психолог" },
    });
  });

  it("does not qualify an incomplete warmup", () => {
    expect(
      new WarmupStateMachine().next({ state: "specialization", answer: "" }),
    ).toEqual({
      state: "specialization",
      trialUnits: 0,
      error: "incomplete_qualification",
    });
  });

  it.each([
    ["expert", "EXPERT"],
    ["center", "CENTER"],
    ["studio", "CENTER"],
    ["salon", "CENTER"],
    ["retreat-center", "CENTER"],
    ["organizer", "ORGANIZER"],
    ["festival", "ORGANIZER"],
    ["retreat", "ORGANIZER"],
    ["travel", "ORGANIZER"],
  ] as const)("segments %s deterministically", (input, expected) => {
    expect(segmentParticipant(input)).toBe(expected);
  });

  it("uses only the authoritative policy quote and fails closed without it", async () => {
    const repository = new TrialDouble();
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: "campaign",
      userId: "user",
      idempotencyKey: "redemption",
    });
    const quote = vi.fn(async () => ({
      priceMinor: 5_900_00,
      currency: "RUB" as const,
      policyVersionId: "policy-1",
    }));
    const service = new TestExpertTrialService({
      trial: repository,
      expertPolicy: { quote },
      partnerPolicy: null,
      provider: vi.fn(),
    });
    await expect(
      service.handle({
        kind: "quote",
        segment: "EXPERT",
        redemptionId: redemption.id,
        input: { averageCheckMinor: 10_000 },
      }),
    ).resolves.toMatchObject({
      kind: "quote",
      priceMinor: 5_900_00,
      trialUnits: 0,
    });
    expect(quote).toHaveBeenCalledWith({ averageCheckMinor: 10_000 });
    await expect(
      new TestExpertTrialService({
        trial: repository,
        expertPolicy: null,
        partnerPolicy: null,
        provider: vi.fn(),
      }).handle({
        kind: "quote",
        segment: "EXPERT",
        redemptionId: redemption.id,
        input: {},
      }),
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "authoritative_pricing_policy_unavailable",
      trialUnits: 0,
    });
  });

  it("reserves one residual provider request, maps outcomes, and replays stably", async () => {
    const repository = new TrialDouble();
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: "campaign",
      userId: "user",
      idempotencyKey: "redemption",
    });
    const provider = vi.fn(async () => "applied" as const);
    const service = new TestExpertTrialService({
      trial: repository,
      expertPolicy: null,
      partnerPolicy: null,
      provider,
    });
    const input = {
      kind: "residual" as const,
      redemptionId: redemption.id,
      requestKey: "request-1",
      requestDigest: "a".repeat(64),
      text: "вопрос",
    };
    await expect(service.handle(input)).resolves.toMatchObject({
      kind: "provider",
      outcome: "applied",
      units: 2,
    });
    await expect(service.handle(input)).resolves.toMatchObject({
      kind: "provider",
      outcome: "applied",
      units: 2,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    await expect(
      service.handle({ ...input, requestDigest: "b".repeat(64) }),
    ).rejects.toThrow("request_idempotency_conflict");
  });

  it.each(["not_applied", "unknown"] as const)(
    "preserves %s provider outcome semantics",
    async (outcome) => {
      const repository = new TrialDouble();
      const redemption = await repository.createOrGetRedemption({
        campaignVersionId: "campaign",
        userId: "user",
        idempotencyKey: `redemption-${outcome}`,
      });
      const service = new TestExpertTrialService({
        trial: repository,
        expertPolicy: null,
        partnerPolicy: null,
        provider: vi.fn(async () => outcome),
      });
      await expect(
        service.handle({
          kind: "residual",
          redemptionId: redemption.id,
          requestKey: `request-${outcome}`,
          requestDigest: "c".repeat(64),
          text: "вопрос",
        }),
      ).resolves.toMatchObject({ kind: "provider", outcome, units: 2 });
      await expect(repository.summary(redemption.id)).resolves.toMatchObject(
        outcome === "unknown"
          ? { consumedUnits: 0, reservedUnits: 2 }
          : { consumedUnits: 0, reservedUnits: 0 },
      );
    },
  );
});
