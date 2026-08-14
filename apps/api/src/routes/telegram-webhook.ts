import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";
import type { WebhookInbox } from "./selarti-webhook.js";

export interface TelegramCallbackService {
  isAuthorizedIdentity(telegramUserId: string): Promise<boolean>;
  verifyCallback(
    update: Readonly<Record<string, unknown>>,
    correlationId: string,
  ): Promise<boolean>;
  process(
    update: Readonly<Record<string, unknown>>,
    correlationId: string,
  ): Promise<void>;
}

export interface TelegramExpertQueryIngress {
  resolvePrincipal(telegramUserId: string): Promise<{
    readonly userId: string;
    readonly expertId: string;
    readonly telegramUserId: string;
    readonly timezone: string;
  } | null>;
  authenticateClientView(input: {
    readonly data: string;
    readonly telegramUserId: string;
    readonly correlationId: string;
  }): Promise<{
    readonly tokenHash: string;
    readonly claims: {
      readonly reservationId: string;
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly version: number;
      readonly expiresAtEpochSeconds: number;
    };
  } | null>;
  processCommand(input: {
    readonly text: string;
    readonly chatType: "private";
    readonly principal: {
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly timezone: string;
    };
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "reissue_client" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "not_applied" | "unknown_outcome";
  }>;
  processClientView(input: {
    readonly principal: {
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly timezone: string;
    };
    readonly authenticated: {
      readonly tokenHash: string;
      readonly claims: {
        readonly reservationId: string;
        readonly expertId: string;
        readonly telegramUserId: string;
        readonly version: number;
        readonly expiresAtEpochSeconds: number;
      };
    };
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "reissue_client" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "not_applied" | "unknown_outcome";
  }>;
  answerCallbackQuery(input: {
    readonly callbackQueryId: string;
    readonly status: "processed" | "unavailable";
    readonly idempotencyKey: string;
  }): Promise<
    | { readonly kind: "applied"; readonly providerOperationId: string }
    | {
        readonly kind: "not_applied";
        readonly retryable: boolean;
        readonly reasonCode: string;
      }
    | {
        readonly kind: "unknown_outcome";
        readonly reconciliationKey: string;
        readonly reasonCode: string;
      }
  >;
}

const numericIdentity = /^[1-9]\d{0,19}$/u;
const callbackQueryIdPattern = /^[^\u0000-\u001F\u007F-\u009F]{1,256}$/u;
const secureEqual = (actual: string | undefined, expected: string): boolean => {
  if (actual === undefined) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const telegramWebhookRoutes: FastifyPluginAsync<{
  secret: string;
  callbacks: TelegramCallbackService;
  inbox: WebhookInbox;
  rateLimiter: RateLimitGate;
  expertQueriesEnabled?: boolean;
  expertQueries?: TelegramExpertQueryIngress;
  authenticatedLimit?: number;
  unauthenticatedLimit?: number;
}> = async (app, deps) => {
  if (deps.expertQueriesEnabled === true && deps.expertQueries === undefined) {
    throw new Error("Expert Telegram query capability is required");
  }
  app.post(
    "/v1/webhooks/telegram",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true,
          required: ["update_id"],
          properties: { update_id: { type: "integer", minimum: 0 } },
        },
      },
    },
    async (request, reply) => {
      const header = request.headers["x-telegram-bot-api-secret-token"];
      if (
        !secureEqual(
          typeof header === "string" ? header : undefined,
          deps.secret,
        )
      ) {
        const allowed = deps.rateLimiter.consume(
          `telegram:unauth:${request.ip}`,
          deps.unauthenticatedLimit ?? 100,
          60_000,
        );
        return reply.code(allowed ? 401 : 429).send({ error: "unauthorized" });
      }
      if (
        !deps.rateLimiter.consume(
          "telegram:auth:provider",
          deps.authenticatedLimit ?? 100,
          60_000,
        )
      ) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      const body = request.body as Record<string, unknown>;
      const correlationId =
        typeof request.headers["x-correlation-id"] === "string"
          ? request.headers["x-correlation-id"]
          : crypto.randomUUID();
      const callback = body.callback_query;
      if (callback && typeof callback === "object") {
        const callbackRecord = callback as Record<string, unknown>;
        const callbackQueryId = callbackRecord.id;
        const from = callbackRecord.from;
        const id =
          from && typeof from === "object"
            ? (from as Record<string, unknown>).id
            : undefined;
        if (!numericIdentity.test(String(id ?? ""))) {
          return reply.code(403).send({ error: "unauthorized_expert" });
        }
        const data = callbackRecord.data;
        if (
          typeof callbackQueryId !== "string" ||
          !callbackQueryIdPattern.test(callbackQueryId) ||
          typeof data !== "string" ||
          Buffer.byteLength(data, "utf8") < 1 ||
          Buffer.byteLength(data, "utf8") > 64
        ) {
          return reply.code(403).send({ error: "invalid_callback" });
        }
        if (data.startsWith("cv1.")) {
          if (
            deps.expertQueriesEnabled !== true ||
            deps.expertQueries === undefined
          ) {
            return { accepted: true, unsupported: true };
          }
          const updateId = String(body.update_id);
          const answerBestEffort = async (
            status: "processed" | "unavailable",
          ): Promise<void> => {
            try {
              await deps.expertQueries?.answerCallbackQuery({
                callbackQueryId,
                status,
                idempotencyKey: `telegram:${updateId}:client-view:answer`,
              });
            } catch {
              // Callback acknowledgement never changes the sensitive operation outcome.
            }
          };
          const claim = await deps.inbox.claim("telegram", updateId);
          if (claim.kind !== "claimed") {
            await answerBestEffort("unavailable");
            return { accepted: true, unavailable: true };
          }
          try {
            const principal = await deps.expertQueries.resolvePrincipal(
              String(id),
            );
            if (principal === null) throw new Error("client_view_denied");
            const authenticated =
              await deps.expertQueries.authenticateClientView({
                data,
                telegramUserId: String(id),
                correlationId,
              });
            if (authenticated === null) throw new Error("client_view_denied");
            const processResult = await deps.expertQueries.processClientView({
              principal,
              authenticated,
              idempotencyKey: `telegram:${updateId}:client-view`,
              correlationId,
            });
            await deps.inbox.complete(claim.claimId);
            if (processResult.deliveryOutcome === "not_applied") {
              await answerBestEffort("unavailable");
              return {
                accepted: true,
                unavailable: true,
                reissueClient: true,
              };
            }
            if (processResult.deliveryOutcome === "unknown_outcome") {
              await answerBestEffort("unavailable");
              return { accepted: true, unavailable: true, ambiguous: true };
            }
            await answerBestEffort("processed");
          } catch {
            await deps.inbox.complete(claim.claimId);
            await answerBestEffort("unavailable");
            return { accepted: true, unavailable: true };
          }
          return { accepted: true };
        }
        if (!(await deps.callbacks.isAuthorizedIdentity(String(id)))) {
          return reply.code(403).send({ error: "unauthorized_expert" });
        }
        if (!(await deps.callbacks.verifyCallback(body, correlationId))) {
          return reply.code(403).send({ error: "invalid_callback" });
        }
      }
      const message = body.message;
      if (message && typeof message === "object") {
        const record = message as Record<string, unknown>;
        const text = record.text;
        if (
          typeof text === "string" &&
          (deps.expertQueriesEnabled === true
            ? text.startsWith("/")
            : /^\/(?:schedule|client|stats|referral|residency)(?:\s|$)/u.test(
                text,
              ))
        ) {
          if (
            deps.expertQueriesEnabled !== true ||
            deps.expertQueries === undefined
          ) {
            return { accepted: true, unsupported: true };
          }
          const from = record.from;
          const chat = record.chat;
          const telegramUserId =
            from && typeof from === "object"
              ? String((from as Record<string, unknown>).id ?? "")
              : "";
          const chatRecord =
            chat && typeof chat === "object"
              ? (chat as Record<string, unknown>)
              : undefined;
          if (
            !numericIdentity.test(telegramUserId) ||
            chatRecord?.type !== "private" ||
            String(chatRecord.id ?? "") !== telegramUserId
          ) {
            return reply.code(403).send({ error: "unauthorized_expert" });
          }
          if (
            !deps.rateLimiter.consume(
              `telegram:query:${telegramUserId}`,
              20,
              60_000,
            )
          ) {
            return reply.code(429).send({ error: "rate_limited" });
          }
          const principal =
            await deps.expertQueries.resolvePrincipal(telegramUserId);
          if (principal === null) {
            return reply.code(403).send({ error: "unauthorized_expert" });
          }
          const updateId = String(body.update_id);
          const claim = await deps.inbox.claim("telegram", updateId);
          if (claim.kind !== "claimed") {
            return { accepted: true, duplicate: true };
          }
          try {
            await deps.expertQueries.processCommand({
              text,
              chatType: "private",
              principal,
              idempotencyKey: `telegram:${updateId}:command`,
              correlationId,
            });
            await deps.inbox.complete(claim.claimId);
          } catch {
            await deps.inbox.fail(claim.claimId);
            return reply.code(500).send({ error: "expert_query_unavailable" });
          }
          return { accepted: true };
        }
      }
      const updateId = String(body.update_id);
      const claim = await deps.inbox.claim("telegram", updateId);
      if (claim.kind !== "claimed") {
        return { accepted: true, duplicate: true };
      }
      try {
        await deps.callbacks.process(body, correlationId);
        await deps.inbox.complete(claim.claimId);
      } catch (error) {
        await deps.inbox.fail(claim.claimId);
        throw error;
      }
      return { accepted: true };
    },
  );
};
