import { timingSafeEqual } from "node:crypto";
import {
  CallbackInfrastructureError,
  CallbackVerificationError,
} from "@ii-tonya/integrations";
import type { FastifyPluginAsync } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";
import type { WebhookInbox } from "./selarti-webhook.js";

export interface TelegramCallbackService {
  isAuthorizedIdentity(telegramUserId: string): Promise<boolean>;
  verifyCallback(
    update: Readonly<Record<string, unknown>>,
    correlationId: string,
  ): Promise<boolean | PreparedTelegramCallback>;
  process(update: Readonly<Record<string, unknown>>, correlationId: string): Promise<void>;
}

export interface PreparedTelegramCallback {
  execute(receipt: TelegramWebhookReceipt): Promise<void>;
}

export type TelegramWebhookReceipt = Readonly<{
  source: "telegram";
  updateId: string;
}>;

const isPreparedCallback = (
  value: unknown,
): value is PreparedTelegramCallback =>
  typeof value === "object" &&
  value !== null &&
  "execute" in value &&
  typeof (value as { execute?: unknown }).execute === "function";

const numericIdentity = /^[1-9]\d{0,19}$/u;
const secureEqual = (actual: string | undefined, expected: string): boolean => {
  if (actual === undefined) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const telegramWebhookRoutes: FastifyPluginAsync<{
  secret: string;
  callbacks: TelegramCallbackService;
  inbox: WebhookInbox;
  rateLimiter: RateLimitGate;
  authenticatedLimit?: number;
  unauthenticatedLimit?: number;
}> = async (app, deps) => {
  app.post("/v1/webhooks/telegram", {
    schema: { body: { type: "object", additionalProperties: true, required: ["update_id"], properties: { update_id: { type: "integer", minimum: 0 } } } },
  }, async (request, reply) => {
    const header = request.headers["x-telegram-bot-api-secret-token"];
    if (!secureEqual(typeof header === "string" ? header : undefined, deps.secret)) {
      const allowed = deps.rateLimiter.consume(`telegram:unauth:${request.ip}`, deps.unauthenticatedLimit ?? 100, 60_000);
      return reply.code(allowed ? 401 : 429).send({ error: "unauthorized" });
    }
    if (!deps.rateLimiter.consume(`telegram:auth:${request.ip}`, deps.authenticatedLimit ?? 10, 60_000)) return reply.code(429).send({ error: "rate_limited" });
    const body = request.body as Record<string, unknown>;
    const correlationId = typeof request.headers["x-correlation-id"] === "string" ? request.headers["x-correlation-id"] : crypto.randomUUID();
    const callback = body.callback_query;
    let preparedCallback: PreparedTelegramCallback | null = null;
    if (callback && typeof callback === "object") {
      const from = (callback as Record<string, unknown>).from;
      const id = from && typeof from === "object" ? (from as Record<string, unknown>).id : undefined;
      if (!numericIdentity.test(String(id ?? ""))) return reply.code(403).send({ error: "unauthorized_expert" });
      if (!await deps.callbacks.isAuthorizedIdentity(String(id))) return reply.code(403).send({ error: "unauthorized_expert" });
      try {
        const verified = await deps.callbacks.verifyCallback(
          body,
          correlationId,
        );
        if (isPreparedCallback(verified)) preparedCallback = verified;
        else if (verified !== true)
          return reply.code(403).send({ error: "invalid_callback" });
      } catch (error) {
        if (error instanceof CallbackInfrastructureError) {
          return reply.code(503).send({ error: "callback_unavailable" });
        }
        return reply.code(403).send({ error: "invalid_callback" });
      }
    }
    const updateId = String(body.update_id);
    const claim = await deps.inbox.claim("telegram", updateId);
    if (claim.kind !== "claimed") return { accepted: true, duplicate: true };
    try {
      if (preparedCallback === null)
        await deps.callbacks.process(body, correlationId);
      else
        await preparedCallback.execute({
          source: "telegram",
          updateId,
        });
      await deps.inbox.complete(claim.claimId);
    } catch (error) {
      try {
        await deps.inbox.fail(claim.claimId);
      } catch {
        return reply.code(500).send({ error: "callback_execution_failed" });
      }
      if (error instanceof CallbackInfrastructureError) {
        return reply.code(503).send({ error: "callback_unavailable" });
      }
      if (error instanceof CallbackVerificationError) {
        return reply.code(403).send({ error: "invalid_callback" });
      }
      return reply.code(500).send({ error: "callback_execution_failed" });
    }
    return { accepted: true };
  });
};
