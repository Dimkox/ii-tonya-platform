import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ExpertManagerTelegramService } from "@ii-tonya/application";
import { createWindowedRateLimiter } from "../rate-limit.js";
export interface ExpertManagerTelegramCapability {
  enabled: true;
  botId: string;
  botKey: string;
  webhookSecret: string;
  service: ExpertManagerTelegramService;
}
const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const id = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
export const expertManagerTelegramRoutes: FastifyPluginAsync<{
  capability?: ExpertManagerTelegramCapability;
}> = async (app, deps) => {
  const c = deps.capability;
  if (!c) return;
  if (
    c.enabled !== true ||
    !/^[1-9]\d{0,15}$/u.test(c.botId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(c.botKey) ||
    c.webhookSecret.length < 16
  )
    throw new Error("manager_telegram_capability_required");
  const limiter = createWindowedRateLimiter();
  app.post(
    "/v1/admin/expert-verification/telegram-pairing",
    { bodyLimit: 1024 },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!limiter.consume(`manager-pair:${req.ip}`, 10, 60_000))
        return reply.code(429).send({ error: "rate_limited" });
      const token =
        typeof req.headers.authorization === "string"
          ? /^Bearer ([A-Za-z0-9._~-]{24,512})$/u.exec(
              req.headers.authorization,
            )?.[1]
          : undefined;
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      if (req.body !== undefined)
        return reply.code(400).send({ error: "invalid_request" });
      const result = await c.service.createPairing(
        `sha256:${createHash("sha256").update(token).digest("hex")}`,
      );
      return result.kind === "ok"
        ? { pairing_command: `/pair ${result.token}`, expires_in_seconds: 300 }
        : reply.code(403).send({ error: "forbidden" });
    },
  );
  app.post<{ Params: { botKey: string } }>(
    "/v1/webhooks/telegram/expert-manager/:botKey",
    {
      bodyLimit: 8192,
      errorHandler: (_err, _req, reply) =>
        reply.code(503).send({ error: "manager_unavailable" }),
    },
    async (req, reply) => {
      if (!limiter.consume(`manager-unauth:${req.ip}`, 100, 60_000))
        return reply.code(429).send({ error: "rate_limited" });
      if (
        !equal(req.params.botKey, c.botKey) ||
        !equal(req.headers["x-telegram-bot-api-secret-token"], c.webhookSecret)
      )
        return reply.code(401).send({ error: "unauthorized" });
      const b = req.body as Record<string, unknown> | null;
      if (!b || !Number.isSafeInteger(b.update_id) || Number(b.update_id) < 0)
        return reply.code(400).send({ error: "invalid_update" });
      const callback = b.callback_query as Record<string, unknown> | undefined;
      const message = (callback?.message ?? b.message) as
        Record<string, unknown> | undefined;
      const from = (callback?.from ?? message?.from) as
        Record<string, unknown> | undefined;
      const chat = message?.chat as Record<string, unknown> | undefined;
      const user = id(from?.id),
        chatId = id(chat?.id);
      if (
        !user ||
        user !== chatId ||
        from?.is_bot === true ||
        chat?.type !== "private"
      )
        return reply.code(400).send({ error: "invalid_update" });
      if (!limiter.consume(`manager:${c.botId}:${user}`, 30, 60_000))
        return reply.code(429).send({ error: "rate_limited" });
      const pairing =
        typeof message?.text === "string"
          ? /^\/pair ([A-Za-z0-9_-]{43})$/u.exec(message.text)?.[1]
          : undefined;
      const result =
        callback &&
        typeof callback.data === "string" &&
        callback.data.length <= 64
          ? await c.service.callback(user, chatId, callback.data)
          : pairing
            ? await c.service.pair(user, chatId, pairing)
            : { kind: "forbidden" };
      if (pairing && result.kind === "ok") {
        try {
          await c.service.tick();
        } catch {
          /* durable queue remains pending */
        }
      }
      return {
        method: "sendMessage",
        chat_id: chatId,
        text:
          result.kind === "ok"
            ? "Действие выполнено"
            : result.kind === "editor_required"
              ? "Для этой анкеты выберите категорию или уточнения и подтвердите точный текст в защищённом редакторе кабинета сотрудника."
              : "Действие недоступно. Откройте кабинет сотрудника для повторной проверки MFA.",
        protect_content: true,
      };
    },
  );
};
