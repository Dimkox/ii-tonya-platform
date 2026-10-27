import { z } from "zod";
import { TransportFailure } from "../http/transport-failure.js";

const BASE_URL = "https://selarti.com/api/1.1/wf/";
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;
const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((value) => value.isWellFormed() && value.trim().length > 0);
const text = z.string().min(1).max(4096);
const sendSchema = z.object({ taskId: id, companyId: id, chatId: id, text });
const querySchema = z.object({
  taskId: id,
  companyId: id,
  threadId: id,
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(10_000),
});
const threadSchema = z.object({ _id: id, task: id, company: id, chat_id: id });
const messageSchema = z.object({
  _id: id,
  thread: id,
  task: id,
  company: id,
  text,
  message_type: id,
  message_status: id,
});
const sendResponse = z.object({
  status: z.literal("success"),
  response: z.object({ thread: threadSchema }),
});
const readResponse = z.object({
  status: z.literal("success"),
  response: z.object({ message: z.array(messageSchema).max(100) }),
});

export type SelartiExternalSend = z.input<typeof sendSchema>;
export type SelartiMessagesQuery = z.input<typeof querySchema>;
export type SelartiRestSendOutcome =
  | { kind: "accepted"; threadId: string }
  | { kind: "not_applied"; code: "invalid_input" | "before_write" }
  | { kind: "unknown"; code: "send_unconfirmed" };
export interface SelartiRestMessage {
  id: string;
  threadId: string;
  taskId: string;
  companyId: string;
  text: string;
  messageType: string;
  messageStatus: string;
}
export type SelartiMessagesResult =
  | { kind: "page"; messages: SelartiRestMessage[] }
  | { kind: "error"; code: "invalid_input" | "read_failed" };
export type SelartiRestFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** Provider transport only: acceptance is neither an AI reply nor internal correlation. */
export class SelartiRestClient {
  readonly #token: string;
  readonly #fetch: SelartiRestFetch;

  constructor(
    bearerToken: string,
    fetcher: SelartiRestFetch = (url, init) => fetch(url, init),
  ) {
    if (
      typeof bearerToken !== "string" ||
      !bearerToken.length ||
      /[^\x21-\x7e]/u.test(bearerToken)
    ) {
      throw new Error("selarti_invalid_input");
    }
    this.#token = bearerToken;
    this.#fetch = fetcher;
  }

  async sendExternal(
    command: SelartiExternalSend,
  ): Promise<SelartiRestSendOutcome> {
    const parsed = sendSchema.safeParse(command);
    if (!parsed.success) return { kind: "not_applied", code: "invalid_input" };
    const value = parsed.data;
    try {
      const raw = await this.request(
        "send_message_external",
        JSON.stringify({
          task_id: value.taskId,
          chat_id: value.chatId,
          message: value.text,
          message_type: "user",
        }),
      );
      const result = sendResponse.safeParse(raw);
      if (result.success) {
        const thread = result.data.response.thread;
        if (
          thread.task === value.taskId &&
          thread.company === value.companyId &&
          thread.chat_id === value.chatId
        ) {
          return { kind: "accepted", threadId: thread._id };
        }
      }
    } catch (error) {
      if (error instanceof TransportFailure && error.phase === "before_write") {
        return { kind: "not_applied", code: "before_write" };
      }
    }
    return { kind: "unknown", code: "send_unconfirmed" };
  }

  async getMessages(
    query: SelartiMessagesQuery,
  ): Promise<SelartiMessagesResult> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) return { kind: "error", code: "invalid_input" };
    const value = parsed.data;
    try {
      const params = new URLSearchParams({
        thread_id: value.threadId,
        limit: String(value.limit),
        offset: String(value.offset),
      });
      const result = readResponse.safeParse(
        await this.request(`get_message?${params}`),
      );
      if (result.success) {
        const rows = result.data.response.message;
        if (
          rows.length <= value.limit &&
          rows.every(
            (row) =>
              row.thread === value.threadId &&
              row.task === value.taskId &&
              row.company === value.companyId,
          )
        ) {
          return {
            kind: "page",
            messages: rows.map((row) => ({
              id: row._id,
              threadId: row.thread,
              taskId: row.task,
              companyId: row.company,
              text: row.text,
              messageType: row.message_type,
              messageStatus: row.message_status,
            })),
          };
        }
      }
    } catch {
      /* Provider diagnostics and identifiers never escape. */
    }
    return { kind: "error", code: "read_failed" };
  }

  private async request(path: string, body?: string): Promise<unknown> {
    const controller = new AbortController();
    const expiresAt = performance.now() + TIMEOUT_MS;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      if (reader) void reader.cancel().catch(() => {});
    };
    const checkDeadline = () => {
      if (controller.signal.aborted || performance.now() >= expiresAt)
        throw new Error("selarti_deadline");
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        cancel();
        reject(new Error("selarti_deadline"));
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          // Only a fetch rejection before receiving headers can prove before_write.
          const response = await this.#fetch(`${BASE_URL}${path}`, {
            method: body === undefined ? "GET" : "POST",
            redirect: "error",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.#token}`,
              ...(body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body }),
          });
          try {
            if (response.body) reader = response.body.getReader();
            checkDeadline();
            if (response.status !== 200 || response.redirected || !reader)
              throw new Error("selarti_response");
            const length = response.headers.get("content-length");
            if (
              length !== null &&
              (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)
            )
              throw new Error("selarti_size");
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
              const chunk = await reader.read();
              checkDeadline();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > MAX_BYTES) throw new Error("selarti_size");
              if (chunk.value.byteLength) chunks.push(chunk.value);
            }
            const result: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks, size),
              ),
            );
            checkDeadline();
            return result;
          } catch {
            throw new Error("selarti_response");
          } finally {
            // A fetch that ignores abort may deliver its body after the outer
            // deadline has already returned. Cancel that late body as well.
            cancel();
          }
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      cancel();
    }
  }
}
