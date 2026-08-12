import { describe, expect, it } from "vitest";
import { buildTestApp } from "./app.js";
import { createExpertBearerPrincipalResolver } from "./expert-principal-resolver.js";
import type { ExpertReferralApiDependencies } from "./routes/expert-referral.js";

const testExpertApi = (options: {
  principals?: ExpertReferralApiDependencies["principals"];
  summary?: ExpertReferralApiDependencies["referrals"]["summary"];
} = {}): ExpertReferralApiDependencies => ({
  principals: options.principals ?? {
    resolve: async () => ({
      authenticated: true,
      userId: "00000000-0000-4000-8000-000000000001",
      expertId: "00000000-0000-4000-8000-000000000002",
    }),
  },
  referrals: {
    redeemCode: async () => ({ kind: "redeemed", referralId: "referral-test" }),
    summary: options.summary ??
      (async () => ({
        availableMinor: "100000",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: "2027-08-12T00:00:00.000Z",
      })),
  },
  residency: {
    quote: async () => ({
      tariffVersionId: "00000000-0000-4000-8000-000000000101",
      priceMinor: "200000",
      creditMinor: "100000",
      cashMinor: "100000",
    }),
    checkout: async () => ({
      id: "00000000-0000-4000-8000-000000000201",
      status: "payment_pending",
    }),
    reconciliation: {
      settle: async () => ({ kind: "disabled" }),
      reverse: async () => ({ kind: "disabled" }),
      replayHeldReward: async () => ({ kind: "disabled" }),
      releaseExpiredOrders: async () => ({ kind: "disabled" }),
    },
  },
});

describe("API boundary", () => {
  it("rejects unverified webhooks before application dispatch", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "POST", url: "/v1/webhooks/selarti", payload: { event: "message" } });
    expect(response.statusCode).toBe(401);
    expect(app.services.conversation.handleInbound).not.toHaveBeenCalled();
    await app.close();
  });

  it("isolates unauthenticated Telegram traffic from protected quota", async () => {
    const app = await buildTestApp();
    const rejected = await Promise.all(Array.from({ length: 11 }, (_, updateId) => app.inject({ method: "POST", url: "/v1/webhooks/telegram", payload: { update_id: updateId } })));
    expect(rejected.every((response) => response.statusCode === 401)).toBe(true);
    const accepted = await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers: { "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__" }, payload: { update_id: 100 } });
    expect(accepted.statusCode).toBe(200);
    await app.close();
  });

  it("deduplicates update IDs and limits authenticated traffic", async () => {
    const app = await buildTestApp();
    const headers = { "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__" };
    await Promise.all([1, 1].map((update_id) => app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id } })));
    expect(app.services.telegram.processedUpdateCount("1")).toBe(1);
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) => app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: index + 10 } })));
    expect(responses.some((response) => response.statusCode === 429)).toBe(true);
    await app.close();
  });

  it("does not expose projection command routes", async () => {
    const app = await buildTestApp();
    for (const url of ["/v1/webhooks/make", "/v1/webhooks/sheets", "/v1/projections/command"]) {
      expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(404);
    }
    await app.close();
  });

  it("rejects oversized webhook bodies before provider dispatch", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "POST", url: "/v1/webhooks/selarti", headers: { "content-type": "application/json" }, payload: JSON.stringify({ text: "x".repeat(64_001) }) });
    expect(response.statusCode).toBe(413);
    expect(app.services.conversation.handleInbound).not.toHaveBeenCalled();
    await app.close();
  });

  it("does not poison Telegram deduplication before callback verification", async () => {
    const app = await buildTestApp({ callbackVerified: false });
    const headers = { "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__" };
    const rejected = await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 77, callback_query: { from: { id: 123 }, data: "invalid" } } });
    expect(rejected.statusCode).toBe(403);
    const retried = await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 77 } });
    expect(retried.statusCode).toBe(200);
    expect(app.services.telegram.processedUpdateCount("77")).toBe(1);
    await app.close();
  });

  it("rejects well-formed but unbound Telegram identities before inbox claim", async () => {
    const app = await buildTestApp({ authorizedIdentity: false });
    const headers = { "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__" };
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 88, callback_query: { from: { id: 123 }, data: "valid-shape" } } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 88 } })).statusCode).toBe(200);
    expect(app.services.telegram.processedUpdateCount("88")).toBe(1);
    await app.close();
  });

  it("releases a Telegram inbox claim when dispatch fails", async () => {
    const app = await buildTestApp({ telegramFailOnce: true });
    const headers = { "x-telegram-bot-api-secret-token": "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__" };
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 99 } })).statusCode).toBe(500);
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/telegram", headers, payload: { update_id: 99 } })).statusCode).toBe(200);
    expect(app.services.telegram.processedUpdateCount("99")).toBe(1);
    await app.close();
  });

  it("rejects stale verified Selarti events before quota and dispatch", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const app = await buildTestApp({ now: () => now, selartiEvent: { kind: "inbound_message", providerEventId: "stale", providerMessageId: "m-stale", channelUserId: "u-1", occurredAt: "2026-08-01T11:54:59.000Z", text: "hello" } });
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/selarti", payload: {} })).statusCode).toBe(401);
    expect(app.services.conversation.handleInbound).not.toHaveBeenCalled();
    await app.close();
  });

  it("lets the authoritative Selarti transaction retry after dispatch failure", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const event = { kind: "inbound_message" as const, providerEventId: "retry", providerMessageId: "m-retry", channelUserId: "u-1", occurredAt: "2026-08-01T12:00:00.000Z", text: "hello" };
    const app = await buildTestApp({ now: () => now, selartiEvent: event, selartiFailOnce: true });
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/selarti", payload: {} })).statusCode).toBe(500);
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/selarti", payload: {} })).statusCode).toBe(200);
    expect(app.services.conversation.handleInbound.mock.calls).toHaveLength(2);
    await app.close();
  });

  it("never rewrites unsupported admin verbs into mutation POSTs", async () => {
    const app = await buildTestApp();
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      expect((await app.inject({ method, url: "/v1/admin/commands/client.create/00000000-0000-4000-8000-000000000000", payload: {} })).statusCode).toBe(404);
    }
    await app.close();
  });

  it("keeps expert routes absent when no complete capability is injected", async () => {
    const app = await buildTestApp();
    expect((await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: "Bearer __PLACEHOLDER_EXPERT_SESSION__" },
    })).statusCode).toBe(404);
    await app.close();
  });

  it("registers all four expert routes only when both test capabilities are enabled", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi(),
      features: { expertReferral: true, expertResidencyBilling: true },
    });
    const headers = { authorization: "Bearer __PLACEHOLDER_EXPERT_SESSION__" };
    const cases = [
      app.inject({ method: "GET", url: "/v1/expert/referrals/summary", headers }),
      app.inject({ method: "POST", url: "/v1/expert/referrals/redeem", headers, payload: { code: `EXR_${"A".repeat(22)}`, idempotencyKey: "redeem-0001" } }),
      app.inject({ method: "POST", url: "/v1/expert/residency/quotes", headers, payload: { tariffVersionId: "00000000-0000-4000-8000-000000000101" } }),
      app.inject({ method: "POST", url: "/v1/expert/residency/checkouts", headers, payload: { tariffVersionId: "00000000-0000-4000-8000-000000000101", idempotencyKey: "checkout-0001" } }),
    ];
    expect((await Promise.all(cases)).map(({ statusCode }) => statusCode)).toEqual([200, 200, 200, 200]);
    await app.close();
  });

  it.each([
    { expertReferral: true, expertResidencyBilling: false },
    { expertReferral: false, expertResidencyBilling: true },
  ])("rejects either expert feature activation without a complete runtime capability", async (features) => {
    await expect(buildTestApp({ features })).rejects.toThrow("Expert API runtime capability is required");
  });

  it("keeps residency routes absent when only referral is enabled", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi(),
      features: { expertReferral: true, expertResidencyBilling: false },
    });
    expect((await app.inject({ method: "POST", url: "/v1/expert/residency/quotes", payload: {} })).statusCode).toBe(404);
    await app.close();
  });

  it("keeps referral routes absent when only residency billing is enabled", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi(),
      features: { expertReferral: false, expertResidencyBilling: true },
    });
    expect((await app.inject({ method: "GET", url: "/v1/expert/referrals/summary" })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects additional financial authority in the composed quote path", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi(),
      features: { expertReferral: false, expertResidencyBilling: true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/residency/quotes",
      headers: { authorization: "Bearer __PLACEHOLDER_EXPERT_SESSION__" },
      payload: {
        tariffVersionId: "00000000-0000-4000-8000-000000000101",
        priceMinor: "1",
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("preserves payload-too-large as 413 in the composed path", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi(),
      features: { expertReferral: true, expertResidencyBilling: false },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/expert/referrals/redeem",
      headers: { authorization: "Bearer __PLACEHOLDER_EXPERT_SESSION__" },
      payload: { code: `EXR_${"A".repeat(9_000)}`, idempotencyKey: "redeem-0001" },
    });
    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it("maps unexpected expert service faults to 500 instead of a command conflict", async () => {
    const app = await buildTestApp({
      expertApi: testExpertApi({ summary: async () => { throw new Error("unexpected"); } }),
      features: { expertReferral: true, expertResidencyBilling: false },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: "Bearer __PLACEHOLDER_EXPERT_SESSION__" },
    });
    expect(response.statusCode).toBe(500);
    await app.close();
  });

  it("sanitizes expert session lookup failures in the composed path", async () => {
    const token = "A".repeat(32);
    const app = await buildTestApp({
      expertApi: testExpertApi({
        principals: createExpertBearerPrincipalResolver({
          sessions: {
            findByTokenHash: async () => {
              throw new Error(`identity backend leaked ${token}`);
            },
          },
        }),
      }),
      features: { expertReferral: true, expertResidencyBilling: false },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/expert/referrals/summary",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    expect(response.body).not.toContain(token);
    await app.close();
  });
});
