import { describe, expect, it } from "vitest";
import {
  MemoryTestExpertTrialRepository,
  type TestExpertTrialRepository,
} from "./test-expert-trial-repository.js";

const redemption = {
  campaignVersionId: "camp-1",
  userId: "user-1",
  idempotencyKey: "redeem-1",
};
const request = (requestKey = "req-1", digest = "a".repeat(64)) => ({
  redemptionId: "red-1",
  requestKey,
  requestDigest: digest,
});

const make = async (): Promise<{
  repository: TestExpertTrialRepository;
  redemptionId: string;
}> => {
  const repository = new MemoryTestExpertTrialRepository();
  const created = await repository.createOrGetRedemption(redemption);
  return { repository, redemptionId: created.id };
};

describe("test expert trial repository", () => {
  it("creates redemption idempotently and rejects a conflicting digest", async () => {
    const repository = new MemoryTestExpertTrialRepository();
    await expect(
      repository.createOrGetRedemption(redemption),
    ).resolves.toMatchObject({
      id: expect.any(String),
      userId: "user-1",
    });
    await expect(
      repository.createOrGetRedemption(redemption),
    ).resolves.toMatchObject({
      id: expect.any(String),
    });
    await expect(
      repository.createOrGetRedemption({ ...redemption, userId: "user-2" }),
    ).rejects.toThrow("redemption_idempotency_conflict");
  });

  it("reserves exactly two units and returns the original reservation on retry", async () => {
    const { repository, redemptionId } = await make();
    const first = await repository.reserveAiTurn({
      ...request(),
      redemptionId,
    });
    const retry = await repository.reserveAiTurn({
      ...request(),
      redemptionId,
    });
    expect(first).toEqual(retry);
    await expect(repository.summary(redemptionId)).resolves.toMatchObject({
      grantedUnits: 100,
      consumedUnits: 0,
      reservedUnits: 2,
    });
  });

  it("rejects a partial turn at the 98-unit boundary", async () => {
    const { repository, redemptionId } = await make();
    for (let i = 0; i < 49; i += 1) {
      const reservation = await repository.reserveAiTurn({
        ...request(`req-${i}`),
        redemptionId,
      });
      await repository.recordOutcome({
        reservationId: reservation.reservationId,
        outcome: "applied",
      });
    }
    await expect(repository.summary(redemptionId)).resolves.toMatchObject({
      consumedUnits: 98,
      reservedUnits: 0,
    });
    const finalReservation = await repository.reserveAiTurn({
      ...request("req-final"),
      redemptionId,
    });
    await expect(repository.summary(redemptionId)).resolves.toMatchObject({
      consumedUnits: 98,
      reservedUnits: 2,
    });
    await expect(
      repository.reserveAiTurn({ ...request("req-over-cap"), redemptionId }),
    ).rejects.toThrow("trial_cap_reached");
    await repository.recordOutcome({
      reservationId: finalReservation.reservationId,
      outcome: "applied",
    });
  });

  it("applies, releases, and retains unknown outcomes exactly once", async () => {
    const { repository, redemptionId } = await make();
    const applied = await repository.reserveAiTurn({
      ...request("applied"),
      redemptionId,
    });
    await expect(
      repository.recordOutcome({
        reservationId: applied.reservationId,
        outcome: "applied",
      }),
    ).resolves.toMatchObject({ consumedUnits: 2, reservedUnits: 0 });
    await expect(
      repository.recordOutcome({
        reservationId: applied.reservationId,
        outcome: "applied",
      }),
    ).resolves.toMatchObject({ consumedUnits: 2, reservedUnits: 0 });

    const released = await repository.reserveAiTurn({
      ...request("released"),
      redemptionId,
    });
    await expect(
      repository.recordOutcome({
        reservationId: released.reservationId,
        outcome: "not_applied",
      }),
    ).resolves.toMatchObject({ consumedUnits: 2, reservedUnits: 0 });

    const unknown = await repository.reserveAiTurn({
      ...request("unknown"),
      redemptionId,
    });
    await expect(
      repository.recordOutcome({
        reservationId: unknown.reservationId,
        outcome: "unknown",
      }),
    ).resolves.toMatchObject({ consumedUnits: 2, reservedUnits: 2 });
    await expect(
      repository.recordOutcome({
        reservationId: unknown.reservationId,
        outcome: "not_applied",
      }),
    ).rejects.toThrow("unknown_outcome_requires_reconciliation");
    await expect(
      repository.reconcileUnknown({
        reservationId: unknown.reservationId,
        outcome: "not_applied",
      }),
    ).resolves.toMatchObject({ consumedUnits: 2, reservedUnits: 0 });
  });

  it("rejects a request-key conflict and conflicting terminal outcome", async () => {
    const { repository, redemptionId } = await make();
    const reservation = await repository.reserveAiTurn({
      ...request("stable"),
      redemptionId,
    });
    await expect(
      repository.reserveAiTurn({
        ...request("stable", "b".repeat(64)),
        redemptionId,
      }),
    ).rejects.toThrow("request_idempotency_conflict");
    await repository.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: "applied",
    });
    await expect(
      repository.recordOutcome({
        reservationId: reservation.reservationId,
        outcome: "not_applied",
      }),
    ).rejects.toThrow("outcome_conflict");
  });
});
