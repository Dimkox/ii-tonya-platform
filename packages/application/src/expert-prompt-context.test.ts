import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildExpertPromptContext,
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

    expect(result).toEqual({
      kind: "ready",
      context: {
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
