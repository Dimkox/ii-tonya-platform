import { describe, expect, it } from "vitest";
import { buildTestApp } from "./app.js";

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
});
