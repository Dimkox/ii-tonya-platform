import { describe, expect, it, vi } from "vitest";

import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
} from "@ii-tonya/application";
import Fastify from "fastify";
import { createWindowedRateLimiter } from "../rate-limit.js";
import {
  expertReferralRoutes,
  type ExpertReferralRouteDependencies,
} from "./expert-referral.js";

const principal: ExpertPrincipal = {
  expertId: "00000000-0000-4000-8000-000000001101",
  userId: "user-1101",
  provider: "telegram",
  externalId: "1101",
};

const services = () => {
  const referrals = {
    redeemCode: vi.fn(async () => ({
      kind: "redeemed" as const,
      referralId: "private-referral-id",
    })),
    summary: vi.fn(async () => ({
      expertId: principal.expertId,
      spendableBalanceMinor: "100000",
      reservedBalanceMinor: "25000",
      debtMinor: "5000",
      nearestExpiryAt: new Date("2027-08-01T00:00:00.000Z"),
    })),
  } satisfies ExpertReferralService;
  const residency = {
    quote: vi.fn(async () => ({
      tariffVersionId: "00000000-0000-4000-8000-000000001102",
      displayName: "Expert month",
      description: "30 days",
      priceMinor: "200000",
      currency: "RUB" as const,
      durationSeconds: 2_592_000,
      creditMinor: "100000",
      cashMinor: "100000",
    })),
    checkout: vi.fn(),
  } as unknown as ExpertResidencyService;
  return { referrals, residency };
};

const buildApi = async (dependencies: ExpertReferralRouteDependencies) => {
  const app = Fastify({ logger: false });
  await app.register(expertReferralRoutes, dependencies);
  return app;
};

describe("authenticated expert referral API", () => {
  it("resolves and passes the complete current principal on every read", async () => {
    const { referrals, residency } = services();
    const resolvePrincipal = vi.fn(async () => principal);
    const app = await buildApi({
      authentication: { resolvePrincipal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: "Bearer current-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      spendableBalanceMinor: "100000",
      reservedBalanceMinor: "25000",
      debtMinor: "5000",
      nearestExpiryAt: "2027-08-01T00:00:00.000Z",
    });
    expect(resolvePrincipal).toHaveBeenCalledTimes(1);
    expect(referrals.summary).toHaveBeenCalledWith(principal);
    await app.close();
  });

  it("rejects client financial authority and never calls quote", async () => {
    const { referrals, residency } = services();
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: { authorization: "Bearer current-session" },
      payload: {
        tariffVersionId: "00000000-0000-4000-8000-000000001102",
        priceMinor: "1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(residency.quote).not.toHaveBeenCalled();
    await app.close();
  });

  it("redacts authorization, code, and body from errors", async () => {
    const { referrals, residency } = services();
    referrals.redeemCode.mockRejectedValueOnce(
      new Error("dependency exploded"),
    );
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const secret = "ER-PLAINTEXT-SECRET";
    const token = "Bearer private-session";
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/referrals/redeem",
      headers: { authorization: token },
      payload: { code: secret, idempotencyKey: "redeem-1101" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain(token);
    expect(response.json()).toEqual({ error: "expert_command_unavailable" });
    await app.close();
  });

  it("fails closed when a service returns a non-decimal summary", async () => {
    const { referrals, residency } = services();
    referrals.summary.mockResolvedValueOnce({
      expertId: principal.expertId,
      spendableBalanceMinor: "1.5",
      reservedBalanceMinor: "0",
      debtMinor: "0",
      nearestExpiryAt: new Date("2027-08-01T00:00:00.000Z"),
    });
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: "Bearer current-session" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("1.5");
    await app.close();
  });

  it("fails closed without leaking a cross-expert summary", async () => {
    const { referrals, residency } = services();
    referrals.summary.mockResolvedValueOnce({
      expertId: "00000000-0000-4000-8000-000000001199",
      spendableBalanceMinor: "987654321",
      reservedBalanceMinor: "123456789",
      debtMinor: "777",
      nearestExpiryAt: new Date("2027-08-01T00:00:00.000Z"),
    });
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: "Bearer current-session" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
    expect(response.body).not.toContain("987654321");
    expect(response.body).not.toContain("123456789");
    expect(response.body).not.toContain("00000000-0000-4000-8000-000000001199");
    await app.close();
  });

  it("hard-projects checkout without allocation or expert internals", async () => {
    const { referrals, residency } = services();
    residency.checkout = vi.fn(async () => ({
      kind: "checkout_created" as const,
      order: {
        orderId: "00000000-0000-4000-8000-000000001103",
        expertId: principal.expertId,
        tariffVersionId: "00000000-0000-4000-8000-000000001102",
        displayName: "Expert month",
        description: "30 days",
        priceMinor: "200000",
        currency: "RUB" as const,
        durationSeconds: 2_592_000,
        creditMinor: "100000",
        cashMinor: "100000",
        paymentDeadline: new Date("2026-08-03T00:15:00.000Z"),
        status: "pending",
        allocations: [{ grantId: "private-grant", amountMinor: "100000" }],
        telemetry: {
          disposition: "applied" as const,
          effects: [
            {
              operation: "bonus_share" as const,
              outcome: "applied" as const,
              errorCode: "none" as const,
            },
          ],
        },
      },
      payment: {
        kind: "pending_reconciliation" as const,
        provider: "disabled",
        paymentId: "safe-provider-neutral-id",
      },
    }));
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/residency/checkouts",
      headers: { authorization: "Bearer current-session" },
      payload: {
        tariffVersionId: "00000000-0000-4000-8000-000000001102",
        idempotencyKey: "checkout-1101",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: "checkout_created",
      orderId: "00000000-0000-4000-8000-000000001103",
      outcome: { kind: "pending_reconciliation" },
    });
    expect(response.body).not.toContain("private-grant");
    expect(response.body).not.toContain("safe-provider-neutral-id");
    expect(response.body).not.toContain("disabled");
    expect(residency.checkout).toHaveBeenCalledWith(principal, {
      tariffKey: "expert-month-v1",
      idempotencyKey: "checkout-1101",
      providerDeadline: new Date("2026-08-03T00:15:00.000Z"),
    });
    await app.close();
  });

  it("rate-limits code lookup before a third redemption reaches the service", async () => {
    const { referrals, residency } = services();
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter({ now: () => 1_000 }),
      redeemLimit: 2,
    });
    const responses = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: "/v1/expert/referrals/redeem",
          headers: { authorization: "Bearer current-session" },
          payload: {
            code: "ER-SAFE-CODE",
            idempotencyKey: `redeem-${attempt}`,
          },
        }),
      );
    }
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([
      200, 200, 429,
    ]);
    expect(referrals.redeemCode).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it.each([
    { creditMinor: "999999" },
    { paymentId: "attacker-payment" },
    { provider: "attacker-provider" },
  ])("rejects checkout authority injection %#", async (injection) => {
    const { referrals, residency } = services();
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/residency/checkouts",
      headers: { authorization: "Bearer current-session" },
      payload: {
        tariffVersionId: "00000000-0000-4000-8000-000000001102",
        idempotencyKey: "checkout-1101",
        ...injection,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(residency.checkout).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects code and idempotency values beyond their exact bounds", async () => {
    const { referrals, residency } = services();
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor: async () => "expert-month-v1" },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/expert/referrals/redeem",
        headers: { authorization: "Bearer current-session" },
        payload: { code: "x".repeat(257), idempotencyKey: "redeem-1" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/expert/referrals/redeem",
        headers: { authorization: "Bearer current-session" },
        payload: { code: "ER-SAFE-CODE", idempotencyKey: "x".repeat(129) },
      }),
    ]);
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([400, 400]);
    expect(referrals.redeemCode).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an unknown or substituted tariff without disclosing which failed", async () => {
    const { referrals, residency } = services();
    const tariffKeyFor = vi.fn(async () => null);
    const app = await buildApi({
      authentication: { resolvePrincipal: async () => principal },
      referrals,
      residency,
      tariffVersions: { tariffKeyFor },
      checkoutDeadline: () => new Date("2026-08-03T00:15:00.000Z"),
      rateLimiter: createWindowedRateLimiter(),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: { authorization: "Bearer current-session" },
      payload: {
        tariffVersionId: "00000000-0000-4000-8000-000000001199",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
    expect(residency.quote).not.toHaveBeenCalled();
    await app.close();
  });
});
