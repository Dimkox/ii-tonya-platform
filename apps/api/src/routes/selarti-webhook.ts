import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ConversationService } from "@ii-tonya/application";
import type { SelartiPort } from "@ii-tonya/integrations";
import { operationalMetrics, traced, type Logger } from "@ii-tonya/observability";
import type { FastifyPluginAsync } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";

export interface WebhookInbox {
  claim(provider: "telegram", eventId: string): Promise<{ kind: "claimed"; claimId: string } | { kind: "duplicate" | "busy" }>;
  complete(claimId: string): Promise<void>;
  fail(claimId: string): Promise<void>;
}

const headerRecord = (headers: Readonly<Record<string, string | string[] | undefined>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));

export const selartiWebhookRoutes: FastifyPluginAsync<{
  selarti: SelartiPort;
  conversation: ConversationService;
  logger: Logger;
  rateLimiter: RateLimitGate;
  now?: () => Date;
  authenticatedLimit?: number;
  unauthenticatedLimit?: number;
}> = async (app, deps) => {
  const rawBodies = new WeakMap<object, Buffer>();
  app.addHook("preParsing", async (request, reply, payload) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > 64_000) { void reply.code(413).send({ error: "body_too_large" }); return Readable.from([]); }
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks); rawBodies.set(request, raw);
    return Readable.from(raw);
  });
  app.post("/v1/webhooks/selarti", {
    schema: { body: { type: "object", additionalProperties: true } },
  }, async (request, reply) => {
    const raw = rawBodies.get(request) ?? Buffer.alloc(0);
    let event;
    try {
      event = await deps.selarti.decodeVerifiedWebhook(raw, headerRecord(request.headers));
    } catch {
      const allowed = deps.rateLimiter.consume(`selarti:unauth:${request.ip}`, deps.unauthenticatedLimit ?? 100, 60_000);
      return reply.code(allowed ? 401 : 429).send({ error: "unauthorized" });
    }
    const occurredAt = new Date(event.occurredAt).getTime();
    const ageMs = (deps.now ?? (() => new Date()))().getTime() - occurredAt;
    if (!Number.isFinite(occurredAt) || ageMs < -30_000 || ageMs > 5 * 60_000) return reply.code(401).send({ error: "replay_window" });
    if (!deps.rateLimiter.consume(`selarti:auth:${request.ip}`, deps.authenticatedLimit ?? 100, 60_000)) return reply.code(429).send({ error: "rate_limited" });
    if (event.kind !== "inbound_message") return reply.code(202).send({ accepted: true });
    const correlationId = typeof request.headers["x-correlation-id"] === "string"
      ? request.headers["x-correlation-id"] : crypto.randomUUID();
    const result = await traced("selarti.inbound", () => deps.conversation.handleInbound({
      provider: "selarti", providerEventId: event.providerEventId,
      providerMessageId: event.providerMessageId, userId: event.channelUserId,
      text: event.text, locale: "ru", countryCode: "RU", regionCode: null,
      ageBand: "adult", occurredAt: event.occurredAt, correlationId,
      // The service owns all business validation after authenticated durable intake.
    }));
    if (result.kind === "duplicate") operationalMetrics.inboxDuplicates.add(1, { provider: "selarti" });
    deps.logger.info({ correlationId, eventIdHash: createHash("sha256").update(event.providerEventId).digest("hex"), module: "api", operation: "selarti.inbound", outcome: "accepted" });
    return { accepted: true };
  });
};
