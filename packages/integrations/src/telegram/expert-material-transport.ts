import { createHash } from "node:crypto";
import { z } from "zod";
import { createClientAsyncTelegramTransport } from "./client-async-transport.js";

const id = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/u)
  .refine(
    (v) =>
      Number.isSafeInteger(Number(v)) &&
      /^[1-9][0-9]{0,15}$/u.exec(v)?.[0] === v,
  );
const key = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)
  .refine((v) => !/[\r\n]/u.test(v));
const asset = z
  .object({
    kind: z.enum(["photo", "document"]),
    reference: z
      .string()
      .regex(/^telegram:file:[A-Za-z0-9_-]{1,512}$/u)
      .refine((v) => !/[\r\n]/u.test(v)),
  })
  .strict();
const payload = z
  .object({
    text: z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => v.isWellFormed()),
    assets: z.array(asset).max(8),
  })
  .strict();
const inputSchema = z
  .object({
    botId: id,
    botKey: key,
    userId: z.uuid(),
    chatId: id,
    reviewId: z.uuid(),
    revision: z.number().int().min(1).max(2147483647),
    contentVersion: key,
    payloadDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    payload,
    signal: z.instanceof(AbortSignal),
  })
  .strict();
export type ExpertMaterialSendInput = Omit<
  z.input<typeof inputSchema>,
  "payload"
> & {
  payload: { text: string; assets: readonly z.input<typeof asset>[] };
};
export interface ExpertMaterialReceipt {
  messageIds: readonly string[];
  botId: string;
  chatId: string;
  contentVersion: string;
  payloadDigest: string;
}
export interface ExpertMaterialTransport {
  send(input: ExpertMaterialSendInput): Promise<ExpertMaterialReceipt>;
}
const receiptSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    message_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    from: z.object({
      id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      is_bot: z.literal(true),
    }),
    chat: z.object({
      id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      type: z.literal("private"),
    }),
  }),
});
const uncertain = () => new Error("card_material_delivery_uncertain");

// JSON.parse discards duplicate members. Scan bounded receipt JSON before parsing,
// including escaped-equivalent names, as in the existing strict text transport.
function unambiguousJson(text: string): unknown {
  const containers: (Set<string> | null)[] = [];
  let position = 0;
  while (position < text.length) {
    const character = text[position++];
    if (character === "{") containers.push(new Set());
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
        const name: string = JSON.parse(text.slice(start, end));
        if (names.has(name)) throw uncertain();
        names.add(name);
      }
    }
  }
  if (containers.length !== 0) throw uncertain();
  return JSON.parse(text) as unknown;
}
async function readReceipt(
  response: Response,
  endpoint: string,
  expired: () => boolean,
): Promise<unknown> {
  if (
    expired() ||
    response.status !== 200 ||
    response.redirected ||
    (response.url !== "" && response.url !== endpoint) ||
    !response.body
  )
    throw uncertain();
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 65536))
    throw uncertain();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      if (expired()) throw uncertain();
      const chunk = await reader.read();
      if (expired()) throw uncertain();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) throw uncertain();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (length !== null && bytes !== Number(length)) throw uncertain();
    const body = unambiguousJson(text);
    if (expired()) throw uncertain();
    return body;
  } finally {
    void reader.cancel().catch(() => {});
  }
}
/** Actual fixed-origin Bot API transport. PostgreSQL owns admission, once-only
 * attempts and quarantine. This adapter never retries a package or creates content. */
export function createExpertMaterialTransport(options: {
  token: string;
  botId: string;
  botKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): ExpertMaterialTransport {
  const timeoutMs = options.timeoutMs ?? 7500;
  if (
    /^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.exec(options.token)?.[0] !==
      options.token ||
    !id.safeParse(options.botId).success ||
    options.token.split(":")[0] !== options.botId ||
    !key.safeParse(options.botKey).success ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 8000
  )
    throw new Error("card_material_configuration_invalid");
  const token = options.token,
    botId = options.botId,
    botKey = options.botKey,
    fetcher = options.fetch ?? globalThis.fetch;
  return {
    async send(raw): Promise<ExpertMaterialReceipt> {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) throw new Error("card_material_request_invalid");
      const input = parsed.data;
      const bodyDigest = `sha256:${createHash("sha256").update(JSON.stringify(input.payload)).digest("hex")}`;
      if (
        input.botId !== botId ||
        input.botKey !== botKey ||
        input.payloadDigest !== bodyDigest
      )
        throw new Error("card_material_request_invalid");
      if (input.signal.aborted) throw uncertain();
      const controller = new AbortController();
      const signal = AbortSignal.any([input.signal, controller.signal]);
      const deadline = performance.now() + timeoutMs;
      const expired = () => signal.aborted || performance.now() >= deadline;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const perform = async (): Promise<ExpertMaterialReceipt> => {
        const messageIds: string[] = [];
        const record = (value: unknown) => {
          const result = receiptSchema.safeParse(value);
          if (
            !result.success ||
            String(result.data.result.from.id) !== botId ||
            String(result.data.result.chat.id) !== input.chatId ||
            expired()
          )
            throw uncertain();
          const messageId = String(result.data.result.message_id);
          if (messageIds.includes(messageId)) throw uncertain();
          messageIds.push(messageId);
        };
        const textTransport = createClientAsyncTelegramTransport({
          token,
          fetch: (url, init) => {
            if (expired()) return Promise.reject(uncertain());
            return fetcher(url, {
              ...init,
              signal: AbortSignal.any([
                signal,
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
          },
        });
        if (expired()) throw uncertain();
        const text = await textTransport.request({
          method: "POST",
          url: new URL(`https://api.telegram.org/bot${token}/sendMessage`),
          headers: { "content-type": "application/json" },
          body: { chat_id: input.chatId, text: input.payload.text },
          context: {
            idempotencyKey: `material:${input.reviewId}:${input.contentVersion}:${input.payloadDigest}`,
            disableRequestLogging: true,
          },
        });
        if (text.status !== 200) throw uncertain();
        record(text.body);
        for (const item of input.payload.assets) {
          if (expired()) throw uncertain();
          const method = item.kind === "photo" ? "sendPhoto" : "sendDocument";
          const endpoint = `https://api.telegram.org/bot${token}/${method}`;
          const reference = item.reference.slice("telegram:file:".length);
          const body = JSON.stringify({
            chat_id: input.chatId,
            [item.kind]: reference,
          });
          if (expired()) throw uncertain();
          const response = await fetcher(endpoint, {
            method: "POST",
            redirect: "error",
            signal,
            headers: { "content-type": "application/json" },
            body,
          });
          if (expired()) throw uncertain();
          record(await readReceipt(response, endpoint, expired));
        }
        if (expired() || messageIds.length !== input.payload.assets.length + 1)
          throw uncertain();
        const receipt = Object.freeze({
          messageIds: Object.freeze(messageIds),
          botId,
          chatId: input.chatId,
          contentVersion: input.contentVersion,
          payloadDigest: input.payloadDigest,
        });
        if (expired()) throw uncertain();
        return receipt;
      };
      const cancelled = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(uncertain());
          },
          Math.max(0, deadline - performance.now()),
        );
        if (signal.aborted) reject(uncertain());
        else
          signal.addEventListener("abort", () => reject(uncertain()), {
            once: true,
          });
      });
      try {
        const receipt = await Promise.race([perform(), cancelled]);
        if (expired()) throw uncertain();
        return receipt;
      } catch {
        throw uncertain();
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
