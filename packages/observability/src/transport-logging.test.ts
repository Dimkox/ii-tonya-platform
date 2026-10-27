import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { TelegramAdapter } from "../../integrations/src/telegram/telegram-adapter.js";
import { TransportFailure } from "../../integrations/src/http/transport-failure.js";
import { createLogger } from "./logger.js";

it.each([
  ["before_write", "before_write", "not_applied"],
  ["after_write", "after_write", "unknown_outcome"],
  ["unknown", "unknown", "unknown_outcome"],
  ["http_503", "after_write", "unknown_outcome"],
  ["rate_limit", "rate_limit", "not_applied"],
] as const)(
  "preserves transport diagnostic %s without content and preserves business outcomes",
  async (failure, outcome, kind) => {
    const chunks: string[] = [];
    const sink = new PassThrough();
    sink.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const adapter = new TelegramAdapter({
      baseUrl: new URL("https://api.telegram.org"),
      botToken: "123456:PRIVATE_TOKEN",
      maxBodyBytes: 64_000,
      logger: createLogger(sink),
      transport: {
        request: async () => {
          if (failure === "before_write" || failure === "after_write")
            throw new TransportFailure(failure);
          if (failure === "unknown") throw new Error("private prose");
          return failure === "http_503"
            ? { status: 503, body: { detail: "private prose" } }
            : {
                status: 429,
                body: {
                  ok: false,
                  error_code: 429,
                  parameters: { retry_after: 3 },
                  description: "private prose",
                },
              };
        },
      },
    });
    const result = await adapter.sendReservationRequest({
      idempotencyKey: "private-key",
      telegramUserId: "123456789",
      text: "private prose",
    });
    expect(result.kind).toBe(kind);
    if (result.kind === "unknown_outcome")
      expect(result.reconciliationKey).toBe("private-key");
    if (failure === "rate_limit")
      expect(result).toMatchObject({ retryable: true, retryAfterMs: 3000 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const logs = chunks.join("");
    expect(logs).not.toMatch(/private|PRIVATE|123456789/u);
    expect(JSON.parse(logs)).toMatchObject({
      event: "transport_failure",
      provider: "telegram",
      operation: "sendMessage",
      outcome,
    });
  },
);

it("labels callback answer failures by their actual operation", async () => {
  const entries: unknown[] = [];
  const adapter = new TelegramAdapter({
    baseUrl: new URL("https://api.telegram.org"),
    botToken: "123456:PRIVATE_TOKEN",
    maxBodyBytes: 64_000,
    logger: { error: (entry) => entries.push(entry) },
    transport: {
      request: async () => {
        throw new TransportFailure("before_write");
      },
    },
  });
  await expect(
    adapter.answerCallbackQuery({
      idempotencyKey: "private-key",
      callbackQueryId: "private-callback",
      status: "processed",
    }),
  ).resolves.toMatchObject({ kind: "not_applied", retryable: true });
  expect(entries).toEqual([
    {
      event: "transport_failure",
      provider: "telegram",
      operation: "answerCallbackQuery",
      outcome: "before_write",
    },
  ]);
});

it.each(["sendMessage", "answerCallbackQuery"] as const)(
  "keeps exact 429 business result when the %s logger throws",
  async (operation) => {
    const logger = {
      error: vi.fn(() => {
        throw new Error("private logger failure");
      }),
    };
    const adapter = new TelegramAdapter({
      baseUrl: new URL("https://api.telegram.org"),
      botToken: "123456:PRIVATE_TOKEN",
      maxBodyBytes: 64_000,
      logger,
      transport: {
        request: async () => ({
          status: 429,
          body: {
            ok: false,
            error_code: 429,
            parameters: { retry_after: 3 },
            description: "private prose",
          },
        }),
      },
    });
    const result =
      operation === "sendMessage"
        ? adapter.sendReservationRequest({
            idempotencyKey: "private-key",
            telegramUserId: "123456789",
            text: "private prose",
          })
        : adapter.answerCallbackQuery({
            idempotencyKey: "private-key",
            callbackQueryId: "private-callback",
            status: "processed",
          });
    await expect(result).resolves.toEqual({
      kind: "not_applied",
      retryable: true,
      reasonCode: "rate_limited",
      ...(operation === "sendMessage" ? { retryAfterMs: 3000 } : {}),
    });
    expect(logger.error).toHaveBeenCalledOnce();
  },
);

it("emits a real callback 429 rate-limit record and preserves the retryable result", async () => {
  const chunks: string[] = [];
  const sink = new PassThrough();
  sink.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  const adapter = new TelegramAdapter({
    baseUrl: new URL("https://api.telegram.org"),
    botToken: "123456:PRIVATE_TOKEN",
    maxBodyBytes: 64_000,
    logger: createLogger(sink),
    transport: {
      request: async () => ({
        status: 429,
        body: {
          ok: false,
          error_code: 429,
          description: "private prose",
          parameters: { retry_after: 3 },
        },
      }),
    },
  });
  await expect(
    adapter.answerCallbackQuery({
      idempotencyKey: "private-key",
      callbackQueryId: "private-callback",
      status: "processed",
    }),
  ).resolves.toEqual({
    kind: "not_applied",
    retryable: true,
    reasonCode: "rate_limited",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(chunks.join("")).not.toMatch(/private|PRIVATE/u);
  expect(JSON.parse(chunks.join(""))).toMatchObject({
    event: "transport_failure",
    provider: "telegram",
    operation: "answerCallbackQuery",
    outcome: "rate_limit",
  });
});
