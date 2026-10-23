import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createExpertMaterialTransport } from "./expert-material-transport.js";
const token = "123456:synthetic_material_token_123456789";
const payload = {
  text: "Synthetic approved material",
  assets: [
    { kind: "photo" as const, reference: "telegram:file:photo_fixture" },
    { kind: "document" as const, reference: "telegram:file:document_fixture" },
  ],
};
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function input() {
  return {
    botId: "123456",
    botKey: "work-fixture",
    userId: "00000000-0000-4000-8000-000000000001",
    chatId: "789",
    reviewId: "00000000-0000-4000-8000-000000000002",
    revision: 3,
    contentVersion: "fixture-v1",
    payloadDigest: digest(payload),
    payload: structuredClone(payload),
    signal: new AbortController().signal,
  };
}
function receipt(id = 1, chat = 789, bot = 123456) {
  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        message_id: id,
        from: { id: bot, is_bot: true },
        chat: { id: chat, type: "private" },
      },
    }),
    { status: 200 },
  );
}
function fixture() {
  let n = 0;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return receipt(++n);
    },
  );
  return {
    fetcher,
    transport: createExpertMaterialTransport({
      token,
      botId: "123456",
      botKey: "work-fixture",
      fetch: fetcher,
    }),
  };
}
it("sends actual fixed-origin text/photo/document requests and requires every receipt", async () => {
  const f = fixture();
  const value = input();
  const result = await f.transport.send(value);
  expect(result).toEqual({
    messageIds: ["1", "2", "3"],
    botId: "123456",
    chatId: "789",
    contentVersion: "fixture-v1",
    payloadDigest: value.payloadDigest,
  });
  expect(f.fetcher.mock.calls.map((c) => String(c[0]))).toEqual([
    `https://api.telegram.org/bot${token}/sendMessage`,
    `https://api.telegram.org/bot${token}/sendPhoto`,
    `https://api.telegram.org/bot${token}/sendDocument`,
  ]);
  expect(JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body))).toEqual({
    chat_id: "789",
    photo: "photo_fixture",
  });
  expect(JSON.parse(String(f.fetcher.mock.calls[2]?.[1]?.body))).toEqual({
    chat_id: "789",
    document: "document_fixture",
  });
  for (const c of f.fetcher.mock.calls) {
    expect(c[1]?.redirect).toBe("error");
    expect(c[1]?.signal).toBeInstanceOf(AbortSignal);
  }
});
it("uses exactly one request for a text-only approved template", async () => {
  const f = fixture();
  const v = input();
  v.payload.assets = [];
  v.payloadDigest = digest(v.payload);
  expect((await f.transport.send(v)).messageIds).toEqual(["1"]);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  { botId: "999" },
  { botKey: "foreign" },
  { chatId: "-1" },
  { payloadDigest: "a".repeat(64) },
  { revision: -1 },
])(
  "rejects invalid scope or payload binding before provider send",
  async (change) => {
    const f = fixture();
    await expect(f.transport.send({ ...input(), ...change })).rejects.toThrow(
      "card_material_request_invalid",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);
it("refuses URL assets rather than fetching remote media", async () => {
  const f = fixture();
  const v = input();
  v.payload.assets[0]!.reference = "https://synthetic.invalid/private";
  v.payloadDigest = digest(v.payload);
  await expect(f.transport.send(v)).rejects.toThrow(
    "card_material_request_invalid",
  );
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(["chat", "bot", "count"])(
  "quarantines wrong receipt %s without declaring package delivery",
  async (mismatch) => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(receipt(1));
    f.fetcher.mockResolvedValueOnce(
      receipt(
        mismatch === "count" ? 0 : 2,
        mismatch === "chat" ? 999 : 789,
        mismatch === "bot" ? 999 : 123456,
      ),
    );
    await expect(f.transport.send(input())).rejects.toThrow(
      "card_material_delivery_uncertain",
    );
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  },
);
it("never reports success after partial delivery and rate rejection", async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(receipt(1));
  f.fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        parameters: { retry_after: 1 },
      }),
      { status: 429 },
    ),
  );
  await expect(f.transport.send(input())).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it("captures payload before asynchronous transport can mutate caller input", async () => {
  const f = fixture();
  const v = input();
  f.fetcher.mockImplementationOnce(async () => {
    v.payload.assets[0]!.reference = "telegram:file:changed";
    v.chatId = "999";
    return receipt(100);
  });
  await f.transport.send(v);
  expect(JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body)).photo).toBe(
    "photo_fixture",
  );
});
it("does not send when original signal was already aborted", async () => {
  const f = fixture();
  const v = input();
  v.signal = AbortSignal.abort();
  await expect(f.transport.send(v)).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("stops remaining assets when caller aborts after first acknowledgement", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.fetcher.mockImplementationOnce(async () => {
    controller.abort();
    return receipt(1);
  });
  await expect(
    f.transport.send({ ...input(), signal: controller.signal }),
  ).rejects.toThrow("card_material_delivery_uncertain");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it("bounds stalled provider fetch and masks raw private errors", async () => {
  const f = fixture();
  f.fetcher.mockImplementationOnce(async () => {
    throw new Error("synthetic private text and token");
  });
  await expect(f.transport.send(input())).rejects.toThrow(
    /^card_material_delivery_uncertain$/u,
  );
  const stalled = createExpertMaterialTransport({
    token,
    botId: "123456",
    botKey: "work-fixture",
    timeoutMs: 5,
    fetch: async () => new Promise<Response>(() => {}),
  });
  await expect(stalled.send(input())).rejects.toThrow(
    /^card_material_delivery_uncertain$/u,
  );
});
it("rejects duplicate provider receipt members including escaped equivalents", async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(receipt(1));
  f.fetcher.mockResolvedValueOnce(
    new Response(
      '{"ok":false,"\\u006fk":true,"result":{"message_id":2,"from":{"id":123456,"is_bot":true},"chat":{"id":789,"type":"private"}}}',
      { status: 200 },
    ),
  );
  await expect(f.transport.send(input())).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
});
it("rejects redirects and oversized receipt streams", async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(receipt(1));
  const redirected = receipt(2);
  Object.defineProperty(redirected, "redirected", { value: true });
  f.fetcher.mockResolvedValueOnce(redirected);
  await expect(f.transport.send(input())).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
  const g = fixture();
  g.fetcher.mockResolvedValueOnce(receipt(1));
  g.fetcher.mockResolvedValueOnce(
    new Response("x".repeat(65537), { status: 200 }),
  );
  await expect(g.transport.send(input())).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
});
it("fails incomplete or conflicting configuration before use", () => {
  expect(() =>
    createExpertMaterialTransport({
      token,
      botId: "999",
      botKey: "work-fixture",
    }),
  ).toThrow("card_material_configuration_invalid");
});

it("rejects reused message IDs across package parts", async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(receipt(1));
  f.fetcher.mockResolvedValueOnce(receipt(1));
  await expect(f.transport.send(input())).rejects.toThrow(
    "card_material_delivery_uncertain",
  );
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it("rejects newline aliases and excessive assets before sending", async () => {
  const f = fixture();
  const malformed = input();
  malformed.chatId = "789\n";
  await expect(f.transport.send(malformed)).rejects.toThrow(
    "card_material_request_invalid",
  );
  const tooMany = input();
  tooMany.payload.assets = Array.from({ length: 9 }, () => ({
    kind: "photo" as const,
    reference: "telegram:file:fixture",
  }));
  tooMany.payloadDigest = digest(tooMany.payload);
  await expect(f.transport.send(tooMany)).rejects.toThrow(
    "card_material_request_invalid",
  );
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("returns immutable acknowledgement data and never logs raw provider errors", async () => {
  const f = fixture();
  const result = await f.transport.send(input());
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.messageIds)).toBe(true);
  const logs = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  try {
    const failed = fixture();
    failed.fetcher.mockRejectedValueOnce(
      new Error(`${token} synthetic private payload`),
    );
    await expect(failed.transport.send(input())).rejects.toThrow(
      /^card_material_delivery_uncertain$/u,
    );
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally {
    for (const log of logs) log.mockRestore();
  }
});

it.each([1, 2, 3])(
  "checks monotonic deadline when provider continuation blocks timers at part%s",
  async (delayedPart) => {
    let calls = 0;
    const timeoutMs = delayedPart === 1 ? 1 : 25;
    const transport = createExpertMaterialTransport({
      token,
      botId: "123456",
      botKey: "work-fixture",
      timeoutMs,
      fetch: async () => {
        calls += 1;
        if (calls === delayedPart) {
          const until = performance.now() + timeoutMs + 5;
          while (performance.now() < until) {
            /* synchronous provider continuation blocks timer dispatch */
          }
        }
        return receipt(calls);
      },
    });
    await expect(transport.send(input())).rejects.toThrow(
      /^card_material_delivery_uncertain$/u,
    );
    expect(calls).toBe(delayedPart);
  },
);
it("settles a stalled asset body as unknown and never writes later assets after timeout", async () => {
  let calls = 0;
  let stalled: ReadableStreamDefaultController<Uint8Array> | undefined;
  const transport = createExpertMaterialTransport({
    token,
    botId: "123456",
    botKey: "work-fixture",
    timeoutMs: 10,
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? receipt(1)
        : new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                stalled = c;
              },
            }),
            { status: 200 },
          );
    },
  });
  await expect(transport.send(input())).rejects.toThrow(
    /^card_material_delivery_uncertain$/u,
  );
  expect(calls).toBe(2);
  try {
    stalled?.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 2,
            from: { id: 123456, is_bot: true },
            chat: { id: 789, type: "private" },
          },
        }),
      ),
    );
    stalled?.close();
  } catch {
    /* a cancelled provider stream is already closed */
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(2);
});

it("allows revision-zero generic materials only with an explicit matching application scope", async () => {
  const f = fixture(),
    value = input();
  const generic = {
    ...value,
    revision: 0 as const,
    materialPurpose: "application_generic" as const,
    applicationId: value.reviewId,
    payloadDigest: digest({
      purpose: "application_generic",
      applicationId: value.reviewId,
      payload: value.payload,
    }),
  };
  expect((await f.transport.send(generic)).messageIds).toEqual(["1", "2", "3"]);
  const invalid = fixture();
  await expect(
    invalid.transport.send({ ...input(), revision: 0 }),
  ).rejects.toThrow("card_material_request_invalid");
  await expect(
    invalid.transport.send({ ...generic, applicationId: value.userId }),
  ).rejects.toThrow("card_material_request_invalid");
  await expect(
    invalid.transport.send({
      ...generic,
      applicationId: value.userId,
      reviewId: value.userId,
    }),
  ).rejects.toThrow("card_material_request_invalid");
  await expect(
    invalid.transport.send({ ...generic, payloadDigest: value.payloadDigest }),
  ).rejects.toThrow("card_material_request_invalid");
  expect(invalid.fetcher).not.toHaveBeenCalled();
});
