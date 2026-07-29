import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramMethodUrl,
  CallbackInfrastructureError,
  issueCallback,
  redactTelegramUrl,
  TelegramAdapter,
  TransportFailure,
  verifyCallback,
  type ExpertCallbackClaims,
  type TelegramTransportRequest,
} from "../../packages/integrations/src/index.js";

type TelegramFixture = {
  sanitized: true;
  update?: Record<string, unknown>;
  expandedBodyBytes?: number;
  now?: string;
  expertActive?: boolean;
  transport?: {
    phase?: "before_write" | "after_write";
    status?: number;
    body?: unknown;
  };
};

const telegramFixture = (name: string): TelegramFixture =>
  JSON.parse(
    readFileSync(`tests/fixtures/telegram/${name}.json`, "utf8"),
  ) as TelegramFixture;

const telegramTransport = (value: TelegramFixture) => ({
  request: vi.fn(async (request: TelegramTransportRequest) => {
    void request;
    if (value.transport?.phase) {
      throw new TransportFailure(value.transport.phase);
    }
    return {
      status: value.transport?.status ?? 200,
      body: value.transport?.body ?? {},
    };
  }),
});

const memoryCallbackStore = () => {
  const values = new Map<string, ExpertCallbackClaims>();
  return {
    async put(key: string, value: ExpertCallbackClaims) {
      values.set(key, value);
    },
    async peek(key: string) {
      return values.get(key) ?? null;
    },
    async consumeIfValid(input: {
      tokenHash: string;
      expertId: string;
      action: "confirm" | "cancel";
      version: number;
      now: Date;
    }) {
      const value = values.get(input.tokenHash) ?? null;
      if (
        value === null ||
        value.expertId !== input.expertId ||
        value.action !== input.action ||
        value.version !== input.version ||
        value.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
      ) {
        return null;
      }
      values.delete(input.tokenHash);
      return value;
    },
  };
};

describe("Telegram expert callback", () => {
  const secret = new TextEncoder().encode("__PLACEHOLDER_CALLBACK_HMAC_KEY__");
  const claims = {
    reservationId: "019fa875-2d67-78f1-8c71-f4936268da29",
    expertId: "expert-1",
    action: "confirm" as const,
    version: 3,
    expiresAtEpochSeconds: 1785233100,
  };

  it("binds a compact opaque callback to numeric Telegram identity, expert, version, and expiry", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    expect(token).toMatch(/^ct2\./u);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(64);
    expect(token).not.toContain(claims.reservationId);
    expect(token).not.toContain(claims.expertId);
    expect(token).not.toContain("__PLACEHOLDER_TELEGRAM_BOT_TOKEN__");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toEqual(claims);
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
  });

  it("validates binding before consume so a wrong expert cannot burn the token", async () => {
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    await expect(
      verifyCallback(
        token,
        "987654321",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toEqual(claims);
  });

  it("rejects tampering, expiry, and a deactivated expert without consuming a valid token", async () => {
    const expiredFixture = telegramFixture("callback-expired");
    const deactivatedFixture = telegramFixture("expert-deactivated");
    const store = memoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    await expect(
      verifyCallback(
        `${token}x`,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: deactivatedFixture.expertActive!,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toEqual(claims);

    const expiredToken = await issueCallback(claims, secret, store);
    await expect(
      verifyCallback(
        expiredToken,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date(expiredFixture.now!),
      ),
    ).rejects.toThrow("Callback verification failed");
    await expect(
      verifyCallback(
        expiredToken,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toEqual(claims);
  });

  it("rejects weak callback secrets before issuing or accepting a token", async () => {
    const store = memoryCallbackStore();
    const weakSecret = new TextEncoder().encode("too-short");
    await expect(issueCallback(claims, weakSecret, store)).rejects.toThrow(
      "Callback secret must be at least 32 bytes",
    );

    const token = await issueCallback(claims, secret, store);
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        weakSecret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
  });

  it("domain-separates the MAC over exact callback prefix, version, and nonce", async () => {
    const store = memoryCallbackStore();
    const nonce = Buffer.alloc(16, 7);
    const legacyTag = createHmac("sha256", secret)
      .update(nonce)
      .digest()
      .subarray(0, 16);
    const token = `ct1.${Buffer.concat([
      Buffer.from([1]),
      nonce,
      legacyTag,
    ]).toString("base64url")}`;
    await store.put(createHash("sha256").update(nonce).digest("hex"), claims);

    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback verification failed");
  });

  it("rejects every pre-hardening ct1 token with the generic external error", async () => {
    const store = memoryCallbackStore();
    const nonce = Buffer.alloc(16, 9);
    const token = `ct1.${Buffer.concat([
      Buffer.from([1]),
      nonce,
      Buffer.alloc(16, 3),
    ]).toString("base64url")}`;
    await store.put(createHash("sha256").update(nonce).digest("hex"), claims);
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      name: "CallbackVerificationError",
      message: "Callback verification failed",
    });
  });

  it("propagates a typed retryable callback store outage", async () => {
    const backing = memoryCallbackStore();
    const token = await issueCallback(claims, secret, backing);
    const outage = new CallbackInfrastructureError(
      "callback_store_unavailable",
    );
    const store = {
      ...backing,
      async peek() {
        throw outage;
      },
    };

    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toBe(outage);
    expect(outage).toMatchObject({
      name: "CallbackInfrastructureError",
      retryable: true,
      code: "callback_store_unavailable",
    });
  });

  it("returns one non-enumerable error for all external callback failures", async () => {
    const cases = [
      {
        expectedTelegramUserId: "123456789",
        binding: {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: false,
          verified: true,
        },
        now: new Date("2026-07-28T10:00:00.000Z"),
      },
      {
        expectedTelegramUserId: "123456789",
        binding: {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: false,
        },
        now: new Date("2026-07-28T10:00:00.000Z"),
      },
      {
        expectedTelegramUserId: "123456789",
        binding: {
          telegramUserId: "987654321",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        now: new Date("2026-07-28T10:00:00.000Z"),
      },
      {
        expectedTelegramUserId: "123456789",
        binding: {
          telegramUserId: "123456789",
          expertId: "expert-2",
          active: true,
          verified: true,
        },
        now: new Date("2026-07-28T10:00:00.000Z"),
      },
      {
        expectedTelegramUserId: "123456789",
        binding: {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
          verified: true,
        },
        now: new Date("2026-07-28T10:05:00.000Z"),
      },
    ] as const;

    for (const value of cases) {
      const store = memoryCallbackStore();
      const token = await issueCallback(claims, secret, store);
      await expect(
        verifyCallback(
          token,
          value.expectedTelegramUserId,
          value.binding,
          secret,
          store,
          value.now,
        ),
      ).rejects.toMatchObject({
        name: "CallbackVerificationError",
        message: "Callback verification failed",
      });
    }
  });

  it("uses the official token-bearing method path but redacts it from logs and errors", () => {
    const token = "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__";
    const url = buildTelegramMethodUrl(
      new URL("https://api.telegram.org"),
      token,
      "sendMessage",
    );
    expect(url.pathname).toBe(`/bot${token}/sendMessage`);
    expect(redactTelegramUrl(url)).toBe(
      "https://api.telegram.org/bot[REDACTED]/sendMessage",
    );
    expect(redactTelegramUrl(url)).not.toContain(token);
  });

  it("fails closed while redacting unexpected Telegram URL shapes", () => {
    const token = "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__";
    const urls = [
      new URL(
        `https://api.telegram.org/bot${token}/sendMessage/extra?token=${token}`,
      ),
      new URL(
        `https://api.telegram.org/bot${encodeURIComponent(`${token}/sendMessage`)}`,
      ),
      new URL(`https://api.telegram.org/unexpected/${token}`),
    ];
    for (const url of urls) {
      const redacted = redactTelegramUrl(url);
      expect(redacted).not.toContain(token);
      expect(redacted).not.toContain(encodeURIComponent(token));
      expect(redacted).not.toContain("token=");
      expect(redacted).toContain("[REDACTED]");
    }
  });

  it.each([
    ["send-success", { kind: "applied", providerOperationId: "42" }],
    [
      "rate-limit-429",
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
        reconciliationKey: "telegram-notification-1",
        reasonCode: "timeout_after_write",
      },
    ],
    [
      "invalid-schema",
      {
        kind: "unknown_outcome",
        reconciliationKey: "telegram-notification-1",
        reasonCode: "invalid_success_schema",
      },
    ],
    [
      "recipient-rejected",
      {
        kind: "not_applied",
        retryable: false,
        reasonCode: "recipient_rejected",
      },
    ],
    [
      "server-error-500",
      {
        kind: "unknown_outcome",
        reconciliationKey: "telegram-notification-1",
        reasonCode: "http_500_after_write",
      },
    ],
  ] as const)(
    "executes TelegramAdapter transport fixture %s",
    async (name, expected) => {
      const value = telegramFixture(name);
      const transport = telegramTransport(value);
      const logged: unknown[] = [];
      const adapter = new TelegramAdapter({
        baseUrl: new URL("https://api.telegram.org"),
        botToken: "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__",
        transport,
        logger: { error: (entry: unknown) => logged.push(entry) },
        maxBodyBytes: 64_000,
      });
      await expect(
        adapter.sendReservationRequest({
          idempotencyKey: "telegram-notification-1",
          telegramUserId: "123456789",
          text: "fixture",
        }),
      ).resolves.toEqual(expected);
      expect(transport.request).toHaveBeenCalledTimes(1);
      expect(transport.request.mock.calls[0]![0]).toMatchObject({
        context: { idempotencyKey: "telegram-notification-1" },
      });
      const serializedLogs = JSON.stringify(logged);
      expect(serializedLogs).not.toContain(
        "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__",
      );
      if (name.includes("timeout") || name === "invalid-schema") {
        expect(serializedLogs).toContain("/bot[REDACTED]/sendMessage");
      }
    },
  );

  it("delivers the authorized schedule view through the same narrow send port", async () => {
    const transport = telegramTransport(telegramFixture("send-success"));
    const adapter = new TelegramAdapter({
      baseUrl: new URL("https://api.telegram.org"),
      botToken: "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__",
      transport,
      logger: { error: vi.fn() },
      maxBodyBytes: 64_000,
    });

    await expect(
      adapter.sendSchedule({
        idempotencyKey: "telegram-schedule-1",
        telegramUserId: "123456789",
        text: "Your authorized schedule",
      }),
    ).resolves.toEqual({ kind: "applied", providerOperationId: "42" });
    expect(transport.request.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      body: {
        chat_id: "123456789",
        text: "Your authorized schedule",
      },
      context: { idempotencyKey: "telegram-schedule-1" },
    });
  });

  it("executes duplicate and oversized update fixtures through the Telegram codec", async () => {
    const duplicate = telegramFixture("update-duplicate");
    const invalid = telegramFixture("invalid-schema");
    const oversized = telegramFixture("oversized-body");
    const adapter = new TelegramAdapter({
      baseUrl: new URL("https://api.telegram.org"),
      botToken: "__PLACEHOLDER_TELEGRAM_BOT_TOKEN__",
      transport: telegramTransport(telegramFixture("send-success")),
      logger: { error: vi.fn() },
      maxBodyBytes: 64_000,
    });
    const seen = new Set<number>();
    const mutate = vi.fn();
    const ingest = async (raw: Uint8Array) => {
      const update = await adapter.decodeUpdate(raw);
      if (seen.has(update.updateId)) return "duplicate";
      seen.add(update.updateId);
      mutate(update);
      return "applied";
    };
    const rawDuplicate = Buffer.from(JSON.stringify(duplicate.update));
    await expect(ingest(rawDuplicate)).resolves.toBe("applied");
    await expect(ingest(rawDuplicate)).resolves.toBe("duplicate");
    await expect(
      ingest(Buffer.from(JSON.stringify(invalid.update))),
    ).rejects.toThrow("invalid_schema");
    await expect(
      ingest(Buffer.alloc(oversized.expandedBodyBytes!, "x")),
    ).rejects.toThrow("body_size");
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
