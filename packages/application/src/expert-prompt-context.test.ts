import { describe, expect, it, vi } from "vitest";

import type { ExpertPrincipal } from "./expert-referral-service.js";
import { createExpertPromptContext } from "./expert-prompt-context.js";

const principal: ExpertPrincipal = {
  expertId: "00000000-0000-4000-8000-000000001001",
  userId: "user-1001",
  provider: "telegram",
  externalId: "1001",
};

describe("expert prompt context", () => {
  it("projects only self-scoped server-derived decimal values", async () => {
    const summary = vi.fn(async () => ({
      expertId: principal.expertId,
      spendableBalanceMinor: "100000",
      reservedBalanceMinor: "25000",
      debtMinor: "5000",
      nearestExpiryAt: new Date("2027-08-01T00:00:00.000Z"),
    }));
    const quote = vi.fn(async () => ({
      tariffVersionId: "00000000-0000-4000-8000-000000001002",
      displayName: "Expert month",
      description: "30 days",
      priceMinor: "200000",
      currency: "RUB" as const,
      durationSeconds: 2_592_000,
      creditMinor: "100000",
      cashMinor: "100000",
    }));
    const context = createExpertPromptContext({
      referrals: { summary, redeemCode: vi.fn() },
      residency: { quote } as never,
      tariffVersions: {
        async tariffKeyFor(versionId) {
          expect(versionId).toBe("00000000-0000-4000-8000-000000001002");
          return "expert-month-v1";
        },
      },
    });

    await expect(
      context.read(principal, {
        tariffVersionId: "00000000-0000-4000-8000-000000001002",
      }),
    ).resolves.toEqual({
      referralSummary: {
        spendableBalanceMinor: "100000",
        reservedBalanceMinor: "25000",
        debtMinor: "5000",
        nearestExpiryAt: "2027-08-01T00:00:00.000Z",
      },
      residencyQuote: {
        tariffVersionId: "00000000-0000-4000-8000-000000001002",
        displayName: "Expert month",
        description: "30 days",
        priceMinor: "200000",
        currency: "RUB",
        durationSeconds: 2_592_000,
        creditMinor: "100000",
        cashMinor: "100000",
      },
    });
    expect(summary).toHaveBeenCalledWith(principal);
    expect(quote).toHaveBeenCalledWith(principal, "expert-month-v1");
  });

  it("fails closed for unknown server identifiers without reading a quote", async () => {
    const quote = vi.fn();
    const context = createExpertPromptContext({
      referrals: {
        summary: vi.fn(async () => ({ kind: "forbidden" as const })),
        redeemCode: vi.fn(),
      },
      residency: { quote } as never,
      tariffVersions: { tariffKeyFor: async () => null },
    });

    await expect(
      context.read(principal, { tariffVersionId: "unknown-version" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(quote).not.toHaveBeenCalled();
  });

  it("fails closed instead of exposing a malformed monetary projection", async () => {
    const context = createExpertPromptContext({
      referrals: {
        summary: vi.fn(async () => ({
          expertId: principal.expertId,
          spendableBalanceMinor: "1.5",
          reservedBalanceMinor: "0",
          debtMinor: "0",
          nearestExpiryAt: null,
        })),
        redeemCode: vi.fn(),
      },
      residency: {
        quote: vi.fn(async () => ({
          tariffVersionId: "00000000-0000-4000-8000-000000001002",
          displayName: "Expert month",
          description: "30 days",
          priceMinor: "200000",
          currency: "RUB",
          durationSeconds: 2_592_000,
          creditMinor: "100000",
          cashMinor: "100000",
        })),
      } as never,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
    });
    await expect(
      context.read(principal, {
        tariffVersionId: "00000000-0000-4000-8000-000000001002",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects an unbounded tariff identifier before any dependency read", async () => {
    const tariffKeyFor = vi.fn(async () => "attacker-selected-key");
    const summary = vi.fn();
    const quote = vi.fn();
    const context = createExpertPromptContext({
      referrals: { summary, redeemCode: vi.fn() },
      residency: { quote } as never,
      tariffVersions: { tariffKeyFor },
    });
    await expect(
      context.read(principal, { tariffVersionId: "x".repeat(129) }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(tariffKeyFor).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
  });
});
