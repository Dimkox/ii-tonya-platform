import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportFailure } from "../http/transport-failure.js";
import { SelartiRestClient } from "./rest-client.js";

const send = {
  taskId: "task",
  companyId: "company",
  chatId: "chat",
  text: "Hello",
};
const query = {
  taskId: "task",
  companyId: "company",
  threadId: "thread",
  limit: 10,
  offset: 0,
};
const thread = {
  _id: "thread",
  task: "task",
  company: "company",
  chat_id: "chat",
};
const message = {
  _id: "message",
  thread: "thread",
  task: "task",
  company: "company",
  text: "Hello",
  message_type: "bot",
  message_status: "pending",
};
const response = (value: unknown) =>
  Response.json({ status: "success", response: value });
const boundEnvelope = (metadata = "") => ({
  status: "success",
  response: { thread, message: [message] },
  metadata,
});
const paddedEnvelope = (bytes: number) => {
  const base = JSON.stringify(boundEnvelope());
  return JSON.stringify(
    boundEnvelope("x".repeat(bytes - Buffer.byteLength(base))),
  );
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Selarti native REST client", () => {
  it.each(["\ud800", "\udc00", "a\ud800b", "   ", "\u00a0\u2003"])(
    "rejects malformed or whitespace-only identifiers without fetching: %j",
    async (value) => {
      const fetcher = vi.fn(async () => response({ message: [] }));
      const client = new SelartiRestClient("token", fetcher);
      for (const key of ["taskId", "companyId", "chatId"] as const) {
        expect(await client.sendExternal({ ...send, [key]: value })).toEqual({
          kind: "not_applied",
          code: "invalid_input",
        });
      }
      for (const key of ["taskId", "companyId", "threadId"] as const) {
        expect(await client.getMessages({ ...query, [key]: value })).toEqual({
          kind: "error",
          code: "invalid_input",
        });
      }
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["\ud800", "\udc00", "   ", "\u2003"])(
    "rejects malformed provider identifiers: %j",
    async (value) => {
      const client = new SelartiRestClient("token", async () =>
        response({
          thread: { ...thread, _id: value },
          message: [{ ...message, _id: value }],
        }),
      );
      expect(await client.sendExternal(send)).toMatchObject({
        kind: "unknown",
      });
      expect(await client.getMessages(query)).toMatchObject({ kind: "error" });
    },
  );
  it("preserves well-formed identifiers exactly without trimming or Unicode normalization", async () => {
    const value = " e\u0301😀 ";
    const fetcher = vi.fn(async () =>
      response({
        thread: { ...thread, chat_id: value },
        message: [{ ...message, thread: value }],
      }),
    );
    const client = new SelartiRestClient("token", fetcher);
    expect(await client.sendExternal({ ...send, chatId: value })).toMatchObject(
      { kind: "accepted" },
    );
    expect(
      await client.getMessages({ ...query, threadId: value }),
    ).toMatchObject({ kind: "page", messages: [{ threadId: value }] });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0]![1].body as string).chat_id).toBe(value);
    expect(new URL(calls[1]![0]).searchParams.get("thread_id")).toBe(value);
  });
  it.each(["токен", "token😀", "token\ud800", "tokené", "token\u200b"])(
    "rejects non-ASCII bearer before any fetch: %j",
    (token) => {
      const fetcher = vi.fn();
      expect(() => new SelartiRestClient(token, fetcher)).toThrow(
        "selarti_invalid_input",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["_id", "task", "company", "chat_id"])(
    "rejects actually missing thread field %s",
    async (key) => {
      const incomplete: Record<string, unknown> = { ...thread };
      delete incomplete[key];
      expect(
        await new SelartiRestClient("token", async () =>
          response({ thread: incomplete }),
        ).sendExternal(send),
      ).toMatchObject({ kind: "unknown" });
    },
  );
  it.each([
    "_id",
    "thread",
    "task",
    "company",
    "text",
    "message_type",
    "message_status",
  ])(
    "rejects entire page with actually missing message field %s",
    async (key) => {
      const incomplete: Record<string, unknown> = { ...message };
      delete incomplete[key];
      expect(
        await new SelartiRestClient("token", async () =>
          response({ message: [message, incomplete] }),
        ).getMessages(query),
      ).toMatchObject({ kind: "error" });
    },
  );
  it.each(["declared", "actual"])(
    "rejects valid bound JSON exceeding %s byte limit",
    async (mode) => {
      const body =
        mode === "actual"
          ? paddedEnvelope(65537)
          : JSON.stringify(boundEnvelope());
      expect(JSON.parse(body)).toMatchObject(
        boundEnvelope(mode === "actual" ? JSON.parse(body).metadata : ""),
      );
      expect(Buffer.byteLength(body)).toBe(
        mode === "actual"
          ? 65537
          : Buffer.byteLength(JSON.stringify(boundEnvelope())),
      );
      const client = new SelartiRestClient(
        "token",
        async () =>
          new Response(body, {
            headers: mode === "declared" ? { "content-length": "65537" } : {},
          }),
      );
      expect(await client.sendExternal(send)).toMatchObject({
        kind: "unknown",
      });
      expect(await client.getMessages(query)).toMatchObject({ kind: "error" });
    },
  );
  it("accepts a valid bound envelope at exactly 64 KiB", async () => {
    const body = paddedEnvelope(65536);
    expect(Buffer.byteLength(body)).toBe(65536);
    const client = new SelartiRestClient(
      "token",
      async () =>
        new Response(body, { headers: { "content-length": "65536" } }),
    );
    expect(await client.sendExternal(send)).toMatchObject({ kind: "accepted" });
    expect(await client.getMessages(query)).toMatchObject({ kind: "page" });
  });
  it.each([false, true])(
    "counts UTF-8 bytes across chunks (oversized=%s)",
    async (oversized) => {
      const body = JSON.stringify(
        boundEnvelope(oversized ? "😀".repeat(17000) : "Привет😀"),
      );
      const bytes = new TextEncoder().encode(body);
      if (oversized) {
        expect(body.length).toBeLessThan(65536);
        expect(bytes.length).toBeGreaterThan(65536);
      }
      const client = new SelartiRestClient(
        "token",
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                // One-byte chunks deliberately split every multibyte code point.
                for (let i = 0; i < bytes.length; i += 1)
                  controller.enqueue(bytes.subarray(i, i + 1));
                controller.close();
              },
            }),
          ),
      );
      expect(await client.sendExternal(send)).toMatchObject({
        kind: oversized ? "unknown" : "accepted",
      });
      expect(await client.getMessages(query)).toMatchObject({
        kind: oversized ? "error" : "page",
      });
    },
  );
  it("rejects invalid UTF-8 inside otherwise valid bound JSON metadata", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(boundEnvelope("X")));
    const index = bytes.lastIndexOf("X".charCodeAt(0));
    bytes[index] = 0xff;
    expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({
      status: "success",
      response: { thread },
    });
    const client = new SelartiRestClient(
      "token",
      async () => new Response(bytes),
    );
    expect(await client.sendExternal(send)).toMatchObject({ kind: "unknown" });
    expect(await client.getMessages(query)).toMatchObject({ kind: "error" });
  });
  it("enforces monotonic deadline when ready chunks starve timer callbacks", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    let pulls = 0;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              now += 1000;
              if (pulls <= 16) controller.enqueue(new Uint8Array());
              else {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(boundEnvelope())),
                );
                controller.close();
              }
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
    });
    // Never advance fake timers: a timer-only implementation would accept the
    // finite fallback success envelope, rather than hang this regression.
    expect(
      await new SelartiRestClient("token", fetcher).sendExternal(send),
    ).toMatchObject({ kind: "unknown" });
    expect(pulls).toBe(15);
    expect(cancel).toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels a body arriving after timeout even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    let deliver!: (response: Response) => void;
    const cancel = vi.fn();
    const client = new SelartiRestClient(
      "token",
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = client.sendExternal(send);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({ kind: "unknown" });
    deliver(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("does not classify a body failure as before-write", async () => {
    const client = new SelartiRestClient(
      "token",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TransportFailure("before_write"));
            },
          }),
        ),
    );
    expect(await client.sendExternal(send)).toMatchObject({ kind: "unknown" });
  });
  it("accepts empty pages and rejects more rows than requested", async () => {
    expect(
      await new SelartiRestClient("token", async () =>
        response({ message: [] }),
      ).getMessages(query),
    ).toEqual({ kind: "page", messages: [] });
    expect(
      await new SelartiRestClient("token", async () =>
        response({ message: [message, message] }),
      ).getMessages({ ...query, limit: 1 }),
    ).toMatchObject({ kind: "error" });
  });
  it("accepts input boundaries and encodes query identifiers", async () => {
    const fetcher = vi.fn(async () => response({ message: [] }));
    const client = new SelartiRestClient("token", fetcher);
    expect(
      await client.getMessages({
        ...query,
        threadId: "a&b",
        limit: 100,
        offset: 10000,
      }),
    ).toMatchObject({ kind: "page" });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://selarti.com/api/1.1/wf/get_message?thread_id=a%26b&limit=100&offset=10000",
    );
    const longId = "a".repeat(256);
    const sender = new SelartiRestClient("token", async () =>
      response({ thread: { ...thread, task: longId } }),
    );
    expect(
      await sender.sendExternal({
        ...send,
        taskId: longId,
        text: "x".repeat(4096),
      }),
    ).toMatchObject({ kind: "accepted" });
  });
  it("times out stalled reads without exposing transport details", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const pending = new SelartiRestClient("token", fetcher).getMessages(query);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual({ kind: "error", code: "read_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sends once using the documented external-send contract", async () => {
    const fetcher = vi.fn(async () =>
      response({ thread: { ...thread, secret_metadata: "ignored" } }),
    );
    expect(
      await new SelartiRestClient("synthetic-token", fetcher).sendExternal(
        send,
      ),
    ).toEqual({ kind: "accepted", threadId: "thread" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://selarti.com/api/1.1/wf/send_message_external");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer synthetic-token" },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      task_id: "task",
      chat_id: "chat",
      message: "Hello",
      message_type: "user",
    });
  });
  it.each(["task", "company", "chat_id", "_id"])(
    "rejects foreign or missing acceptance %s",
    async (key) => {
      const fetcher = vi.fn(async () =>
        response({
          thread: { ...thread, [key]: key === "_id" ? "" : "foreign" },
        }),
      );
      expect(
        await new SelartiRestClient("token", fetcher).sendExternal(send),
      ).toMatchObject({ kind: "unknown" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("reads normalized messages without completion or pagination claims", async () => {
    const fetcher = vi.fn(async () =>
      response({ message: [{ ...message, extra: "ignored" }] }),
    );
    expect(
      await new SelartiRestClient("token", fetcher).getMessages(query),
    ).toEqual({
      kind: "page",
      messages: [
        {
          id: "message",
          threadId: "thread",
          taskId: "task",
          companyId: "company",
          text: "Hello",
          messageType: "bot",
          messageStatus: "pending",
        },
      ],
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://selarti.com/api/1.1/wf/get_message?thread_id=thread&limit=10&offset=0",
    );
    expect(init.method).toBe("GET");
  });
  it.each([
    "thread",
    "task",
    "company",
    "_id",
    "message_type",
    "message_status",
    "text",
  ])("rejects entire page for invalid %s", async (key) => {
    const bad = {
      ...message,
      [key]: ["thread", "task", "company"].includes(key) ? "foreign" : null,
    };
    const client = new SelartiRestClient("token", async () =>
      response({ message: [message, bad] }),
    );
    expect(await client.getMessages(query)).toEqual({
      kind: "error",
      code: "read_failed",
    });
  });
  it.each([
    { taskId: "" },
    { companyId: "x\n" },
    { chatId: "x".repeat(257) },
    { text: "" },
    { text: "x".repeat(4097) },
  ])("rejects invalid send input before HTTP %j", async (patch) => {
    const fetcher = vi.fn();
    expect(
      await new SelartiRestClient("token", fetcher).sendExternal({
        ...send,
        ...patch,
      }),
    ).toEqual({ kind: "not_applied", code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 10001 },
    { offset: 0.5 },
    { threadId: "\u007f" },
  ])("rejects invalid paging or identity %j", async (patch) => {
    const fetcher = vi.fn();
    expect(
      await new SelartiRestClient("token", fetcher).getMessages({
        ...query,
        ...patch,
      }),
    ).toEqual({ kind: "error", code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["", "a b", "a\n", "a\u0085"])("rejects invalid bearer", (token) => {
    expect(() => new SelartiRestClient(token, vi.fn())).toThrow(
      "selarti_invalid_input",
    );
  });
  it.each([429, 500, 302, 401])(
    "keeps HTTP %s uncertain without retries",
    async (status) => {
      const fetcher = vi.fn(async () =>
        Response.json(boundEnvelope(), { status }),
      );
      const client = new SelartiRestClient("token", fetcher);
      expect(await client.sendExternal(send)).toEqual({
        kind: "unknown",
        code: "send_unconfirmed",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await client.getMessages(query)).toEqual({
        kind: "error",
        code: "read_failed",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["before_write", "after_write"] as const)(
    "classifies explicit transport phase %s",
    async (phase) => {
      const client = new SelartiRestClient("token", async () => {
        throw new TransportFailure(phase);
      });
      expect(await client.sendExternal(send)).toEqual(
        phase === "before_write"
          ? { kind: "not_applied", code: "before_write" }
          : { kind: "unknown", code: "send_unconfirmed" },
      );
    },
  );
  it.each(["malformed", "envelope"])("bounds invalid body %s", async (mode) => {
    const fetcher = async () =>
      mode === "envelope"
        ? Response.json({ ...boundEnvelope(), status: "error" })
        : new Response("{");
    const client = new SelartiRestClient("token", fetcher);
    expect(await client.sendExternal(send)).toMatchObject({
      kind: "unknown",
    });
    expect(await client.getMessages(query)).toMatchObject({ kind: "error" });
  });
  it.each(["headers", "body", "empty"])(
    "enforces total deadline for stalled %s",
    async (mode) => {
      vi.useFakeTimers();
      let signal: AbortSignal | null | undefined;
      const cancel = vi.fn();
      const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal;
        if (mode === "headers") return new Promise<Response>(() => {});
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (mode === "empty") {
                vi.advanceTimersByTime(1000);
                controller.enqueue(new Uint8Array());
              }
            },
            cancel,
          }),
        );
      });
      const result = new SelartiRestClient("token", fetcher).sendExternal(send);
      await vi.advanceTimersByTimeAsync(15000);
      expect(await result).toMatchObject({ kind: "unknown" });
      expect(signal?.aborted).toBe(true);
      if (mode !== "headers") expect(cancel).toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
