import { afterEach, expect, it, vi } from "vitest";
import { TransportFailure } from "../http/transport-failure.js";
import { createBookingNotificationTransport } from "./booking-notification-transport.js";

const token = `12345:${"a".repeat(35)}`;
const request = () => ({
  botKey: "client",
  chatId: "201",
  text: "Запись отменена.",
  deadline: new Date(Date.now() + 60_000).toISOString(),
});
const success = () => ({
  ok: true,
  result: {
    message_id: 77,
    date: 1780000000,
    from: { id: 12345, is_bot: true, first_name: "Test" },
    chat: { id: 201, type: "private", first_name: "Test" },
    text: "Запись отменена.",
  },
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const client = (fetch: typeof globalThis.fetch) =>
  createBookingNotificationTransport({ botKey: "client", token, fetch });
afterEach(() => vi.useRealTimers());

it("sends once to fixed endpoint and returns a bound receipt", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport = client(async (url, init) => {
    calls.push({ url: String(url), init });
    return response(success());
  });
  expect(await transport.send(request())).toEqual({
    kind: "applied",
    receipt: { botKey: "client", chatId: "201", messageId: 77 },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(
    `https://api.telegram.org/bot${token}/sendMessage`,
  );
  expect(calls[0]!.init?.redirect).toBe("error");
  expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
    chat_id: "201",
    text: "Запись отменена.",
  });
});

it.each(["", "x/../../", "123:bad\n", `123:${"я".repeat(35)}`])(
  "rejects invalid token before networking: %s",
  (bad) => {
    expect(() =>
      createBookingNotificationTransport({ botKey: "client", token: bad }),
    ).toThrow("booking_notification_configuration_invalid");
  },
);
it.each([
  { chatId: "-201" },
  { chatId: "9007199254740992" },
  { chatId: "0201" },
  { botKey: "other" },
  { text: "" },
  { text: "\ud800" },
  { text: "a".repeat(4097) },
  { deadline: "invalid" },
  { deadline: "2000-01-01T00:00:00Z" },
])("rejects invalid input without HTTP: %j", async (patch) => {
  let calls = 0;
  const result = await client(async () => {
    calls++;
    return response(success());
  }).send({ ...request(), ...patch });
  expect(result.kind).toBe("failed");
  expect(calls).toBe(0);
});

it("preserves only validated approval buttons", async () => {
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "Подтвердить", callback_data: `ct2.${"a".repeat(44)}` },
        { text: "Отменить", callback_data: `ct2.${"b".repeat(44)}` },
      ],
    ],
  };
  let body: unknown;
  const result = await client(async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return response(success());
  }).send({ ...request(), replyMarkup });
  expect(result.kind).toBe("applied");
  expect(body).toEqual({
    chat_id: "201",
    text: "Запись отменена.",
    reply_markup: replyMarkup,
  });
});
it("rejects arbitrary URL buttons before HTTP", async () => {
  let calls = 0;
  const result = await client(async () => {
    calls++;
    return response(success());
  }).send({
    ...request(),
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: "Подтвердить",
            callback_data: `ct2.${"a".repeat(44)}`,
            url: "https://example.org",
          },
          { text: "Отказать", callback_data: `ct2.${"b".repeat(44)}` },
        ],
      ],
    },
  });
  expect(result.kind).toBe("failed");
  expect(calls).toBe(0);
});

it.each([0, -1, 1.5, 9007199254740992])(
  "rejects invalid receipt message ID %s",
  async (message_id) => {
    const data = success();
    data.result.message_id = message_id;
    expect(
      (await client(async () => response(data)).send(request())).kind,
    ).toBe("unknown");
  },
);
it.each(["chat", "bot", "group", "human"])(
  "rejects mismatched receipt %s",
  async (kind) => {
    const data = success();
    if (kind === "chat") data.result.chat.id = 202;
    if (kind === "bot") data.result.from.id = 12346;
    if (kind === "group") data.result.chat.type = "group";
    if (kind === "human") data.result.from.is_bot = false;
    expect(
      (await client(async () => response(data)).send(request())).kind,
    ).toBe("unknown");
  },
);
it.each([302, 400, 401, 403, 408, 429, 500])(
  "does not accept success JSON with HTTP%s",
  async (status) => {
    expect(
      (await client(async () => response(success(), status)).send(request()))
        .kind,
    ).toBe("unknown");
  },
);
it.each([400, 401, 403])(
  "classifies valid HTTP%s rejection",
  async (status) => {
    expect(
      await client(async () =>
        response(
          { ok: false, error_code: status, description: "synthetic" },
          status,
        ),
      ).send(request()),
    ).toEqual({
      kind: "failed",
      reasonCode: status === 401 ? "bot_rejected" : "recipient_rejected",
      pauseBot: status === 401,
    });
  },
);
it("does not shorten429 or resend", async () => {
  let calls = 0;
  expect(
    await client(async () => {
      calls++;
      return response(
        { ok: false, error_code: 429, parameters: { retry_after: 3600 } },
        429,
      );
    }).send(request()),
  ).toEqual({ kind: "not_applied", retryAfterSeconds: 3600 });
  expect(calls).toBe(1);
});
it.each([-1, 1.5, "60", 2147483648, null])(
  "rejects malformed retry_after %s",
  async (retry_after) => {
    expect(
      (
        await client(async () =>
          response(
            { ok: false, error_code: 429, parameters: { retry_after } },
            429,
          ),
        ).send(request())
      ).kind,
    ).toBe("unknown");
  },
);
it.each(["before_write", "after_write"] as const)(
  "classifies fetch phase %s",
  async (phase) => {
    expect(
      (
        await client(async () => {
          throw new TransportFailure(phase);
        }).send(request())
      ).kind,
    ).toBe(phase === "before_write" ? "not_applied" : "unknown");
  },
);
it("never treats a body failure as before-write evidence", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.error(new TransportFailure("before_write"));
    },
  });
  expect(
    (await client(async () => new Response(stream)).send(request())).kind,
  ).toBe("unknown");
});
it("does not expose raw fetch exceptions", async () => {
  const result = await client(async () => {
    throw new Error(`secret:${token}`);
  }).send(request());
  expect(result.kind).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain(token);
});
it.each([65536, 65537])(
  "enforces response byte boundary on otherwise valid JSON: %s",
  async (bytes) => {
    const json = JSON.stringify(success());
    const padded = json + " ".repeat(bytes - Buffer.byteLength(json));
    const result = await client(async () => new Response(padded)).send(
      request(),
    );
    expect(result.kind).toBe(bytes === 65536 ? "applied" : "unknown");
  },
);
it("rejects declared oversize even with a valid small body", async () => {
  expect(
    (
      await client(
        async () =>
          new Response(JSON.stringify(success()), {
            headers: { "content-length": "65537" },
          }),
      ).send(request())
    ).kind,
  ).toBe("unknown");
});
it("rejects malformed UTF8", async () => {
  const wire = Buffer.from(JSON.stringify(success()));
  const start = wire.indexOf(Buffer.from("Test"));
  wire[start] = 0xc3;
  wire[start + 1] = 0x28;
  expect(
    (await client(async () => new Response(wire)).send(request())).kind,
  ).toBe("unknown");
});

it("pauses the bot on a bound-chat receipt from a different bot without claiming non-delivery", async () => {
  const data = success();
  data.result.from.id = 12346;
  expect(await client(async () => response(data)).send(request())).toEqual({
    kind: "unknown",
    reasonCode: "bot_mismatch",
    pauseBot: true,
  });
});
it("bounds stalled fetch and aborts it without retry", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  const result = client(async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  }).send(request());
  await vi.advanceTimersByTimeAsync(15000);
  expect((await result).kind).toBe("unknown");
  expect(signal?.aborted).toBe(true);
});
it("bounds a stalled response body", async () => {
  vi.useFakeTimers();
  const result = client(
    async () => new Response(new ReadableStream<Uint8Array>()),
  ).send(request());
  await vi.advanceTimersByTimeAsync(15000);
  expect((await result).kind).toBe("unknown");
});
