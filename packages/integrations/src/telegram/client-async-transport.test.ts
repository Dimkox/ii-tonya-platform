import { afterEach, describe, expect, it, vi } from "vitest";
import * as integrations from "../index.js";
import { TransportFailure } from "../http/transport-failure.js";
import type {
  TelegramTransport,
  TelegramTransportRequest,
} from "./telegram-adapter.js";

const token = "123456:synthetic_token_abcdefghijklmnopqrstuvwxyz";
const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
const request = (): TelegramTransportRequest => ({
  method: "POST",
  url: new URL(endpoint),
  headers: { "content-type": "application/json" },
  body: { chat_id: "91001", text: "synthetic response" },
  context: { idempotencyKey: "synthetic", disableRequestLogging: true },
});
const receipt = () => ({
  ok: true,
  result: {
    message_id: 42,
    from: { id: 123456, is_bot: true },
    chat: { id: 91001, type: "private" },
    text: "synthetic response",
  },
});
function transport(fetch: typeof globalThis.fetch, configuredToken = token) {
  // Namespace lookup keeps RED behavioral (missing capability), not an import failure.
  const factory = (
    integrations as unknown as {
      createClientAsyncTelegramTransport?: (options: {
        token: string;
        fetch: typeof globalThis.fetch;
      }) => TelegramTransport;
    }
  ).createClientAsyncTelegramTransport;
  expect(factory, "ordinary client HTTP capability is exported").toBeTypeOf(
    "function",
  );
  return factory!({ token: configuredToken, fetch });
}
afterEach(() => vi.useRealTimers());

describe("bot-bound plain client HTTP delivery", () => {
  it("sends only the plain wire body once and preserves the validated original response", async () => {
    const body = receipt();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(body));
    expect(await transport(fetch).request(request())).toEqual({
      status: 200,
      body,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: '{"chat_id":"91001","text":"synthetic response"}',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    "foreign-url",
    "query",
    "headers",
    "callback",
    "extra-body",
    "extra-request",
    "bad-chat",
    "unsafe-chat",
    "empty-text",
    "long-text",
    "unicode",
    "logging",
  ])("rejects %s before fetch", async (mode) => {
    const input = request();
    if (mode === "foreign-url")
      input.url = new URL("https://example.invalid/sendMessage");
    if (mode === "query") input.url.search = "?extra=1";
    if (mode === "headers")
      input.headers = { ...input.headers, authorization: "synthetic" };
    if (mode === "callback")
      input.body = {
        callback_query_id: "synthetic",
        text: "synthetic",
        show_alert: false,
      };
    if (mode === "extra-body") Object.assign(input.body, { reply_markup: {} });
    if (mode === "extra-request") Object.assign(input, { extra: true });
    if (mode === "bad-chat") Object.assign(input.body, { chat_id: "-1" });
    if (mode === "unsafe-chat")
      Object.assign(input.body, { chat_id: "9007199254740993" });
    if (mode === "empty-text") Object.assign(input.body, { text: "" });
    if (mode === "long-text")
      Object.assign(input.body, { text: "a".repeat(4097) });
    if (mode === "unicode") Object.assign(input.body, { text: "\ud800" });
    if (mode === "logging")
      Object.assign(input.context, { disableRequestLogging: false });
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(transport(fetch).request(input)).rejects.toThrow(
      "client_telegram_request_invalid",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "0:abcdefghijklmnopqrstuvwxyz",
    "9007199254740993:abcdefghijklmnopqrstuvwxyz",
    "123456:bad/token",
    "123456:short",
  ])("rejects invalid token configuration without exposing it", (value) => {
    expect(() => transport(vi.fn(), value)).toThrow(
      "client_telegram_configuration_invalid",
    );
  });

  it.each([
    "bot",
    "chat",
    "not-bot",
    "group",
    "message-zero",
    "message-string",
    "message-unsafe",
    "missing-result",
    "wrong-status",
  ])("keeps %s receipt uncertain", async (mode) => {
    const body = receipt();
    if (mode === "bot") body.result.from.id++;
    if (mode === "chat") body.result.chat.id++;
    if (mode === "not-bot") body.result.from.is_bot = false;
    if (mode === "group") body.result.chat.type = "group";
    if (mode === "message-zero") body.result.message_id = 0;
    if (mode === "message-string")
      Object.assign(body.result, { message_id: "42" });
    if (mode === "message-unsafe")
      body.result.message_id = Number.MAX_SAFE_INTEGER + 1;
    if (mode === "missing-result") Object.assign(body, { result: undefined });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(body, { status: mode === "wrong-status" ? 201 : 200 }),
      );
    await expect(transport(fetch).request(request())).rejects.toThrow(
      "client_telegram_delivery_uncertain",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "malformed",
    "too-large",
    "length",
    "truncated",
    "utf8",
    "redirected",
    "foreign-response",
    "stream-error",
  ])("bounds and rejects %s response", async (mode) => {
    let response = Response.json(receipt());
    if (mode === "malformed") response = new Response("{");
    if (mode === "too-large") response = new Response(" ".repeat(65537));
    if (mode === "length") response.headers.set("content-length", "65537");
    if (mode === "truncated") response.headers.set("content-length", "500");
    if (mode === "utf8") response = new Response(new Uint8Array([0xff]));
    if (mode === "redirected")
      Object.defineProperty(response, "redirected", { value: true });
    if (mode === "foreign-response")
      Object.defineProperty(response, "url", {
        value: "https://example.invalid",
      });
    if (mode === "stream-error")
      response = new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("synthetic-private-response"));
          },
        }),
      );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    await expect(transport(fetch).request(request())).rejects.toThrow(
      "client_telegram_delivery_uncertain",
    );
  });

  it.each([400, 401, 403, 429])(
    "returns only a proven HTTP%s rejection envelope",
    async (status) => {
      const body = {
        ok: false,
        error_code: status,
        description: "synthetic rejection",
        ...(status === 429 ? { parameters: { retry_after: 60 } } : {}),
      };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json(body, { status }));
      expect(await transport(fetch).request(request())).toEqual({
        status,
        body,
      });
    },
  );

  it.each([
    [
      "ok",
      200,
      '{"ok":false,"ok":true,"result":{"message_id":42,"from":{"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"}}}',
    ],
    [
      "identical ok",
      200,
      '{"ok":true,"ok":true,"result":{"message_id":42,"from":{"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"}}}',
    ],
    [
      "sender identity",
      200,
      '{"ok":true,"result":{"message_id":42,"from":{"id":999999,"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"}}}',
    ],
    [
      "chat identity",
      200,
      '{"ok":true,"result":{"message_id":42,"from":{"id":123456,"is_bot":true},"chat":{"id":99999,"id":91001,"type":"private"}}}',
    ],
    [
      "sender object",
      200,
      '{"ok":true,"result":{"message_id":42,"from":{"id":999999,"is_bot":true},"from":{"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"}}}',
    ],
    [
      "retry delay",
      429,
      '{"ok":false,"error_code":429,"parameters":{"retry_after":60,"retry_after":0}}',
    ],
    [
      "retry parameters",
      429,
      '{"ok":false,"error_code":429,"parameters":{"retry_after":60},"parameters":{"retry_after":0}}',
    ],
    [
      "escaped sender identity",
      200,
      String.raw`{"ok":true,"result":{"message_id":42,"from":{"id":999999,"\u0069d":123456,"is_bot":true},"chat":{"id":91001,"type":"private"}}}`,
    ],
    [
      "escaped retry delay",
      429,
      String.raw`{"ok":false,"error_code":429,"parameters":{"retry_after":60,"retry_\u0061fter":0}}`,
    ],
    [
      "escaped member inside array",
      200,
      String.raw`{"ok":true,"result":{"message_id":42,"from":{"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"},"extra":[{"label":1,"\u006cabel":2}]}}`,
    ],
    [
      "prototype member",
      429,
      '{"ok":false,"error_code":429,"parameters":{"retry_after":60,"__proto__":1,"__proto__":2}}',
    ],
  ] as const)(
    "rejects duplicate %s in raw response before member collapse",
    async (_name, status, raw) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(raw, { status }));
      await expect(transport(fetch).request(request())).rejects.toThrow(
        /^client_telegram_delivery_uncertain$/u,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("allows the same member name in separate objects and escaped JSON punctuation in values", async () => {
    const raw = String.raw`{"ok":true,"result":{"message_id":42,"from":{"id":123456,"is_bot":true},"chat":{"id":91001,"type":"private"},"text":"synthetic \"id\":0,{}[]\\","extra":[{"id":1},{"id":2}]}}`;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(raw));
    const result = await transport(fetch).request(request());
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        result: {
          message_id: 42,
          from: { id: 123456, is_bot: true },
          chat: { id: 91001, type: "private" },
          text: 'synthetic "id":0,{}[]\\',
          extra: [{ id: 1 }, { id: 2 }],
        },
      },
    });
  });

  it("accepts a unique escaped retry member without changing the original envelope", async () => {
    const raw = String.raw`{"ok":false,"error_code":429,"parameters":{"retry_\u0061fter":60}}`;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(raw, { status: 429 }));
    expect(await transport(fetch).request(request())).toEqual({
      status: 429,
      body: { ok: false, error_code: 429, parameters: { retry_after: 60 } },
    });
  });

  it.each([undefined, -1, 1.5, "60", 2147483648, null])(
    "does not turn invalid 429 delay %s into a retry",
    async (retry_after) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json(
            { ok: false, error_code: 429, parameters: { retry_after } },
            { status: 429 },
          ),
        );
      await expect(transport(fetch).request(request())).rejects.toThrow(
        "client_telegram_delivery_uncertain",
      );
    },
  );
  it.each([400, 429, 500])(
    "rejects mismatched error_code at HTTP%s",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json(
            { ok: false, error_code: 403, parameters: { retry_after: 60 } },
            { status },
          ),
        );
      await expect(transport(fetch).request(request())).rejects.toThrow(
        "client_telegram_delivery_uncertain",
      );
    },
  );
  it.each([
    new TypeError("synthetic network detail"),
    new TransportFailure("after_write"),
  ])("sanitizes uncertain network rejection", async (error) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    await expect(transport(fetch).request(request())).rejects.toThrow(
      /^client_telegram_delivery_uncertain$/u,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves explicit before-write proof without inventing one", async () => {
    const failure = new TransportFailure("before_write");
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(failure);
    await expect(transport(fetch).request(request())).rejects.toBe(failure);
  });
  it.each(["fetch", "body"])(
    "enforces total 15s deadline on uncooperative %s",
    async (mode) => {
      vi.useFakeTimers();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () =>
          mode === "fetch"
            ? new Promise<Response>(() => {})
            : new Response(
                new ReadableStream({
                  pull: () => new Promise<void>(() => {}),
                  cancel: () => new Promise<void>(() => {}),
                }),
              ),
        );
      const result = transport(fetch).request(request());
      const assertion = expect(result).rejects.toThrow(
        "client_telegram_delivery_uncertain",
      );
      await vi.advanceTimersByTimeAsync(15000);
      await assertion;
      expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
