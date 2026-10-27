import { z } from "zod";
import {
  SelartiRestClient,
  type SelartiExternalSend,
  type SelartiMessagesQuery,
  type SelartiMessagesResult,
  type SelartiRestFetch,
  type SelartiRestSendOutcome,
} from "./rest-client.js";

const BASE_URL = "https://selarti.com/api/1.1/wf/";
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;
const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((value) => value.trim().length > 0 && value.isWellFormed());
const optionsSchema = z.object({
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\p{Cc}]+$/u),
  companyId: identifier,
  taskId: identifier,
  aiId: identifier,
  fetch: z
    .custom<SelartiRestFetch>((value) => typeof value === "function")
    .optional(),
});
const authSchema = z.object({
  status: z.literal("success"),
  response: z.object({
    user: z.object({ active_company: identifier }),
    // HTTP bearer credentials must be representable without header rewriting.
    token: z
      .string()
      .min(1)
      .regex(/^[\x21-\x7e]+$/u),
  }),
});
const taskSchema = z.object({
  status: z.literal("success"),
  response: z.object({
    task: z
      .array(z.object({ _id: identifier, company: identifier, AI: identifier }))
      .length(1),
  }),
});
const aiSchema = z.object({
  status: z.literal("success"),
  response: z.object({
    ai: z.array(z.object({ _id: identifier, company: identifier })).length(1),
  }),
});

export interface AuthenticatedSelartiClientOptions {
  apiKey: string;
  companyId: string;
  taskId: string;
  aiId: string;
  fetch?: SelartiRestFetch;
}
export type AuthenticatedSelartiSend = Pick<
  SelartiExternalSend,
  "chatId" | "text"
>;
export type AuthenticatedSelartiMessagesQuery = Pick<
  SelartiMessagesQuery,
  "threadId" | "limit" | "offset"
>;
export interface AuthenticatedSelartiClient {
  sendExternal(
    command: AuthenticatedSelartiSend,
  ): Promise<SelartiRestSendOutcome>;
  getMessages(
    query: AuthenticatedSelartiMessagesQuery,
  ): Promise<SelartiMessagesResult>;
}
export type AuthenticatedSelartiUnavailableCode =
  | "invalid_input"
  | "authentication_failed"
  | "binding_unverified"
  | "acquisition_failed";
export type AuthenticatedSelartiClientResult =
  | { kind: "ready"; client: AuthenticatedSelartiClient }
  | { kind: "unavailable"; code: AuthenticatedSelartiUnavailableCode };

const unavailable = (
  code: AuthenticatedSelartiUnavailableCode,
): AuthenticatedSelartiClientResult => ({ kind: "unavailable", code });

/** Fresh authentication and ownership proof only; no generation or durable correlation. */
export async function createAuthenticatedSelartiClient(
  options: AuthenticatedSelartiClientOptions,
): Promise<AuthenticatedSelartiClientResult> {
  let config: z.output<typeof optionsSchema>;
  let fetcher: SelartiRestFetch;
  try {
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) return unavailable("invalid_input");
    // Capture primitives and the transport before the first asynchronous boundary.
    config = parsed.data;
    fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  } catch {
    return unavailable("invalid_input");
  }
  const { apiKey, companyId, taskId, aiId } = config;
  const controller = new AbortController();
  const expiresAt = performance.now() + TIMEOUT_MS;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = (reader = activeReader) => {
    if (reader) void reader.cancel().catch(() => {});
  };
  const checkDeadline = () => {
    if (controller.signal.aborted || performance.now() >= expiresAt)
      throw new Error("selarti_acquisition_failed");
  };

  async function request(path: string, token?: string): Promise<unknown> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      checkDeadline();
      const response = await fetcher(`${BASE_URL}${path}`, {
        method: token === undefined ? "POST" : "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(token === undefined
            ? { "Content-Type": "application/json" }
            : { Authorization: `Bearer ${token}` }),
        },
        ...(token === undefined
          ? { body: JSON.stringify({ key: apiKey }) }
          : {}),
      });
      // Fetch implementations that ignore abort can resolve after the factory
      // returns unavailable. Acquire that late reader so finally cancels it too.
      if (response.body) {
        reader = response.body.getReader();
        activeReader = reader;
      }
      checkDeadline();
      if (response.status !== 200 || response.redirected || !reader)
        throw new Error("selarti_acquisition_failed");
      const length = response.headers.get("content-length");
      if (
        length !== null &&
        (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)
      )
        throw new Error("selarti_acquisition_failed");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        checkDeadline();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) throw new Error("selarti_acquisition_failed");
        if (chunk.value.byteLength) chunks.push(chunk.value);
      }
      const raw: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, size),
        ),
      );
      checkDeadline();
      return raw;
    } finally {
      cancel(reader);
      if (activeReader === reader) activeReader = undefined;
    }
  }

  async function acquire(): Promise<AuthenticatedSelartiClientResult> {
    const auth = authSchema.safeParse(await request("auth"));
    checkDeadline();
    if (!auth.success) return unavailable("authentication_failed");
    if (auth.data.response.user.active_company !== companyId)
      return unavailable("binding_unverified");
    const token = auth.data.response.token;
    const task = taskSchema.safeParse(
      await request(
        `get_task?${new URLSearchParams({ company_id: companyId, task_id: taskId })}`,
        token,
      ),
    );
    checkDeadline();
    const selectedTask = task.success ? task.data.response.task[0] : undefined;
    if (
      !selectedTask ||
      selectedTask._id !== taskId ||
      selectedTask.company !== companyId ||
      selectedTask.AI !== aiId
    )
      return unavailable("binding_unverified");
    const ai = aiSchema.safeParse(
      await request(
        `get_ai?${new URLSearchParams({ company_id: companyId, ai_id: aiId })}`,
        token,
      ),
    );
    checkDeadline();
    const selectedAi = ai.success ? ai.data.response.ai[0] : undefined;
    if (
      !selectedAi ||
      selectedAi._id !== aiId ||
      selectedAi.company !== companyId
    )
      return unavailable("binding_unverified");

    const rest = new SelartiRestClient(token, fetcher);
    const client: AuthenticatedSelartiClient = Object.freeze({
      sendExternal: async (
        command: AuthenticatedSelartiSend,
      ): Promise<SelartiRestSendOutcome> => {
        let normalized: SelartiExternalSend;
        try {
          normalized = {
            taskId,
            companyId,
            chatId: command?.chatId,
            text: command?.text,
          };
        } catch {
          return { kind: "not_applied", code: "invalid_input" };
        }
        // Only property access before delegation can prove this local failure.
        return rest.sendExternal(normalized);
      },
      getMessages: async (
        query: AuthenticatedSelartiMessagesQuery,
      ): Promise<SelartiMessagesResult> => {
        let normalized: SelartiMessagesQuery;
        try {
          normalized = {
            taskId,
            companyId,
            threadId: query?.threadId,
            limit: query?.limit,
            offset: query?.offset,
          };
        } catch {
          return { kind: "error", code: "invalid_input" };
        }
        return rest.getMessages(normalized);
      },
    });
    checkDeadline();
    return { kind: "ready", client };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      cancel();
      reject(new Error("selarti_acquisition_failed"));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, acquire()]);
  } catch {
    return unavailable("acquisition_failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
    cancel();
  }
}
