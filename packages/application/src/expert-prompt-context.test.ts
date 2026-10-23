import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildExpertPromptContext,
  EXPERT_OFFER_RUNTIME_INSTRUCTIONS,
  type ExpertPromptContext,
  validateExpertIntentProposal,
} from "./expert-prompt-context.js";
import type { ExpertPrincipal } from "./expert-referral-service.js";
import type { ExpertResidencyService } from "./expert-residency-service.js";

const principal: ExpertPrincipal = {
  authenticated: true,
  userId: "user-1",
  expertId: "expert-1",
};
const tariffVersionId = "00000000-0000-4000-8000-000000000101";
const code = `EXR_${"A".repeat(22)}`;

const reconciliation = {
  settle: vi.fn(),
  reverse: vi.fn(),
  replayHeldReward: vi.fn(),
  releaseExpiredOrders: vi.fn(),
};

const residency = (
  quote: ExpertResidencyService["quote"],
): ExpertResidencyService => ({
  listActiveTariffs: vi.fn(async () => []),
  quote,
  checkout: vi.fn(),
  reconciliation,
});

describe("expert prompt context", () => {
  it("returns only the server-derived referral summary", async () => {
    const result = await buildExpertPromptContext({
      principal,
      referrals: {
        redeemCode: vi.fn(),
        summary: vi.fn(async () => ({
          availableMinor: "100000",
          reservedMinor: "25000",
          debtMinor: "5000",
          nearestExpiry: "2027-08-03T00:00:00.000Z",
        })),
      },
      residency: residency(vi.fn()),
    });

    expect(result.kind === "ready" && result.context).toHaveProperty(
      "runtimeInstructions.version",
      "residency_offer_v2",
    );
    expect(result).toEqual({
      kind: "ready",
      context: {
        runtimeInstructions: EXPERT_OFFER_RUNTIME_INSTRUCTIONS,
        referral: {
          availableMinor: "100000",
          reservedMinor: "25000",
          debtMinor: "5000",
          nearestExpiry: "2027-08-03T00:00:00.000Z",
        },
      },
    });
  });

  it("whitelists quote fields and drops provider or ledger-shaped extras", async () => {
    const quote = {
      tariffVersionId,
      displayName: "30 days",
      priceMinor: "200000",
      currency: "RUB" as const,
      durationSeconds: 2_592_000,
      creditMinor: "100000",
      cashMinor: "100000",
      commercialPolicyVersion: "expert_residency_v2" as const,
      creditCapBps: 3000,
      individualServicesEnabled: true,
      groupEventLimit: 0,
      statisticsLevel: "basic" as const,
      supportPriority: "standard" as const,
      providerPayload: { paymentId: "secret-provider-id" },
      ledgerEntries: [{ amountMinor: "100000" }],
    };
    const result = await buildExpertPromptContext({
      principal,
      tariffVersionId,
      referrals: {
        redeemCode: vi.fn(),
        summary: vi.fn(async () => ({
          availableMinor: "100000",
          reservedMinor: "0",
          debtMinor: "0",
          nearestExpiry: null,
        })),
      },
      residency: residency(vi.fn(async () => quote)),
    });

    expect(result.kind).toBe("ready");
    const context = result.kind === "ready" ? result.context : undefined;
    expect(context).toEqual({
      runtimeInstructions: EXPERT_OFFER_RUNTIME_INSTRUCTIONS,
      referral: {
        availableMinor: "100000",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: null,
      },
      residencyQuote: {
        tariffVersionId,
        displayName: "30 days",
        priceMinor: "200000",
        currency: "RUB",
        durationSeconds: 2_592_000,
        creditMinor: "100000",
        cashMinor: "100000",
      },
    } satisfies ExpertPromptContext);
    expect(JSON.stringify(context)).not.toContain("providerPayload");
    expect(JSON.stringify(context)).not.toContain("ledgerEntries");
  });

  it("fails closed on forbidden ownership", async () => {
    const result = await buildExpertPromptContext({
      principal,
      referrals: {
        redeemCode: vi.fn(),
        summary: vi.fn(async () => ({ kind: "forbidden" as const })),
      },
      residency: residency(vi.fn()),
    });
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("rejects malformed server financial facts", async () => {
    await expect(
      buildExpertPromptContext({
        principal,
        referrals: {
          redeemCode: vi.fn(),
          summary: vi.fn(async () => ({
            availableMinor: "1.5",
            reservedMinor: "0",
            debtMinor: "0",
            nearestExpiry: null,
          })),
        },
        residency: residency(vi.fn()),
      }),
    ).rejects.toThrow("expert_prompt_context_invalid");
  });
});

describe("expert intent proposal boundary", () => {
  it.each([
    { kind: "redeem_expert_referral", code },
    { kind: "view_referral_summary" },
    { kind: "quote_residency", tariffVersionId },
    { kind: "start_residency_checkout", tariffVersionId },
  ])("accepts strict proposal %#", (proposal) => {
    expect(validateExpertIntentProposal(proposal)).toEqual({
      valid: true,
      proposal,
    });
  });

  it.each([
    "llm-05-set-referral-balance",
    "llm-06-set-referral-code",
    "llm-07-set-residency-price",
    "llm-08-fake-settlement",
    "llm-09-cross-expert-referral",
  ])("rejects %s as unsupported authority", (fixtureName) => {
    const fixture = JSON.parse(
      readFileSync(`tests/fixtures/prompts/${fixtureName}.json`, "utf8"),
    ) as { modelOutput: unknown };
    expect(validateExpertIntentProposal(fixture.modelOutput)).toEqual({
      valid: false,
      reasonCode: "unsupported_intent",
    });
  });

  it.each([
    { kind: "redeem_expert_referral", code: "bad" },
    { kind: "view_referral_summary", extra: true },
    { kind: "quote_residency", tariffVersionId: "not-a-uuid" },
    { kind: "start_residency_checkout", tariffVersionId: "not-a-uuid" },
  ])("rejects malformed supported proposal %#", (proposal) => {
    expect(validateExpertIntentProposal(proposal)).toEqual({
      valid: false,
      reasonCode: "invalid_shape",
    });
  });

  it("rejects financial authority even when attached to a supported kind", () => {
    expect(
      validateExpertIntentProposal({
        kind: "quote_residency",
        tariffVersionId,
        priceMinor: "1",
      }),
    ).toEqual({ valid: false, reasonCode: "unsupported_intent" });
  });
});

it("explains price objections using only the original server offer date in every working prompt", () => {
  const rule =
    "На вопросы «почему цена выросла» и «почему так быстро» ссылайся только на фактическое offer_start_date из серверного контекста, никогда на дату оплаты или верификации. Если сервер не передал offer_start_date, не выдумывай дату и сообщи, что дата первого предложения пока недоступна.";
  expect(EXPERT_OFFER_RUNTIME_INSTRUCTIONS.text).toContain(rule);
  for (const path of [
    "residency-offer-v2-shared.md",
    "demo_access_test_expert.md",
    "work_expert_residency_v2.md",
  ]) {
    expect(readFileSync(`docs/prompts/${path}`, "utf8")).toContain(rule);
  }
});

const personalOffer = {
  offer_start_date: "2026-10-23T00:00:00.000Z",
  current_discount_stage: 1,
  discount_percent: 40,
  locked_price_monthly: "540000",
  locked_price_package: "1500000",
  payment_link_expires_at: "2026-10-27T00:00:00.000Z",
  remaining_seconds: 86400,
  readiness: "pending_gates" as const,
  payment_url: null,
};
const promptDeps = () => ({
  principal,
  referrals: {
    redeemCode: vi.fn(),
    summary: vi.fn(async () => ({
      availableMinor: "0",
      reservedMinor: "0",
      debtMinor: "0",
      nearestExpiry: null,
    })),
  },
  residency: residency(vi.fn()),
});
it("includes owned current offer fields and masks a premature payment URL", async () => {
  const readOwned = vi.fn(async () => ({
    ...personalOffer,
    payment_url: "https://pay.yookassa.ru/early",
    providerPayload: "secret",
  }));
  const result = await buildExpertPromptContext({
    ...promptDeps(),
    personalOffers: { readOwned },
  });
  expect(readOwned).toHaveBeenCalledWith(principal.userId, principal.expertId);
  expect(result.kind === "ready" && result.context).toHaveProperty(
    "currentOffer",
    personalOffer,
  );
  expect(JSON.stringify(result)).not.toContain("providerPayload");
  expect(JSON.stringify(result)).not.toContain("/early");
});
it.each([
  { offer_start_date: "made up" },
  { current_discount_stage: 50 },
  { current_discount_stage: 1, discount_percent: 30 },
  { locked_price_monthly: "54.0" },
  { locked_price_package: "-1" },
  { payment_link_expires_at: "later" },
  { remaining_seconds: -1 },
  { readiness: "ready", payment_url: "http://pay.yookassa.ru/unsafe" },
])("rejects invalid authoritative personal offer %#", async (overrides) => {
  await expect(
    buildExpertPromptContext({
      ...promptDeps(),
      personalOffers: {
        readOwned: async () => ({ ...personalOffer, ...overrides }) as never,
      },
    }),
  ).rejects.toThrow("expert_prompt_context_invalid");
});
it("does not fetch offers for an unauthenticated or forbidden principal", async () => {
  const readOwned = vi.fn(async () => personalOffer);
  expect(
    await buildExpertPromptContext({
      ...promptDeps(),
      principal: { ...principal, authenticated: false },
      personalOffers: { readOwned },
    }),
  ).toEqual({ kind: "forbidden" });
  expect(
    await buildExpertPromptContext({
      ...promptDeps(),
      referrals: {
        redeemCode: vi.fn(),
        summary: vi.fn(async () => ({ kind: "forbidden" as const })),
      },
      personalOffers: { readOwned },
    }),
  ).toEqual({ kind: "forbidden" });
  expect(readOwned).not.toHaveBeenCalled();
});

it("uses only personal offer pricing when an owned offers backend is configured", async () => {
  const deps = promptDeps();
  const result = await buildExpertPromptContext({
    ...deps,
    tariffVersionId,
    personalOffers: { readOwned: async () => personalOffer },
  });
  expect(result.kind === "ready" && result.context).toHaveProperty(
    "currentOffer",
    personalOffer,
  );
  expect(result.kind === "ready" && result.context).not.toHaveProperty(
    "residencyQuote",
  );
  expect(deps.residency.quote).not.toHaveBeenCalled();
});
it("snapshots the principal and offer reader before asynchronous ownership checks", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = { ...principal };
  const readOwned = vi.fn(async () => personalOffer);
  const deps = {
    ...promptDeps(),
    principal: original,
    personalOffers: { readOwned },
  };
  deps.referrals.summary = vi.fn(async () => {
    await barrier;
    return {
      availableMinor: "0",
      reservedMinor: "0",
      debtMinor: "0",
      nearestExpiry: null,
    };
  });
  const pending = buildExpertPromptContext(deps);
  original.userId = "other-owner";
  original.expertId = "other-expert";
  deps.personalOffers.readOwned = vi.fn(async () => ({
    ...personalOffer,
    locked_price_monthly: "1",
  }));
  release();
  const result = await pending;
  expect(readOwned).toHaveBeenCalledWith(principal.userId, principal.expertId);
  expect(result.kind === "ready" && result.context).toHaveProperty(
    "currentOffer.locked_price_monthly",
    "540000",
  );
});
