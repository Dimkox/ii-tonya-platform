import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramMethodUrl,
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
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Callback token is unknown or already used");
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
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Telegram identity is not authorized");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
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
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Invalid callback token");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: deactivatedFixture.expertActive!,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).rejects.toThrow("Expert binding is inactive");
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
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
        },
        secret,
        store,
        new Date(expiredFixture.now!),
      ),
    ).rejects.toThrow("Callback token has expired");
    await expect(
      verifyCallback(
        expiredToken,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: "expert-1",
          active: true,
        },
        secret,
        store,
        new Date("2026-07-28T10:00:00.000Z"),
      ),
    ).resolves.toEqual(claims);
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
