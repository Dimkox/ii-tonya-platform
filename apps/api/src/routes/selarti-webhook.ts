import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import type {
  ClientConversationIdentityResolver,
  ConversationService,
} from "@ii-tonya/application";
import {
  operationalMetrics,
  traced,
  type Logger,
} from "@ii-tonya/observability";
import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  authenticateClientConversationInbound,
  type AuthenticatedConversationInboundCapability,
  type RawHeaderOccurrence,
} from "../client-conversation-inbound.js";
import type { RateLimitGate } from "../rate-limit.js";

export interface WebhookInbox {
  claim(
    provider: "telegram" | "yookassa",
    eventId: string,
  ): Promise<
    | { kind: "claimed"; claimId: string }
    | { kind: "duplicate" }
    | { kind: "busy" }
  >;
  complete(claimId: string): Promise<void>;
  fail(claimId: string): Promise<void>;
}

const rawHeaderOccurrences = (
  rawHeaders: readonly string[],
): readonly RawHeaderOccurrence[] | null => {
  if (rawHeaders.length % 2 !== 0) return null;
  const occurrences: RawHeaderOccurrence[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) return null;
    occurrences.push(Object.freeze({ name, value }));
  }
  return Object.freeze(occurrences);
};

const normalizedSource = (value: string | undefined): string | null => {
  if (value === undefined || value.length === 0) return null;
  const normalized = /^::ffff:/iu.test(value) ? value.slice(7) : value;
  return isIP(normalized) === 0 ? null : normalized.toLowerCase();
};

const hasForbiddenTransportHeaders = (
  headers: readonly RawHeaderOccurrence[],
): boolean => {
  const names = headers.map(({ name }) => name.toLowerCase());
  return (
    names.includes("forwarded") ||
    names.includes("x-forwarded-for") ||
    names.includes("x-forwarded-proto") ||
    names.includes("x-forwarded-host") ||
    names.includes("content-encoding") ||
    names.filter((name) => name === "content-length").length > 1 ||
    (names.includes("content-length") && names.includes("transfer-encoding"))
  );
};

const unavailable = (reply: FastifyReply) =>
  reply
    .code(503)
    .header("Retry-After", "1")
    .send({ error: "temporarily_unavailable" });

const bucketDigest = (domain: "tenant" | "subject", token: string): string =>
  createHash("sha256")
    .update(`ii-tonya/client-conversation-rate/${domain}/v1\0`, "utf8")
    .update(token, "utf8")
    .digest("hex");

export const selartiWebhookRoutes: FastifyPluginAsync<{
  inbound: AuthenticatedConversationInboundCapability;
  identities: ClientConversationIdentityResolver;
  conversation: ConversationService;
  logger: Logger;
  rateLimiter: RateLimitGate;
  runtime: { assertReady(): Promise<void> };
  now?: () => Date;
}> = async (app, deps) => {
  const rawBodies = new WeakMap<object, Buffer>();
  app.addHook("preParsing", async (request, reply, payload) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > 64_000) {
        void reply.code(413).send({ error: "body_too_large" });
        return Readable.from([]);
      }
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks);
    rawBodies.set(request, raw);
    return Readable.from(raw);
  });

  app.post(
    "/v1/webhooks/selarti",
    { schema: { body: { type: "object", additionalProperties: true } } },
    async (request, reply) => {
      const rawHeaders = rawHeaderOccurrences(request.raw.rawHeaders);
      const source = normalizedSource(request.raw.socket.remoteAddress);
      if (
        rawHeaders === null ||
        source === null ||
        request.raw.httpVersion !== "1.1" ||
        hasForbiddenTransportHeaders(rawHeaders)
      ) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      if (
        !deps.rateLimiter.consume(`selarti:source:${source}`, 60, 60_000) ||
        !deps.rateLimiter.consume("selarti:process", 600, 60_000)
      ) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      try {
        await deps.runtime.assertReady();
      } catch {
        return unavailable(reply);
      }

      const authenticated = await authenticateClientConversationInbound(
        deps.inbound,
        {
          rawBody: rawBodies.get(request) ?? Buffer.alloc(0),
          rawHeaders,
          signal: request.signal,
        },
      );
      if (authenticated.kind === "unavailable") return unavailable(reply);
      if (authenticated.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const ageMs =
        (deps.now ?? (() => new Date()))().getTime() -
        Date.parse(authenticated.event.occurredAt);
      if (ageMs < -30_000 || ageMs > 5 * 60_000) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (
        !deps.rateLimiter.consume(
          `selarti:tenant:${bucketDigest("tenant", authenticated.event.tenantToken)}`,
          300,
          60_000,
        ) ||
        !deps.rateLimiter.consume(
          `selarti:subject:${bucketDigest("subject", authenticated.event.subjectToken)}`,
          30,
          60_000,
        )
      ) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      const identity = await deps.identities.resolveIdentity({
        tenantToken: authenticated.event.tenantToken,
        subjectToken: authenticated.event.subjectToken,
      });
      if (identity.kind === "unavailable") return unavailable(reply);
      if (identity.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const correlationId = randomUUID();
      try {
        await deps.runtime.assertReady();
        const result = await traced("selarti.inbound", () =>
          deps.conversation.handleInbound({
            provider: "selarti",
            providerEventId: authenticated.event.providerEventId,
            providerMessageId: authenticated.event.providerMessageId,
            userId: identity.identity.userId,
            bindingId: identity.identity.bindingId,
            text: authenticated.event.text,
            locale: "ru",
            countryCode: "RU",
            regionCode: null,
            ageBand: "adult",
            occurredAt: authenticated.event.occurredAt,
            correlationId,
          }),
        );
        if (result.kind === "duplicate") {
          operationalMetrics.inboxDuplicates.add(1, { provider: "selarti" });
        }
      } catch {
        return unavailable(reply);
      }
      deps.logger.info({
        correlationId,
        eventIdHash: createHash("sha256")
          .update(authenticated.event.providerEventId)
          .digest("hex"),
        module: "api",
        operation: "selarti.inbound",
        outcome: "accepted",
      });
      return reply
        .code(202)
        .header("Cache-Control", "no-store")
        .send({ accepted: true });
    },
  );
};
