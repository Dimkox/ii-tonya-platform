import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { InboxDeduplicator } from "./selarti-webhook.js";

export interface TelegramCallbackService {
  verifyCallback(update: Readonly<Record<string, unknown>>, correlationId: string): Promise<boolean>;
  process(update: Readonly<Record<string, unknown>>, correlationId: string): Promise<void>;
}

const numericIdentity = /^[1-9]\d{0,19}$/u;
const secureEqual = (actual: string | undefined, expected: string): boolean => {
  if (actual === undefined) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const telegramWebhookRoutes: FastifyPluginAsync<{
  secret: string;
  callbacks: TelegramCallbackService;
  inbox: InboxDeduplicator;
  authenticatedLimit?: number;
  unauthenticatedLimit?: number;
}> = async (app, deps) => {
  let authenticated = 0;
  const unauthenticatedByIp = new Map<string, number>();
  app.post("/v1/webhooks/telegram", {
    schema: { body: { type: "object", additionalProperties: true, required: ["update_id"], properties: { update_id: { type: "integer", minimum: 0 } } } },
  }, async (request, reply) => {
    const header = request.headers["x-telegram-bot-api-secret-token"];
    if (!secureEqual(typeof header === "string" ? header : undefined, deps.secret)) {
      const ipCount = (unauthenticatedByIp.get(request.ip) ?? 0) + 1;
      unauthenticatedByIp.set(request.ip, ipCount);
      return reply.code(ipCount > (deps.unauthenticatedLimit ?? 100) ? 429 : 401).send({ error: "unauthorized" });
    }
    authenticated += 1;
    if (authenticated > (deps.authenticatedLimit ?? 10)) return reply.code(429).send({ error: "rate_limited" });
    const body = request.body as Record<string, unknown>;
    const correlationId = typeof request.headers["x-correlation-id"] === "string" ? request.headers["x-correlation-id"] : crypto.randomUUID();
    const callback = body.callback_query;
    if (callback && typeof callback === "object") {
      const from = (callback as Record<string, unknown>).from;
      const id = from && typeof from === "object" ? (from as Record<string, unknown>).id : undefined;
      if (!numericIdentity.test(String(id ?? ""))) return reply.code(403).send({ error: "unauthorized_expert" });
      if (!await deps.callbacks.verifyCallback(body, correlationId)) return reply.code(403).send({ error: "invalid_callback" });
    }
    const updateId = String(body.update_id);
    if (!await deps.inbox.claim("telegram", updateId)) return { accepted: true, duplicate: true };
    await deps.callbacks.process(body, correlationId);
    return { accepted: true };
  });
};
