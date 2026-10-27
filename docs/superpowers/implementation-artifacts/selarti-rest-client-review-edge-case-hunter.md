Read `/home/pall/projects/ii-tonya-base/work/ii-tonya-platform/_bmad/render/bmad-build/ii-tonya-platform-6c5ac46dca1e/8214d9cc5a480f41295a/review-prompts/edge-case-hunter.md` completely and follow it as your review instructions.

Review content:

diff --git a/packages/integrations/src/index.ts b/packages/integrations/src/index.ts
index 621625b5..453d1a5b 100644
--- a/packages/integrations/src/index.ts
+++ b/packages/integrations/src/index.ts
@@ -229,3 +229,12 @@ export {
   type ExpertTelegramCheckoutPrincipal,
   type ExpertTelegramCheckoutResult,
 } from "./telegram/expert-residency-checkout.js";
+export {
+  SelartiRestClient,
+  type SelartiExternalSend,
+  type SelartiMessagesQuery,
+  type SelartiRestSendOutcome,
+  type SelartiRestMessage,
+  type SelartiMessagesResult,
+  type SelartiRestFetch,
+} from "./selarti/rest-client.js";
diff --git a/packages/integrations/src/selarti/rest-client.ts b/packages/integrations/src/selarti/rest-client.ts
new file mode 100644
index 00000000..4832c410
--- /dev/null
+++ b/packages/integrations/src/selarti/rest-client.ts
@@ -0,0 +1,244 @@
+import { z } from "zod";
+import { TransportFailure } from "../http/transport-failure.js";
+
+const BASE_URL = "https://selarti.com/api/1.1/wf/";
+const MAX_BYTES = 64 * 1024;
+const TIMEOUT_MS = 15_000;
+const id = z
+  .string()
+  .min(1)
+  .max(256)
+  .regex(/^[^\p{Cc}]+$/u);
+const text = z.string().min(1).max(4096);
+const sendSchema = z.object({ taskId: id, companyId: id, chatId: id, text });
+const querySchema = z.object({
+  taskId: id,
+  companyId: id,
+  threadId: id,
+  limit: z.number().int().min(1).max(100),
+  offset: z.number().int().min(0).max(10_000),
+});
+const threadSchema = z.object({ _id: id, task: id, company: id, chat_id: id });
+const messageSchema = z.object({
+  _id: id,
+  thread: id,
+  task: id,
+  company: id,
+  text,
+  message_type: id,
+  message_status: id,
+});
+const sendResponse = z.object({
+  status: z.literal("success"),
+  response: z.object({ thread: threadSchema }),
+});
+const readResponse = z.object({
+  status: z.literal("success"),
+  response: z.object({ message: z.array(messageSchema).max(100) }),
+});
+
+export type SelartiExternalSend = z.input<typeof sendSchema>;
+export type SelartiMessagesQuery = z.input<typeof querySchema>;
+export type SelartiRestSendOutcome =
+  | { kind: "accepted"; threadId: string }
+  | { kind: "not_applied"; code: "invalid_input" | "before_write" }
+  | { kind: "unknown"; code: "send_unconfirmed" };
+export interface SelartiRestMessage {
+  id: string;
+  threadId: string;
+  taskId: string;
+  companyId: string;
+  text: string;
+  messageType: string;
+  messageStatus: string;
+}
+export type SelartiMessagesResult =
+  | { kind: "page"; messages: SelartiRestMessage[] }
+  | { kind: "error"; code: "invalid_input" | "read_failed" };
+export type SelartiRestFetch = (
+  url: string,
+  init: RequestInit,
+) => Promise<Response>;
+
+/** Provider transport only: acceptance is neither an AI reply nor internal correlation. */
+export class SelartiRestClient {
+  readonly #token: string;
+  readonly #fetch: SelartiRestFetch;
+
+  constructor(
+    bearerToken: string,
+    fetcher: SelartiRestFetch = (url, init) => fetch(url, init),
+  ) {
+    if (
+      typeof bearerToken !== "string" ||
+      !bearerToken.length ||
+      /[\s\p{Cc}]/u.test(bearerToken)
+    ) {
+      throw new Error("selarti_invalid_input");
+    }
+    this.#token = bearerToken;
+    this.#fetch = fetcher;
+  }
+
+  async sendExternal(
+    command: SelartiExternalSend,
+  ): Promise<SelartiRestSendOutcome> {
+    const parsed = sendSchema.safeParse(command);
+    if (!parsed.success) return { kind: "not_applied", code: "invalid_input" };
+    const value = parsed.data;
+    try {
+      const raw = await this.request(
+        "send_message_external",
+        JSON.stringify({
+          task_id: value.taskId,
+          chat_id: value.chatId,
+          message: value.text,
+          message_type: "user",
+        }),
+      );
+      const result = sendResponse.safeParse(raw);
+      if (result.success) {
+        const thread = result.data.response.thread;
+        if (
+          thread.task === value.taskId &&
+          thread.company === value.companyId &&
+          thread.chat_id === value.chatId
+        ) {
+          return { kind: "accepted", threadId: thread._id };
+        }
+      }
+    } catch (error) {
+      if (error instanceof TransportFailure && error.phase === "before_write") {
+        return { kind: "not_applied", code: "before_write" };
+      }
+    }
+    return { kind: "unknown", code: "send_unconfirmed" };
+  }
+
+  async getMessages(
+    query: SelartiMessagesQuery,
+  ): Promise<SelartiMessagesResult> {
+    const parsed = querySchema.safeParse(query);
+    if (!parsed.success) return { kind: "error", code: "invalid_input" };
+    const value = parsed.data;
+    try {
+      const params = new URLSearchParams({
+        thread_id: value.threadId,
+        limit: String(value.limit),
+        offset: String(value.offset),
+      });
+      const result = readResponse.safeParse(
+        await this.request(`get_message?${params}`),
+      );
+      if (result.success) {
+        const rows = result.data.response.message;
+        if (
+          rows.length <= value.limit &&
+          rows.every(
+            (row) =>
+              row.thread === value.threadId &&
+              row.task === value.taskId &&
+              row.company === value.companyId,
+          )
+        ) {
+          return {
+            kind: "page",
+            messages: rows.map((row) => ({
+              id: row._id,
+              threadId: row.thread,
+              taskId: row.task,
+              companyId: row.company,
+              text: row.text,
+              messageType: row.message_type,
+              messageStatus: row.message_status,
+            })),
+          };
+        }
+      }
+    } catch {
+      /* Provider diagnostics and identifiers never escape. */
+    }
+    return { kind: "error", code: "read_failed" };
+  }
+
+  private async request(path: string, body?: string): Promise<unknown> {
+    const controller = new AbortController();
+    const expiresAt = performance.now() + TIMEOUT_MS;
+    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
+    const cancel = () => {
+      if (reader) void reader.cancel().catch(() => {});
+    };
+    const checkDeadline = () => {
+      if (controller.signal.aborted || performance.now() >= expiresAt)
+        throw new Error("selarti_deadline");
+    };
+    let timer: ReturnType<typeof setTimeout> | undefined;
+    const deadline = new Promise<never>((_resolve, reject) => {
+      timer = setTimeout(() => {
+        controller.abort();
+        cancel();
+        reject(new Error("selarti_deadline"));
+      }, TIMEOUT_MS);
+    });
+    try {
+      return await Promise.race([
+        deadline,
+        (async () => {
+          // Only a fetch rejection before receiving headers can prove before_write.
+          const response = await this.#fetch(`${BASE_URL}${path}`, {
+            method: body === undefined ? "GET" : "POST",
+            redirect: "error",
+            signal: controller.signal,
+            headers: {
+              Accept: "application/json",
+              Authorization: `Bearer ${this.#token}`,
+              ...(body === undefined
+                ? {}
+                : { "Content-Type": "application/json" }),
+            },
+            ...(body === undefined ? {} : { body }),
+          });
+          try {
+            if (response.body) reader = response.body.getReader();
+            checkDeadline();
+            if (response.status !== 200 || response.redirected || !reader)
+              throw new Error("selarti_response");
+            const length = response.headers.get("content-length");
+            if (
+              length !== null &&
+              (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)
+            )
+              throw new Error("selarti_size");
+            const chunks: Uint8Array[] = [];
+            let size = 0;
+            while (true) {
+              const chunk = await reader.read();
+              checkDeadline();
+              if (chunk.done) break;
+              size += chunk.value.byteLength;
+              if (size > MAX_BYTES) throw new Error("selarti_size");
+              if (chunk.value.byteLength) chunks.push(chunk.value);
+            }
+            const result: unknown = JSON.parse(
+              new TextDecoder("utf-8", { fatal: true }).decode(
+                Buffer.concat(chunks, size),
+              ),
+            );
+            checkDeadline();
+            return result;
+          } catch {
+            throw new Error("selarti_response");
+          } finally {
+            // A fetch that ignores abort may deliver its body after the outer
+            // deadline has already returned. Cancel that late body as well.
+            cancel();
+          }
+        })(),
+      ]);
+    } finally {
+      clearTimeout(timer);
+      controller.abort();
+      cancel();
+    }
+  }
+}
diff --git a/packages/integrations/src/selarti/rest-client.test.ts b/packages/integrations/src/selarti/rest-client.test.ts
new file mode 100644
index 00000000..5c5885cd
--- /dev/null
+++ b/packages/integrations/src/selarti/rest-client.test.ts
@@ -0,0 +1,321 @@
+import { afterEach, describe, expect, it, vi } from "vitest";
+import { TransportFailure } from "../http/transport-failure.js";
+import { SelartiRestClient } from "./rest-client.js";
+
+const send = {
+  taskId: "task",
+  companyId: "company",
+  chatId: "chat",
+  text: "Hello",
+};
+const query = {
+  taskId: "task",
+  companyId: "company",
+  threadId: "thread",
+  limit: 10,
+  offset: 0,
+};
+const thread = {
+  _id: "thread",
+  task: "task",
+  company: "company",
+  chat_id: "chat",
+};
+const message = {
+  _id: "message",
+  thread: "thread",
+  task: "task",
+  company: "company",
+  text: "Hello",
+  message_type: "bot",
+  message_status: "pending",
+};
+const response = (value: unknown) =>
+  Response.json({ status: "success", response: value });
+afterEach(() => vi.useRealTimers());
+
+describe("Selarti native REST client", () => {
+  it("cancels a body arriving after timeout even when fetch ignores abort", async () => {
+    vi.useFakeTimers();
+    let deliver!: (response: Response) => void;
+    const cancel = vi.fn();
+    const client = new SelartiRestClient(
+      "token",
+      () =>
+        new Promise<Response>((resolve) => {
+          deliver = resolve;
+        }),
+    );
+    const pending = client.sendExternal(send);
+    await vi.advanceTimersByTimeAsync(15000);
+    expect(await pending).toMatchObject({ kind: "unknown" });
+    deliver(new Response(new ReadableStream({ cancel })));
+    await vi.advanceTimersByTimeAsync(0);
+    expect(cancel).toHaveBeenCalledTimes(1);
+  });
+  it("does not classify a body failure as before-write", async () => {
+    const client = new SelartiRestClient(
+      "token",
+      async () =>
+        new Response(
+          new ReadableStream({
+            start(controller) {
+              controller.error(new TransportFailure("before_write"));
+            },
+          }),
+        ),
+    );
+    expect(await client.sendExternal(send)).toMatchObject({ kind: "unknown" });
+  });
+  it("accepts empty pages and rejects more rows than requested", async () => {
+    expect(
+      await new SelartiRestClient("token", async () =>
+        response({ message: [] }),
+      ).getMessages(query),
+    ).toEqual({ kind: "page", messages: [] });
+    expect(
+      await new SelartiRestClient("token", async () =>
+        response({ message: [message, message] }),
+      ).getMessages({ ...query, limit: 1 }),
+    ).toMatchObject({ kind: "error" });
+  });
+  it("accepts input boundaries and encodes query identifiers", async () => {
+    const fetcher = vi.fn(async () => response({ message: [] }));
+    const client = new SelartiRestClient("token", fetcher);
+    expect(
+      await client.getMessages({
+        ...query,
+        threadId: "a&b",
+        limit: 100,
+        offset: 10000,
+      }),
+    ).toMatchObject({ kind: "page" });
+    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(
+      "https://selarti.com/api/1.1/wf/get_message?thread_id=a%26b&limit=100&offset=10000",
+    );
+    const longId = "a".repeat(256);
+    const sender = new SelartiRestClient("token", async () =>
+      response({ thread: { ...thread, task: longId } }),
+    );
+    expect(
+      await sender.sendExternal({
+        ...send,
+        taskId: longId,
+        text: "x".repeat(4096),
+      }),
+    ).toMatchObject({ kind: "accepted" });
+  });
+  it("times out stalled reads without exposing transport details", async () => {
+    vi.useFakeTimers();
+    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
+    const pending = new SelartiRestClient("token", fetcher).getMessages(query);
+    await vi.advanceTimersByTimeAsync(15000);
+    expect(await pending).toEqual({ kind: "error", code: "read_failed" });
+    expect(fetcher).toHaveBeenCalledTimes(1);
+  });
+  it("sends once using the documented external-send contract", async () => {
+    const fetcher = vi.fn(async () =>
+      response({ thread: { ...thread, secret_metadata: "ignored" } }),
+    );
+    expect(
+      await new SelartiRestClient("synthetic-token", fetcher).sendExternal(
+        send,
+      ),
+    ).toEqual({ kind: "accepted", threadId: "thread" });
+    expect(fetcher).toHaveBeenCalledTimes(1);
+    const [url, init] = fetcher.mock.calls[0] as unknown as [
+      string,
+      RequestInit,
+    ];
+    expect(url).toBe("https://selarti.com/api/1.1/wf/send_message_external");
+    expect(init).toMatchObject({
+      method: "POST",
+      redirect: "error",
+      headers: { Authorization: "Bearer synthetic-token" },
+    });
+    expect(JSON.parse(init.body as string)).toEqual({
+      task_id: "task",
+      chat_id: "chat",
+      message: "Hello",
+      message_type: "user",
+    });
+  });
+  it.each(["task", "company", "chat_id", "_id"])(
+    "rejects foreign or missing acceptance %s",
+    async (key) => {
+      const fetcher = vi.fn(async () =>
+        response({
+          thread: { ...thread, [key]: key === "_id" ? "" : "foreign" },
+        }),
+      );
+      expect(
+        await new SelartiRestClient("token", fetcher).sendExternal(send),
+      ).toMatchObject({ kind: "unknown" });
+      expect(fetcher).toHaveBeenCalledTimes(1);
+    },
+  );
+  it("reads normalized messages without completion or pagination claims", async () => {
+    const fetcher = vi.fn(async () =>
+      response({ message: [{ ...message, extra: "ignored" }] }),
+    );
+    expect(
+      await new SelartiRestClient("token", fetcher).getMessages(query),
+    ).toEqual({
+      kind: "page",
+      messages: [
+        {
+          id: "message",
+          threadId: "thread",
+          taskId: "task",
+          companyId: "company",
+          text: "Hello",
+          messageType: "bot",
+          messageStatus: "pending",
+        },
+      ],
+    });
+    const [url, init] = fetcher.mock.calls[0] as unknown as [
+      string,
+      RequestInit,
+    ];
+    expect(url).toBe(
+      "https://selarti.com/api/1.1/wf/get_message?thread_id=thread&limit=10&offset=0",
+    );
+    expect(init.method).toBe("GET");
+  });
+  it.each([
+    "thread",
+    "task",
+    "company",
+    "_id",
+    "message_type",
+    "message_status",
+    "text",
+  ])("rejects entire page for invalid %s", async (key) => {
+    const bad = {
+      ...message,
+      [key]: ["thread", "task", "company"].includes(key) ? "foreign" : null,
+    };
+    const client = new SelartiRestClient("token", async () =>
+      response({ message: [message, bad] }),
+    );
+    expect(await client.getMessages(query)).toEqual({
+      kind: "error",
+      code: "read_failed",
+    });
+  });
+  it.each([
+    { taskId: "" },
+    { companyId: "x\n" },
+    { chatId: "x".repeat(257) },
+    { text: "" },
+    { text: "x".repeat(4097) },
+  ])("rejects invalid send input before HTTP %j", async (patch) => {
+    const fetcher = vi.fn();
+    expect(
+      await new SelartiRestClient("token", fetcher).sendExternal({
+        ...send,
+        ...patch,
+      }),
+    ).toEqual({ kind: "not_applied", code: "invalid_input" });
+    expect(fetcher).not.toHaveBeenCalled();
+  });
+  it.each([
+    { limit: 0 },
+    { limit: 101 },
+    { limit: 1.5 },
+    { offset: -1 },
+    { offset: 10001 },
+    { offset: 0.5 },
+    { threadId: "\u007f" },
+  ])("rejects invalid paging or identity %j", async (patch) => {
+    const fetcher = vi.fn();
+    expect(
+      await new SelartiRestClient("token", fetcher).getMessages({
+        ...query,
+        ...patch,
+      }),
+    ).toEqual({ kind: "error", code: "invalid_input" });
+    expect(fetcher).not.toHaveBeenCalled();
+  });
+  it.each(["", "a b", "a\n", "a\u0085"])("rejects invalid bearer", (token) => {
+    expect(() => new SelartiRestClient(token, vi.fn())).toThrow(
+      "selarti_invalid_input",
+    );
+  });
+  it.each([429, 500, 302, 401])(
+    "keeps HTTP %s uncertain without retries",
+    async (status) => {
+      const fetcher = vi.fn(async () => new Response("private", { status }));
+      const client = new SelartiRestClient("token", fetcher);
+      expect(await client.sendExternal(send)).toEqual({
+        kind: "unknown",
+        code: "send_unconfirmed",
+      });
+      expect(fetcher).toHaveBeenCalledTimes(1);
+      expect(await client.getMessages(query)).toEqual({
+        kind: "error",
+        code: "read_failed",
+      });
+      expect(fetcher).toHaveBeenCalledTimes(2);
+    },
+  );
+  it.each(["before_write", "after_write"] as const)(
+    "classifies explicit transport phase %s",
+    async (phase) => {
+      const client = new SelartiRestClient("token", async () => {
+        throw new TransportFailure(phase);
+      });
+      expect(await client.sendExternal(send)).toEqual(
+        phase === "before_write"
+          ? { kind: "not_applied", code: "before_write" }
+          : { kind: "unknown", code: "send_unconfirmed" },
+      );
+    },
+  );
+  it.each(["malformed", "oversized", "declared", "envelope"])(
+    "bounds invalid body %s",
+    async (mode) => {
+      const fetcher = async () =>
+        mode === "envelope"
+          ? Response.json({ status: "error", response: { thread } })
+          : new Response(mode === "oversized" ? "x".repeat(65537) : "{", {
+              headers: mode === "declared" ? { "content-length": "65537" } : {},
+            });
+      const client = new SelartiRestClient("token", fetcher);
+      expect(await client.sendExternal(send)).toMatchObject({
+        kind: "unknown",
+      });
+      expect(await client.getMessages(query)).toMatchObject({ kind: "error" });
+    },
+  );
+  it.each(["headers", "body", "empty"])(
+    "enforces total deadline for stalled %s",
+    async (mode) => {
+      vi.useFakeTimers();
+      let signal: AbortSignal | null | undefined;
+      const cancel = vi.fn();
+      const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
+        signal = init.signal;
+        if (mode === "headers") return new Promise<Response>(() => {});
+        return new Response(
+          new ReadableStream<Uint8Array>({
+            pull(controller) {
+              if (mode === "empty") {
+                vi.advanceTimersByTime(1000);
+                controller.enqueue(new Uint8Array());
+              }
+            },
+            cancel,
+          }),
+        );
+      });
+      const result = new SelartiRestClient("token", fetcher).sendExternal(send);
+      await vi.advanceTimersByTimeAsync(15000);
+      expect(await result).toMatchObject({ kind: "unknown" });
+      expect(signal?.aborted).toBe(true);
+      if (mode !== "headers") expect(cancel).toHaveBeenCalled();
+      expect(fetcher).toHaveBeenCalledTimes(1);
+    },
+  );
+});
diff --git a/docs/runbooks/selarti-rest-client.md b/docs/runbooks/selarti-rest-client.md
new file mode 100644
index 00000000..5edc9cc8
--- /dev/null
+++ b/docs/runbooks/selarti-rest-client.md
@@ -0,0 +1,21 @@
+# Selarti native REST client
+
+`SelartiRestClient` accepts a server-supplied bearer token and optional fetch
+implementation. It sends user messages through `sendExternal` and reads bound
+message pages through `getMessages`. The origin is fixed to HTTPS selarti.com.
+Every request has a total 15-second deadline and a 64 KiB response limit.
+
+`accepted` means only that the returned thread matches task/company/chat.
+It is not an AI response. `unknown` must be reconciled without resending.
+Only local invalid input or an injected transport's `before_write` failure yields
+`not_applied`; the caller owns any bounded retry policy. HTTP errors, including
+429, do not prove non-application. Reads never retry and reject the entire page
+if any row is malformed or foreign. Message type/status are uninterpreted values;
+pages make no ordering, exhaustion, or request-response correlation guarantee.
+
+Authentication token acquisition/refresh remains the trusted caller's responsibility.
+Before activation, implement a durable polling bridge binding internal request,
+dialogue and tenant to provider task/chat/thread/message. Preserve consent/cost
+admission, response deadlines, copy/URL checks and internal requestId/threadId
+validation. Existing disabled startup guards remain in force. No live generation,
+provider configuration, runtime composition or database change is part of this client.


Do not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.
