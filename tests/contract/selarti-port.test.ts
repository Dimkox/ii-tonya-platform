import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createSignedWebhookVerifier,
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
  "outbound-accepted-ambiguous",
  "outbound-service-unavailable",
  "outbound-send-wrong-content-type",
  "outbound-send-extra-field",
  "oversized-body",
  "invalid-utf8",
  "identity-collision-a",
  "identity-collision-b",
  "message-type-agent",
  "message-type-system",
  "message-type-outbound",
  "message-type-status",
  "message-type-delivery",
  "message-type-unknown",
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

const signedWebhookWithBody = (body: Uint8Array, maxBodyBytes: number) => {
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
    maxBodyBytes,
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
      [{ signature: "a".repeat(1_000_000) }, "signature"],
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

  it.each(["", " ", "\t\r\n"])(
    "rejects an empty webhook HMAC secret when constructing the verifier",
    (secret) => {
      expect(() =>
        createSignedWebhookVerifier({
          secret,
          nowEpochSeconds: () => 1785232800,
          maxAgeSeconds: 300,
          maxBodyBytes: 64_000,
        }),
      ).toThrow("invalid_webhook_secret_configuration");
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, 64_001])(
    "fails closed for standalone verifier maxBodyBytes configuration %s",
    (maxBodyBytes) => {
      expect(
        verifySignedWebhook(
          signedWebhookWithBody(Buffer.alloc(100_000, "x"), maxBodyBytes),
        ),
      ).toEqual({ accepted: false, reason: "body_size" });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, 64_001])(
    "rejects unsafe maxBodyBytes when constructing the standalone verifier: %s",
    (maxBodyBytes) => {
      expect(() =>
        createSignedWebhookVerifier({
          secret: "__PLACEHOLDER_CONTRACT_TEST_SECRET__",
          nowEpochSeconds: () => 1785232800,
          maxAgeSeconds: 300,
          maxBodyBytes,
        }),
      ).toThrow("invalid_max_body_bytes");
    },
  );

  it("accepts the exact 64,000-byte boundary in direct and constructed verification", () => {
    const input = signedWebhookWithBody(Buffer.alloc(64_000, "x"), 64_000);
    expect(verifySignedWebhook(input)).toEqual({ accepted: true });

    const verifier = createSignedWebhookVerifier({
      secret: input.secret,
      nowEpochSeconds: () => input.nowEpochSeconds,
      maxAgeSeconds: input.maxAgeSeconds,
      maxBodyBytes: input.maxBodyBytes,
    });
    expect(
      verifier({
        body: input.body,
        contentType: input.contentType,
        signature: input.signature,
        timestamp: input.timestamp,
      }),
    ).toEqual({ accepted: true });
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

  it.each([
    "missing_header",
    "content_type",
    "body_size",
    "timestamp",
    "signature",
  ] as const)(
    "exposes one generic boundary error for internal webhook auth rejection %s",
    async (reason) => {
      const authenticate = vi.fn(() => ({
        accepted: false as const,
        reason,
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
      ).rejects.toThrow("webhook_auth_rejected");
      expect(authenticate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, 64_001])(
    "rejects an unsafe maxBodyBytes configuration: %s",
    (maxBodyBytes) => {
      expect(
        () =>
          new SelartiContractAdapter({
            transport: fixtureTransport(fixture("inbound-success")),
            authenticate: () => ({ accepted: true }),
            maxBodyBytes,
          }),
      ).toThrow("invalid_max_body_bytes");
    },
  );

  it("rejects malformed UTF-8 before JSON/schema normalization", async () => {
    const value = fixture("invalid-utf8");
    const body = Buffer.from(JSON.stringify(value.body));
    const textOffset = body.indexOf("sanitized fixture message");
    expect(textOffset).toBeGreaterThanOrEqual(0);
    body[textOffset] = 0xff;
    const adapter = new SelartiContractAdapter({
      transport: fixtureTransport(value),
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });

    await expect(
      adapter.decodeVerifiedWebhook(body, {
        "content-type": "application/json",
      }),
    ).rejects.toThrow("invalid_schema");
  });

  it("uses collision-resistant structured identity for provider events", async () => {
    const adapter = new SelartiContractAdapter({
      transport: fixtureTransport(fixture("inbound-success")),
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });
    const first = await adapter.decodeVerifiedWebhook(
      rawBody(fixture("identity-collision-a")),
      { "content-type": "application/json" },
    );
    const second = await adapter.decodeVerifiedWebhook(
      rawBody(fixture("identity-collision-b")),
      { "content-type": "application/json" },
    );

    expect(first.providerEventId).not.toBe(second.providerEventId);
    expect(first.providerEventId).toMatch(/^selarti:[a-f0-9]{64}$/);
    expect(second.providerEventId).toMatch(/^selarti:[a-f0-9]{64}$/);
  });

  it.each([
    "message-type-agent",
    "message-type-system",
    "message-type-outbound",
    "message-type-status",
    "message-type-delivery",
    "message-type-unknown",
  ] as const)(
    "rejects unsupported message direction fixture %s without mutation",
    async (name) => {
      const mutations = vi.fn();
      const adapter = new SelartiContractAdapter({
        transport: fixtureTransport(fixture(name)),
        authenticate: () => ({ accepted: true }),
        maxBodyBytes: 64_000,
      });

      await expect(
        adapter.decodeVerifiedWebhook(rawBody(fixture(name)), {
          "content-type": "application/json",
        }),
      ).rejects.toThrow("invalid_schema");
      expect(mutations).not.toHaveBeenCalled();
    },
  );

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
    [
      "outbound-accepted-ambiguous",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "http_202",
      },
    ],
    [
      "outbound-service-unavailable",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "http_503",
      },
    ],
    [
      "outbound-send-wrong-content-type",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "malformed_success_response",
      },
    ],
    [
      "outbound-send-extra-field",
      {
        kind: "unknown_outcome",
        reconciliationKey: "selarti-send-fixture-1",
        reasonCode: "malformed_success_response",
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
        rateLimitResponsePolicy: "confirmed_not_applied",
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
            headers: { "Retry-After": "999" },
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
      rateLimitResponsePolicy: "confirmed_not_applied",
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

  it("does not treat rate limiting as not-applied without an explicit policy", async () => {
    const adapter = new SelartiContractAdapter({
      transport: {
        request: vi.fn(async () => ({
          status: 429,
          headers: { "Retry-After": "3" },
          body: {},
        })),
      },
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });

    await expect(
      adapter.sendMessage({
        idempotencyKey: "rate-limit-unconfirmed",
        channelUserId: "channel-1",
        text: "fixture",
      }),
    ).resolves.toEqual({
      kind: "unknown_outcome",
      reconciliationKey: "rate-limit-unconfirmed",
      reasonCode: "http_429",
    });
  });

  it("normalizes an unclassified transport exception to unknown outcome", async () => {
    const adapter = new SelartiContractAdapter({
      transport: {
        request: vi.fn(async () => {
          throw new Error("socket failure details must not escape");
        }),
      },
      authenticate: () => ({ accepted: true }),
      maxBodyBytes: 64_000,
    });

    await expect(
      adapter.sendMessage({
        idempotencyKey: "unclassified-transport",
        channelUserId: "channel-1",
        text: "fixture",
      }),
    ).resolves.toEqual({
      kind: "unknown_outcome",
      reconciliationKey: "unclassified-transport",
      reasonCode: "transport_failure_unknown_phase",
    });
  });
});
