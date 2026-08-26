import type { ConversationService } from "@ii-tonya/application";
import { createLogger } from "@ii-tonya/observability";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedConversationInboundCapability } from "../client-conversation-inbound.js";
import { createWindowedRateLimiter } from "../rate-limit.js";
import type { RateLimitGate } from "../rate-limit.js";
import { selartiWebhookRoutes } from "./selarti-webhook.js";

const token = (hex: string) => `hmac-sha256:v1:${hex.repeat(64)}`;
const event = {
  kind: "client_message" as const,
  provider: "selarti" as const,
  tenantToken: token("a"),
  subjectToken: token("b"),
  providerEventId: token("c"),
  providerMessageId: token("d"),
  occurredAt: "2026-08-26T12:00:00.000Z",
  text: "hello",
};

const appFor = async (options: {
  inboundResult: unknown;
  identityResult?: unknown;
  conversationResult?: unknown;
  runtime?: { assertReady(): Promise<void> };
  rateLimiter?: RateLimitGate;
}) => {
  const authenticate = vi.fn().mockResolvedValue(options.inboundResult);
  const resolveIdentity = vi.fn().mockResolvedValue(
    options.identityResult ?? {
      kind: "resolved",
      identity: {
        bindingId: "10000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000002",
      },
    },
  );
  const handleInbound = vi.fn().mockResolvedValue(
    options.conversationResult ?? {
      kind: "answer_queued",
      chargedMessages: 1,
    },
  );
  const app = Fastify({ trustProxy: false });
  await app.register(selartiWebhookRoutes, {
    inbound: { authenticate } as AuthenticatedConversationInboundCapability,
    identities: { resolveIdentity } as never,
    conversation: { handleInbound } as unknown as ConversationService,
    logger: createLogger(),
    rateLimiter:
      options.rateLimiter ??
      createWindowedRateLimiter({
        now: () => Date.parse("2026-08-26T12:00:00.000Z"),
      }),
    runtime: options.runtime ?? {
      assertReady: vi.fn().mockResolvedValue(undefined),
    },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });
  return { app, authenticate, resolveIdentity, handleInbound };
};

describe("Selarti client conversation webhook", () => {
  it.each([
    [{ kind: "denied" }, 401, { error: "unauthorized" }, undefined],
    [{ kind: "unavailable" }, 503, { error: "temporarily_unavailable" }, "1"],
  ] as const)(
    "maps authentication %s to the fixed response matrix",
    async (inboundResult, status, body, retryAfter) => {
      const state = await appFor({ inboundResult });
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti",
        headers: { "content-type": "application/json" },
        payload: { message: "opaque" },
        remoteAddress: "192.0.2.10",
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual(body);
      expect(response.headers["retry-after"]).toBe(retryAfter);
      expect(state.resolveIdentity).not.toHaveBeenCalled();
      await state.app.close();
    },
  );

  it("resolves the authenticated tokens and dispatches only the internal identity", async () => {
    const state = await appFor({
      inboundResult: { kind: "authenticated", event },
    });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json", "x-proof": "one" },
      payload: { message: "opaque" },
      remoteAddress: "::ffff:192.0.2.10",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(state.resolveIdentity).toHaveBeenCalledWith({
      tenantToken: event.tenantToken,
      subjectToken: event.subjectToken,
    });
    const command = state.handleInbound.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      provider: "selarti",
      providerEventId: event.providerEventId,
      providerMessageId: event.providerMessageId,
      userId: "10000000-0000-4000-8000-000000000002",
      text: "hello",
    });
    expect(command).not.toHaveProperty("channelUserId");
    expect(command).not.toHaveProperty("tenantToken");
    expect(state.authenticate.mock.calls[0]?.[0].rawHeaders).toContainEqual({
      name: "x-proof",
      value: "one",
    });
    await state.app.close();
  });

  it("returns the fixed unavailable response when identity resolution fails", async () => {
    const state = await appFor({
      inboundResult: { kind: "authenticated", event },
      identityResult: { kind: "unavailable" },
    });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: {},
      remoteAddress: "192.0.2.10",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(response.headers["retry-after"]).toBe("1");
    expect(state.handleInbound).not.toHaveBeenCalled();
    await state.app.close();
  });

  it("rechecks runtime leases at request entry and immediately before dispatch", async () => {
    const assertReady = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("lease expired"));
    const state = await appFor({
      inboundResult: { kind: "authenticated", event },
      runtime: { assertReady },
    });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: {},
      remoteAddress: "192.0.2.10",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(assertReady).toHaveBeenCalledTimes(2);
    expect(state.handleInbound).not.toHaveBeenCalled();
    await state.app.close();
  });

  it.each(["::: ", "....", "hostname", "999.999.999.999"])(
    "rejects invalid socket source %s before authentication",
    async (remoteAddress) => {
      const state = await appFor({ inboundResult: { kind: "denied" } });
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti",
        headers: { "content-type": "application/json" },
        payload: {},
        remoteAddress,
      });
      expect(response.statusCode).toBe(400);
      expect(state.authenticate).not.toHaveBeenCalled();
      await state.app.close();
    },
  );

  it("enforces the de-framed 64,000-octet body boundary", async () => {
    const state = await appFor({ inboundResult: { kind: "denied" } });
    const body = (size: number) => JSON.stringify({ x: "x".repeat(size - 8) });
    expect(Buffer.byteLength(body(64_000))).toBe(64_000);
    expect(Buffer.byteLength(body(64_001))).toBe(64_001);
    const atLimit = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: body(64_000),
      remoteAddress: "192.0.2.10",
    });
    const overLimit = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: body(64_001),
      remoteAddress: "192.0.2.11",
    });
    expect(atLimit.statusCode).toBe(401);
    expect(overLimit.statusCode).toBe(413);
    await state.app.close();
  });

  it("consumes source, process, tenant and subject buckets in exact order", async () => {
    const keys: string[] = [];
    const state = await appFor({
      inboundResult: { kind: "authenticated", event },
      rateLimiter: {
        consume(key) {
          keys.push(key);
          return !key.startsWith("selarti:subject:");
        },
      },
    });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: {},
      remoteAddress: "::ffff:192.0.2.10",
    });
    expect(response.statusCode).toBe(429);
    expect(keys).toEqual([
      "selarti:source:192.0.2.10",
      "selarti:process",
      `selarti:tenant:${createHash("sha256").update("ii-tonya/client-conversation-rate/tenant/v1\0").update(event.tenantToken).digest("hex")}`,
      `selarti:subject:${createHash("sha256").update("ii-tonya/client-conversation-rate/subject/v1\0").update(event.subjectToken).digest("hex")}`,
    ]);
    expect(keys.join("\n")).not.toContain(event.tenantToken);
    expect(keys.join("\n")).not.toContain(event.subjectToken);
    expect(state.resolveIdentity).not.toHaveBeenCalled();
    await state.app.close();
  });

  it("normalizes lowercase and uppercase IPv4-mapped IPv6 to one source bucket", async () => {
    const keys: string[] = [];
    const state = await appFor({
      inboundResult: { kind: "denied" },
      rateLimiter: {
        consume(key) {
          keys.push(key);
          return true;
        },
      },
    });
    for (const remoteAddress of ["::ffff:192.0.2.10", "::FFFF:192.0.2.10"]) {
      await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti",
        headers: { "content-type": "application/json" },
        payload: {},
        remoteAddress,
      });
    }
    expect(keys.filter((key) => key.startsWith("selarti:source:"))).toEqual([
      "selarti:source:192.0.2.10",
      "selarti:source:192.0.2.10",
    ]);
    await state.app.close();
  });

  it.each([
    { headers: { forwarded: "for=192.0.2.1" }, expected: 400 },
    { headers: { "x-forwarded-for": "192.0.2.1" }, expected: 400 },
    { headers: { "content-encoding": "gzip" }, expected: 400 },
  ])(
    "rejects ambiguous transport headers $headers",
    async ({ headers, expected }) => {
      const state = await appFor({ inboundResult: { kind: "denied" } });
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti",
        headers: { "content-type": "application/json", ...headers },
        payload: {},
        remoteAddress: "192.0.2.10",
      });
      expect(response.statusCode).toBe(expected);
      expect(state.authenticate).not.toHaveBeenCalled();
      await state.app.close();
    },
  );

  it.each([
    ["2026-08-26T11:55:00.000Z", 202],
    ["2026-08-26T11:54:59.999Z", 401],
    ["2026-08-26T12:00:30.000Z", 202],
    ["2026-08-26T12:00:30.001Z", 401],
  ] as const)("enforces freshness for %s", async (occurredAt, expected) => {
    const state = await appFor({
      inboundResult: {
        kind: "authenticated",
        event: { ...event, occurredAt },
      },
    });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: {},
      remoteAddress: "192.0.2.10",
    });
    expect(response.statusCode).toBe(expected);
    await state.app.close();
  });

  it("rejects malformed UTF-8 before authentication", async () => {
    const state = await appFor({ inboundResult: { kind: "denied" } });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti",
      headers: { "content-type": "application/json" },
      payload: Buffer.from([0xff]),
      remoteAddress: "192.0.2.10",
    });
    expect(response.statusCode).toBe(400);
    expect(state.authenticate).not.toHaveBeenCalled();
    await state.app.close();
  });
});
import { createHash } from "node:crypto";
