import type { ResidentDocument } from "@ii-tonya/application";
import { createWindowedRateLimiter } from "../rate-limit.js";
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ExpertApplicantService } from "@ii-tonya/application";
export interface ExpertApplicantTelegramCapability {
  verificationFormEnabled?: boolean;
  separatedSalesEnabled?: boolean;
  earlyBirdEnabled?: boolean;
  /** Opaque authority identity; validated by the composition, never by bot input. */
  earlyBirdAuthority?: unknown;
  botId: string;
  botKey: string;
  webhookSecret: string;
  service: Pick<ExpertApplicantService, "handle">;
}
const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const identity = (v: unknown): string | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
export const expertApplicantTelegramRoutes: FastifyPluginAsync<{
  enabled: boolean;
  capability?: ExpertApplicantTelegramCapability;
}> = async (app, deps) => {
  if (!deps.enabled) return;
  const c = deps.capability;
  if (
    !c ||
    (c.earlyBirdEnabled === true && c.separatedSalesEnabled !== true) ||
    !/^[1-9]\d{0,15}$/u.test(c.botId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(c.botKey) ||
    c.webhookSecret.length < 16
  )
    throw new Error("expert_applicant_capability_required");
  const limiter = createWindowedRateLimiter();
  app.post<{ Params: { botKey: string } }>(
    "/v1/webhooks/telegram/expert-promo/:botKey",
    {
      bodyLimit: 16384,
      preHandler: async (req, reply) => {
        if (!limiter.consume(`promo:unauth:${req.ip}`, 100, 60_000))
          return reply.code(429).send({ error: "rate_limited" });
        if (
          !equal(
            req.headers["x-telegram-bot-api-secret-token"],
            c.webhookSecret,
          ) ||
          !equal(req.params.botKey, c.botKey)
        )
          return reply.code(401).send({ error: "unauthorized" });
      },
      errorHandler: (_error, _req, reply) =>
        reply.code(503).send({ error: "expert_applicant_unavailable" }),
    },
    async (req, reply) => {
      const body = req.body as Record<string, unknown> | null;
      const callback = body?.callback_query as
        Record<string, unknown> | undefined;
      const message = (callback?.message ?? body?.message) as
        Record<string, unknown> | undefined;
      const from = (callback?.from ?? message?.from) as
        Record<string, unknown> | undefined;
      const chat = message?.chat as Record<string, unknown> | undefined;
      const userId = identity(from?.id),
        chatId = identity(chat?.id);
      let text = "";
      let callbackData: string | undefined;
      let media: ResidentDocument | undefined;
      let correction: string | undefined;
      if (
        !body ||
        !Number.isSafeInteger(body.update_id) ||
        Number(body.update_id) < 0 ||
        !userId ||
        userId !== chatId ||
        from?.is_bot === true ||
        (from?.is_bot !== undefined && typeof from.is_bot !== "boolean") ||
        chat?.type !== "private"
      )
        return reply.code(400).send({ error: "invalid_update" });
      if (callback) {
        const origin = message?.from as Record<string, unknown> | undefined;
        if (
          body.message !== undefined ||
          typeof callback.id !== "string" ||
          callback.id.length > 128 ||
          origin?.is_bot !== true ||
          identity(origin.id) !== c.botId ||
          typeof callback.data !== "string" ||
          Buffer.byteLength(callback.data) > 64 ||
          !(
            callback.data.startsWith("rv:") ||
            (c.separatedSalesEnabled === true &&
              callback.data === "st:current") ||
            (c.separatedSalesEnabled && /^(ss|sb):/u.test(callback.data)) ||
            (c.earlyBirdEnabled === true && /^(?:eb|ep):/u.test(callback.data))
          )
        )
          return reply.code(400).send({ error: "invalid_update" });
        callbackData = callback.data;
        if (!c.verificationFormEnabled && callback.data.startsWith("rv:"))
          correction =
            "Форма временно недоступна. Сохранённые ответы не изменены; старую кнопку применять не нужно.";
      } else {
        const kinds = [
          message?.text !== undefined,
          message?.photo !== undefined,
          message?.document !== undefined,
          message?.video !== undefined,
        ].filter(Boolean).length;
        if (kinds !== 1)
          return reply.code(400).send({ error: "invalid_update" });
        if (message?.text !== undefined) {
          if (typeof message.text !== "string" || message.text.length < 1)
            return reply.code(400).send({ error: "invalid_update" });
          if (
            message.text.length > (c.verificationFormEnabled ? 3000 : 256) ||
            /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(message.text) ||
            (!c.verificationFormEnabled && /[\r\n\t]/u.test(message.text))
          ) {
            if (!c.verificationFormEnabled)
              return reply.code(400).send({ error: "invalid_update" });
            correction =
              "Ответ слишком длинный или содержит неподдерживаемые символы. Отправьте до 3000 символов. Сохранённые ответы не изменены.";
          }
          text = message.text;
        } else {
          if (!c.verificationFormEnabled)
            correction =
              "Форма временно недоступна. Сохранённые ответы не изменены.";
          const photo = message?.photo;
          if (
            photo !== undefined &&
            (!Array.isArray(photo) ||
              photo.length < 1 ||
              photo.length > 10 ||
              photo.some(
                (p) =>
                  !p ||
                  typeof p !== "object" ||
                  typeof p.file_id !== "string" ||
                  !/^[A-Za-z0-9_-]{1,512}$/u.test(p.file_id),
              ))
          )
            return reply.code(400).send({ error: "invalid_update" });
          const file = (
            photo !== undefined
              ? (photo as Record<string, unknown>[]).at(-1)
              : (message?.document ?? message?.video)
          ) as Record<string, unknown> | undefined;
          const mimeType =
            photo !== undefined ? null : (file?.mime_type ?? null);
          if (
            !file ||
            typeof file.file_id !== "string" ||
            !/^[A-Za-z0-9_-]{1,512}$/u.test(file.file_id) ||
            (mimeType !== null && typeof mimeType !== "string") ||
            (file.file_size !== undefined &&
              (!Number.isSafeInteger(file.file_size) ||
                Number(file.file_size) < 0)) ||
            (message?.caption !== undefined &&
              typeof message.caption !== "string")
          )
            return reply.code(400).send({ error: "invalid_update" });
          if (
            (mimeType !== null &&
              ![
                "application/pdf",
                "image/jpeg",
                "image/png",
                "video/mp4",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ].includes(mimeType)) ||
            (file.file_size !== undefined &&
              (Number(file.file_size) < 1 || Number(file.file_size) > 20971520))
          )
            correction =
              "Этот формат или размер файла не подходит. Пришлите PDF/DOCX/JPEG/PNG или видео MP4 до 20 МБ. Сохранённые ответы не изменены.";
          if (
            typeof message?.caption === "string" &&
            (message.caption.length > 3000 ||
              /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(
                message.caption,
              ))
          )
            correction =
              "Подпись слишком длинная или содержит неподдерживаемые символы. Сохранённые ответы не изменены.";
          media = {
            kind:
              photo !== undefined
                ? "photo"
                : message?.video
                  ? "video"
                  : "document",
            fileId: file.file_id,
            mimeType,
            size: file.file_size === undefined ? null : Number(file.file_size),
            ...(typeof message?.caption === "string"
              ? { caption: message.caption }
              : {}),
          };
          text = typeof message?.caption === "string" ? message.caption : "";
        }
      }
      if (!limiter.consume(`promo:auth:${c.botId}:${userId}`, 30, 60_000))
        return reply.code(429).send({ error: "rate_limited" });
      if (correction)
        return {
          method: "sendMessage",
          chat_id: chatId,
          text: correction,
          protect_content: true,
          reply_markup: { remove_keyboard: true },
        };
      try {
        const rawName =
          typeof from?.first_name === "string" ? from.first_name.trim() : "";
        const firstName =
          rawName.length > 0 &&
          rawName.length <= 64 &&
          !/[\p{Cc}\p{Cf}]/u.test(rawName)
            ? rawName
            : undefined;
        const result = await c.service.handle({
          botId: c.botId,
          botKey: c.botKey,
          telegramUserId: userId,
          chatId,
          updateId: body.update_id as number,
          text,
          ...(callbackData === undefined ? {} : { callbackData }),
          ...(firstName === undefined ? {} : { firstName }),
          ...(media === undefined ? {} : { media }),
        });
        if (result.status === "duplicate")
          return { accepted: true, duplicate: true };
        if (result.status === "handled")
          return {
            method: "sendMessage",
            chat_id: chatId,
            text: result.text,
            protect_content: true,
            reply_markup: result.replyMarkup ?? {
              keyboard: [[{ text: "Мой актуальный тариф" }]],
              resize_keyboard: true,
            },
          };
        if (result.status === "unavailable" || result.status === "disabled")
          return reply
            .code(503)
            .send({ error: "expert_applicant_unavailable" });
        return { accepted: true, rejected: true };
      } catch {
        return reply.code(503).send({ error: "expert_applicant_unavailable" });
      }
    },
  );
};
