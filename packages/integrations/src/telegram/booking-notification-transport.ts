import { z } from "zod";
import { createHash } from "node:crypto";
import { serializeBookingNotificationWire } from "@ii-tonya/contracts";
import { TransportFailure } from "../http/transport-failure.js";

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const button = z
  .object({
    text: z.string().min(1).max(64),
    callback_data: z.string().regex(/^ct2\.[A-Za-z0-9_-]{44}$/u),
  })
  .strict();
const requestSchema = z
  .object({
    botKey: z.string(),
    chatId: z
      .string()
      .regex(/^[1-9][0-9]{0,15}$/u)
      .refine((id) => Number.isSafeInteger(Number(id))),
    text: z
      .string()
      .min(1)
      .max(4096)
      .refine((text) => text.isWellFormed()),
    deadline: z.string().datetime({ offset: true }),
    replyMarkup: z
      .object({ inline_keyboard: z.tuple([z.tuple([button, button])]) })
      .strict()
      .nullish(),
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
  error_code: z.number().int(),
  parameters: z
    .object({ retry_after: z.number().int().min(0).max(2147483647) })
    .optional(),
});
const unknown = (): BookingNotificationHttpOutcome => ({
  kind: "unknown",
  reasonCode: "delivery_uncertain",
});

export interface BookingNotificationHttpRequest {
  botKey: string;
  chatId: string;
  text: string;
  deadline: string;
  replyMarkup?: unknown;
}
export type BookingNotificationHttpOutcome =
  | {
      kind: "applied";
      receipt: { botKey: string; chatId: string; messageId: number };
    }
  | { kind: "not_applied"; retryAfterSeconds?: number }
  | { kind: "failed"; reasonCode: string; pauseBot: boolean }
  | { kind: "unknown"; reasonCode: string; pauseBot?: true };

export function createBookingNotificationTransport(options: {
  botKey: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(options.botKey) ||
    !/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,200}$/u.test(options.token)
  ) {
    throw new Error("booking_notification_configuration_invalid");
  }
  const botId = Number(options.token.split(":")[0]);
  if (!Number.isSafeInteger(botId))
    throw new Error("booking_notification_configuration_invalid");
  const botKey = options.botKey;
  const endpoint = `https://api.telegram.org/bot${options.token}/sendMessage`;
  const fetch = options.fetch ?? globalThis.fetch;
  const send = async (
    request: BookingNotificationHttpRequest,
    preparedBody?: string,
  ): Promise<BookingNotificationHttpOutcome> => {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success || parsed.data.botKey !== botKey)
      return {
        kind: "failed",
        reasonCode: "request_invalid",
        pauseBot: false,
      };
    const input = parsed.data;
    const duration = Math.min(15000, Date.parse(input.deadline) - Date.now());
    if (!(duration > 0))
      return {
        kind: "failed",
        reasonCode: "request_expired",
        pauseBot: false,
      };
    const controller = new AbortController();
    const end = performance.now() + duration;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = () => controller.signal.aborted || performance.now() >= end;
    const perform = async (): Promise<BookingNotificationHttpOutcome> => {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body:
            preparedBody ??
            JSON.stringify({
              chat_id: input.chatId,
              text: input.text,
              ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
            }),
        });
      } catch (error) {
        // Only the fetch boundary can attest that no request was written.
        if (
          !expired() &&
          error instanceof TransportFailure &&
          error.phase === "before_write"
        )
          return { kind: "not_applied" };
        return unknown();
      }
      if (
        expired() ||
        response.redirected ||
        (response.url !== "" && response.url !== endpoint)
      )
        return unknown();
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 65536))
        return unknown();
      if (!response.body) return unknown();
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let text = "";
      for (;;) {
        const chunk = await reader.read();
        if (expired()) return unknown();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 65536) return unknown();
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const body: unknown = JSON.parse(text);
      if (expired()) return unknown();
      if (response.status === 200) {
        const receipt = receiptSchema.safeParse(body);
        if (!receipt.success) return unknown();
        if (receipt.data.result.from.id !== botId)
          return {
            kind: "unknown",
            reasonCode: "bot_mismatch",
            pauseBot: true,
          };
        if (String(receipt.data.result.chat.id) !== input.chatId)
          return unknown();
        return {
          kind: "applied",
          receipt: {
            botKey,
            chatId: input.chatId,
            messageId: receipt.data.result.message_id,
          },
        };
      }
      const rejection = rejectionSchema.safeParse(body);
      if (!rejection.success || rejection.data.error_code !== response.status)
        return unknown();
      if (response.status === 429 && rejection.data.parameters)
        return {
          kind: "not_applied",
          retryAfterSeconds: rejection.data.parameters.retry_after,
        };
      if ([400, 401, 403].includes(response.status))
        return {
          kind: "failed",
          reasonCode:
            response.status === 401 ? "bot_rejected" : "recipient_rejected",
          pauseBot: response.status === 401,
        };
      return unknown();
    };
    try {
      const timeout = new Promise<BookingNotificationHttpOutcome>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(unknown());
        }, duration);
      });
      return await Promise.race([perform().catch(unknown), timeout]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Never let an uncooperative stream's cancel promise extend the deadline.
      if (reader) void reader.cancel().catch(() => {});
    }
  };
  return {
    send: (request: BookingNotificationHttpRequest) => send(request),
    async sendPrepared(grant: {
      attemptId: string;
      deliveryId: string;
      botKey: string;
      chatId: string;
      deadline: string;
      wireVersion: 1;
      body: string;
      bodySha256: string;
    }): Promise<BookingNotificationHttpOutcome> {
      const invalid: BookingNotificationHttpOutcome = {
        kind: "failed",
        reasonCode: "request_invalid",
        pauseBot: false,
      };
      try {
        if (
          grant.wireVersion !== 1 ||
          grant.botKey !== botKey ||
          typeof grant.body !== "string" ||
          Buffer.byteLength(grant.body, "utf8") > 32768 ||
          createHash("sha256").update(grant.body, "utf8").digest("hex") !==
            grant.bodySha256
        )
          return invalid;
        const raw: unknown = JSON.parse(grant.body);
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          return invalid;
        const value = raw as Record<string, unknown>;
        if (
          Object.keys(value).some(
            (k) => !["chat_id", "text", "reply_markup"].includes(k),
          ) ||
          value.chat_id !== grant.chatId
        )
          return invalid;
        const request = {
          botKey: grant.botKey,
          chatId: grant.chatId,
          text: value.text,
          deadline: grant.deadline,
          replyMarkup: value.reply_markup,
        };
        const parsed = requestSchema.safeParse(request);
        if (
          !parsed.success ||
          serializeBookingNotificationWire({
            chatId: parsed.data.chatId,
            text: parsed.data.text,
            replyMarkup: parsed.data.replyMarkup,
          }) !== grant.body
        )
          return invalid;
        return send(parsed.data, grant.body);
      } catch {
        return invalid;
      }
    },
  };
}
