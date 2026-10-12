import { z } from "zod";
import { TransportFailure } from "../http/transport-failure.js";
import type {
  TelegramTransport,
  TelegramTransportResponse,
} from "./telegram-adapter.js";

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z
  .object({
    method: z.literal("POST"),
    url: z.instanceof(URL),
    headers: z
      .object({ "content-type": z.literal("application/json") })
      .strict(),
    body: z
      .object({
        chat_id: z
          .string()
          .regex(/^[1-9][0-9]{0,15}$/u)
          .refine((id) => Number.isSafeInteger(Number(id))),
        text: z
          .string()
          .min(1)
          .max(4096)
          .refine((text) => text.isWellFormed()),
      })
      .strict(),
    context: z
      .object({
        idempotencyKey: z.string().min(1),
        disableRequestLogging: z.literal(true),
      })
      .strict(),
  })
  .strict();
const receiptSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    message_id: safeId,
    from: z.object({ id: safeId, is_bot: z.literal(true) }),
    chat: z.object({ id: safeId, type: z.literal("private") }),
  }),
});
const rejectionSchema = z.object({
  ok: z.literal(false),
  error_code: z.number().int().min(400).max(599),
  parameters: z
    .object({ retry_after: z.number().int().min(0).max(2147483647).optional() })
    .optional(),
});
const uncertain = () => new Error("client_telegram_delivery_uncertain");

/** Input is already capped at 64KiB. Scan before JSON.parse can discard members.
 * Iterative container tracking avoids recursion on deeply nested provider input;
 * JSON.parse still owns complete JSON grammar validation after this scan.
 */
function parseUnambiguousJson(text: string): unknown {
  const containers: (Set<string> | null)[] = [];
  let position = 0;
  while (position < text.length) {
    const character = text[position++];
    if (character === "{") containers.push(new Set<string>());
    else if (character === "[") containers.push(null);
    else if (character === "}") {
      if (!(containers.pop() instanceof Set)) throw uncertain();
    } else if (character === "]") {
      if (containers.pop() !== null) throw uncertain();
    } else if (character === '"') {
      const start = position - 1;
      let closed = false;
      while (position < text.length) {
        const next = text[position++];
        if (next === "\\") position++;
        else if (next === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw uncertain();
      const end = position;
      while (position < text.length && /[\x20\t\r\n]/u.test(text[position]!))
        position++;
      if (text[position] === ":") {
        const names = containers.at(-1);
        if (!(names instanceof Set)) throw uncertain();
        // Parsing this single string decodes escaped-equivalent member names;
        // it cannot collapse any object members.
        const name: string = JSON.parse(text.slice(start, end));
        if (names.has(name)) throw uncertain();
        names.add(name);
      }
    }
  }
  if (containers.length !== 0) throw uncertain();
  return JSON.parse(text) as unknown;
}

/** Plain client sendMessage only. Admission/at-most-one invocation lives in PostgreSQL. */
export function createClientAsyncTelegramTransport(options: {
  token: string;
  fetch?: typeof globalThis.fetch;
}): TelegramTransport {
  if (!/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token))
    throw new Error("client_telegram_configuration_invalid");
  const botId = Number(options.token.split(":")[0]);
  if (!Number.isSafeInteger(botId))
    throw new Error("client_telegram_configuration_invalid");
  const endpoint = `https://api.telegram.org/bot${options.token}/sendMessage`;
  const fetch = options.fetch ?? globalThis.fetch;
  return {
    async request(request) {
      const parsed = requestSchema.safeParse(request);
      if (!parsed.success || parsed.data.url.href !== endpoint)
        throw new Error("client_telegram_request_invalid");
      const input = parsed.data;
      const controller = new AbortController();
      const deadline = performance.now() + 15000;
      const expired = () =>
        controller.signal.aborted || performance.now() >= deadline;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let beforeWrite: TransportFailure | undefined;
      const perform = async (): Promise<TelegramTransportResponse> => {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input.body),
          });
        } catch (error) {
          if (
            !expired() &&
            error instanceof TransportFailure &&
            error.phase === "before_write"
          ) {
            beforeWrite = error;
            throw error;
          }
          throw uncertain();
        }
        if (
          expired() ||
          response.redirected ||
          (response.url !== "" && response.url !== endpoint)
        )
          throw uncertain();
        const length = response.headers.get("content-length");
        if (
          length !== null &&
          (!/^\d+$/u.test(length) || Number(length) > 65536)
        )
          throw uncertain();
        if (!response.body) throw uncertain();
        reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let bytes = 0;
        let text = "";
        for (;;) {
          const chunk = await reader.read();
          if (expired()) throw uncertain();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65536) throw uncertain();
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        if (length !== null && bytes !== Number(length)) throw uncertain();
        const body = parseUnambiguousJson(text);
        if (expired()) throw uncertain();
        if (response.status === 200) {
          const receipt = receiptSchema.safeParse(body);
          if (
            !receipt.success ||
            receipt.data.result.from.id !== botId ||
            String(receipt.data.result.chat.id) !== input.body.chat_id
          )
            throw uncertain();
          return { status: response.status, body };
        }
        const rejection = rejectionSchema.safeParse(body);
        if (
          !rejection.success ||
          rejection.data.error_code !== response.status ||
          (response.status === 429 &&
            rejection.data.parameters?.retry_after === undefined)
        )
          throw uncertain();
        return { status: response.status, body };
      };
      try {
        return await Promise.race([
          perform(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(uncertain());
            }, 15000);
          }),
        ]);
      } catch (error) {
        if (beforeWrite !== undefined && error === beforeWrite && !expired())
          throw beforeWrite;
        throw uncertain();
      } finally {
        clearTimeout(timer);
        controller.abort();
        // A stalled stream must not extend the total deadline during cleanup.
        if (reader) void reader.cancel().catch(() => {});
      }
    },
  };
}
