import { createWindowedRateLimiter } from "../rate-limit.js";
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ExpertApplicantService } from "@ii-tonya/application";
export interface ExpertApplicantTelegramCapability {
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
      const message = body?.message as Record<string, unknown> | null;
      const from = message?.from as Record<string, unknown> | null;
      const chat = message?.chat as Record<string, unknown> | null;
      const userId = identity(from?.id),
        chatId = identity(chat?.id);
      if (
        !body ||
        !Number.isSafeInteger(body.update_id) ||
        Number(body.update_id) < 0 ||
        !userId ||
        userId !== chatId ||
        from?.is_bot === true ||
        chat?.type !== "private" ||
        typeof message?.text !== "string" ||
        message.text.length > 256 ||
        /[\u0000-\u001F\u007F-\u009F]/u.test(message.text)
      )
        return reply.code(400).send({ error: "invalid_update" });
      if (!limiter.consume(`promo:auth:${c.botId}:${userId}`, 30, 60_000))
        return reply.code(429).send({ error: "rate_limited" });
      try {
        const result = await c.service.handle({
          botId: c.botId,
          botKey: c.botKey,
          telegramUserId: userId,
          chatId,
          updateId: body.update_id as number,
          text: message.text,
        });
        if (result.status === "duplicate")
          return { accepted: true, duplicate: true };
        if (result.status === "handled")
          return {
            method: "sendMessage",
            chat_id: chatId,
            text: result.text,
            protect_content: true,
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
