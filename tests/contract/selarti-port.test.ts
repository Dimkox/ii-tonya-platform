import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DisabledSelartiAdapter,
  SelartiContractAdapter,
  TransportFailure,
  verifySignedWebhook,
} from "../../packages/integrations/src/index.js";

type SelartiFixture = {
  source_document: string;
  captured_at: string;
  sanitized: true;
  contract_status: string;
  body?: Record<string, unknown>;
  expandedBodyBytes?: number;
  transport?: {
    phase?: "before_write" | "after_write";
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expected: Record<string, unknown>;
};

const fixtureNames = [
  "inbound-success",
  "inbound-duplicate",
  "invalid-schema",
  "outbound-send-success",
  "malformed-success-response",
  "rate-limit",
  "timeout-before-send",
  "timeout-after-send",
  "oversized-body",
  "delivery-contract-unconfirmed",
] as const;

const fixture = (name: (typeof fixtureNames)[number]): SelartiFixture =>
  JSON.parse(
    readFileSync(`tests/fixtures/selarti/${name}.json`, "utf8"),
  ) as SelartiFixture;

const rawBody = (value: SelartiFixture): Uint8Array =>
  value.expandedBodyBytes === undefined
    ? Buffer.from(JSON.stringify(value.body))
    : Buffer.alloc(value.expandedBodyBytes, "x");

const fixtureTransport = (value: SelartiFixture) => ({
  request: vi.fn(
    async (_command: {
      idempotencyKey: string;
      channelUserId: string;
      text: string;
    }) => {
      void _command;
      if (value.transport?.phase) {
        throw new TransportFailure(value.transport.phase);
      }
      return {
        status: value.transport?.status ?? 200,
        headers: value.transport?.headers ?? {},
        body: value.transport?.body ?? {},
      };
    },
  ),
});

const signedWebhookFixture = () => {
  const body = Buffer.from('{"event":"message"}');
  const timestamp = "1785232800";
  const secret = "__PLACEHOLDER_CONTRACT_TEST_SECRET__";
  return {
    body,
    contentType: "application/json",
    signature: createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex"),
    timestamp,
    secret,
    nowEpochSeconds: 1785232800,
    maxAgeSeconds: 300,
    maxBodyBytes: 64_000,
  };
};

describe("Selarti boundary", () => {
  it("keeps every fixture sanitized and traceable to a contract status", () => {
    for (const name of fixtureNames) {
      expect(fixture(name)).toMatchObject({
        source_document: expect.stringMatching(/^https:\/\//),
        captured_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        sanitized: true,
        contract_status: expect.any(String),
      });
    }
  });

  it("accepts only fresh, bounded, exactly JSON HMAC input", () => {
    expect(verifySignedWebhook(signedWebhookFixture())).toEqual({
      accepted: true,
    });

    const cases = [
      [{ signature: "" }, "missing_header"],
      [{ timestamp: "" }, "missing_header"],
      [{ contentType: "application/json; charset=utf-8" }, "content_type"],
      [{ body: Buffer.alloc(64_001) }, "body_size"],
      [{ timestamp: "1785232800.5" }, "timestamp"],
      [{ timestamp: "1785232000" }, "timestamp"],
      [{ signature: "forged" }, "signature"],
    ] as const;

    for (const [override, reason] of cases) {
      expect(
        verifySignedWebhook({ ...signedWebhookFixture(), ...override }),
      ).toEqual({
        accepted: false,
        reason,
      });
    }
  });

  it("cannot decode or send while the official provider contract is unapproved", async () => {
    const adapter = new DisabledSelartiAdapter();
    await expect(
      adapter.decodeVerifiedWebhook(new Uint8Array(), {}),
    ).rejects.toThrow("Selarti integration is disabled");
    await expect(
      adapter.sendMessage({
        idempotencyKey: "send-1",
        channelUserId: "u-1",
        text: "hello",
      }),
    ).rejects.toThrow("Selarti integration is disabled");
  });

  it("executes success, duplicate, invalid, oversized, and delivery fixtures through the codec", async () => {
    const mutations = vi.fn();
    const seen = new Set<string>();
    const adapter = new SelartiContractAdapter({
      transport: fixtureTransport(fixture("inbound-success")),
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });
    const ingest = async (value: SelartiFixture) => {
      const event = await adapter.decodeVerifiedWebhook(rawBody(value), {
        "content-type": "application/json",
      });
      if (seen.has(event.providerEventId)) return "duplicate";
      seen.add(event.providerEventId);
      mutations(event);
      return "applied";
    };

    await expect(ingest(fixture("inbound-success"))).resolves.toBe("applied");
    await expect(ingest(fixture("inbound-duplicate"))).resolves.toBe(
      "duplicate",
    );
    await expect(ingest(fixture("invalid-schema"))).rejects.toThrow(
      "invalid_schema",
    );
    await expect(ingest(fixture("oversized-body"))).rejects.toThrow(
      "body_size",
    );
    await expect(
      ingest(fixture("delivery-contract-unconfirmed")),
    ).rejects.toThrow("outbound_delivery_contract_unconfirmed");
    expect(mutations).toHaveBeenCalledTimes(1);
    expect(mutations).toHaveBeenCalledWith(fixture("inbound-success").expected);
  });

  it("authenticates before parsing a webhook payload", async () => {
    const authenticate = vi.fn(() => ({
      accepted: false,
      reason: "signature" as const,
    }));
    const adapter = new SelartiContractAdapter({
      transport: fixtureTransport(fixture("inbound-success")),
      authenticate,
      maxBodyBytes: 64_000,
    });

    await expect(
      adapter.decodeVerifiedWebhook(Buffer.from("{not-json"), {
        "content-type": "application/json",
      }),
    ).rejects.toThrow("webhook_auth_signature");
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "outbound-send-success",
      { kind: "applied", providerOperationId: "selarti-operation-fixture-1" },
    ],
    [
      "malformed-success-response",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "malformed_success_response",
      },
    ],
    [
      "rate-limit",
      {
        kind: "not_applied",
        retryable: true,
        reasonCode: "rate_limited",
        retryAfterMs: 3_000,
      },
    ],
    [
      "timeout-before-send",
      {
        kind: "not_applied",
        retryable: true,
        reasonCode: "timeout_before_write",
      },
    ],
    [
      "timeout-after-send",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "timeout_after_write",
      },
    ],
  ] as const)(
    "normalizes the sanitized Selarti transport fixture %s",
    async (name, expected) => {
      const value = fixture(name);
      const transport = fixtureTransport(value);
      const adapter = new SelartiContractAdapter({
        transport,
        authenticate: () => ({ accepted: true }),
        maxBodyBytes: 64_000,
      });
      const command = {
        idempotencyKey: "selarti-send-fixture-1",
        channelUserId: "channel-1",
        text: "fixture",
      };

      await expect(adapter.sendMessage(command)).resolves.toEqual(expected);
      expect(transport.request).toHaveBeenCalledTimes(1);
      expect(transport.request.mock.calls[0]![0]).toMatchObject({
        idempotencyKey: "selarti-send-fixture-1",
      });
    },
  );

  it("bounds a numeric Retry-After without accepting date or malformed values", async () => {
    const adapter = new SelartiContractAdapter({
      transport: {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            status: 429,
            headers: { "retry-after": "999" },
            body: {},
          })
          .mockResolvedValueOnce({
            status: 429,
            headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
            body: {},
          }),
      },
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });
    const command = {
      idempotencyKey: "retry-boundary",
      channelUserId: "channel-1",
      text: "fixture",
    };

    await expect(adapter.sendMessage(command)).resolves.toMatchObject({
      retryAfterMs: 60_000,
    });
    await expect(adapter.sendMessage(command)).resolves.toEqual({
      kind: "not_applied",
      retryable: true,
      reasonCode: "rate_limited",
    });
  });
});
