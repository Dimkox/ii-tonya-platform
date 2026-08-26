import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  authenticateClientConversationInbound,
  clientConversationPayloadDigest,
  type AuthenticatedConversationInboundCapability,
} from "./client-conversation-inbound.js";

const token = (hex: string) => `hmac-sha256:v1:${hex.repeat(64)}`;
const event = {
  kind: "client_message" as const,
  provider: "selarti" as const,
  tenantToken: token("a"),
  subjectToken: token("b"),
  providerEventId: token("c"),
  providerMessageId: token("d"),
  occurredAt: "2026-08-26T12:00:00.000Z",
  text: "Привет",
};

const lp = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
};

describe("client conversation inbound boundary", () => {
  it("passes raw bytes and ordered header occurrences to the injected capability", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      kind: "authenticated",
      event,
    });
    const capability: AuthenticatedConversationInboundCapability = {
      authenticate,
    };
    const rawBody = new Uint8Array([0, 1, 2]);
    const rawHeaders = [
      { name: "X-Signature", value: "one" },
      { name: "x-signature", value: "two" },
    ];
    const signal = new AbortController().signal;

    await expect(
      authenticateClientConversationInbound(capability, {
        rawBody,
        rawHeaders,
        signal,
      }),
    ).resolves.toEqual({ kind: "authenticated", event });
    expect(authenticate).toHaveBeenCalledWith({ rawBody, rawHeaders, signal });
  });

  it("rejects hostile result shapes and non-v1 tokens", async () => {
    for (const result of [
      null,
      { kind: "authenticated", event: { ...event, extra: true } },
      {
        kind: "authenticated",
        event: {
          ...event,
          tenantToken: event.tenantToken.replace(":v1:", ":v2:"),
        },
      },
      {
        kind: "authenticated",
        event: { ...event, userId: crypto.randomUUID() },
      },
      { kind: "authenticated", event: { ...event, channelUserId: "raw" } },
      { kind: "authenticated", event: { ...event, occurredAt: "not-a-date" } },
    ]) {
      const capability = {
        authenticate: vi.fn().mockResolvedValue(result),
      } as AuthenticatedConversationInboundCapability;
      await expect(
        authenticateClientConversationInbound(capability, {
          rawBody: new Uint8Array(),
          rawHeaders: [],
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ kind: "denied" });
    }
  });

  it("maps capability failures to unavailable without leaking their details", async () => {
    const capability = {
      authenticate: vi.fn().mockRejectedValue(new Error("credential detail")),
    } as AuthenticatedConversationInboundCapability;
    await expect(
      authenticateClientConversationInbound(capability, {
        rawBody: new Uint8Array(),
        rawHeaders: [],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("computes the exact domain-separated replay payload digest", () => {
    const expected = createHash("sha256")
      .update("ii-tonya/client-conversation-inbound-payload/v1\0", "utf8")
      .update(lp(event.tenantToken))
      .update(lp(event.subjectToken))
      .update(lp(event.providerEventId))
      .update(lp(event.providerMessageId))
      .update(lp(event.occurredAt))
      .update(lp(event.text))
      .digest("hex");

    expect(clientConversationPayloadDigest(event as never)).toBe(expected);
    expect(
      clientConversationPayloadDigest({ ...event, text: "привет" } as never),
    ).not.toBe(expected);
  });
});
