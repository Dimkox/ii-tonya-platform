import {
  validRawExpertCardUpdateId,
  parseExpertCardTelegramUpdate,
  type ExpertCardTelegramIngress,
} from "../expert-card-telegram-ingress.js";
import { createSecurityEvent } from "@ii-tonya/observability";
import {
  handleTelegramDeletion,
  type TelegramDeletionCapability,
} from "../telegram-deletion.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type {
  ClientNavigationGateway,
  ClientIngressReplayRead,
  ExpertAiIngressService,
  ExpertPrincipal,
} from "@ii-tonya/application";
import { clientIngressUpdateId } from "@ii-tonya/application";
import type {
  ExpertTelegramCheckoutResult,
  TelegramSendOutcome,
} from "@ii-tonya/integrations";
type HybridGateway = {
  handle(
    raw: unknown,
  ): Promise<{ readonly status: string; readonly route?: string }>;
};
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { BookingCallbackService } from "../booking-callback-service.js";
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

export interface TelegramExpertAiIngress {
  resolvePrincipal(telegramUserId: string): Promise<ExpertPrincipal | null>;
  handle: ExpertAiIngressService["handle"];
}

export interface TelegramTestExpertPromoIngress {
  readonly residualEnabled?: boolean;
  handle(input: {
    readonly botKey: string;
    readonly telegramUserId: string;
    readonly chatId: string;
    readonly text: string;
    readonly requestKey: string;
    readonly requestDigest: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<{
    readonly status: "handled" | "unhandled" | "unavailable";
    readonly route?: "deterministic" | "residual";
  }>;
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
      readonly userId: string;
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly timezone: string;
    };
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly kind: "processed" | "unsupported" | "disabled" | "unavailable";
    readonly deliveryOutcome?: "applied" | "unknown_outcome";
  }>;
  processClientView(input: {
    readonly principal: {
      readonly userId: string;
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
  processResidencyCheckout(input: {
    readonly data: string;
    readonly principal: {
      readonly userId: string;
      readonly expertId: string;
      readonly telegramUserId: string;
      readonly timezone: string;
    };
  }): Promise<ExpertTelegramCheckoutResult>;
  sendResidencyCheckoutLink(input: {
    readonly idempotencyKey: string;
    readonly telegramUserId: string;
    readonly checkoutUrl: string;
  }): Promise<TelegramSendOutcome>;
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
  deletion?: TelegramDeletionCapability;
  callbacks: TelegramCallbackService;
  inbox: WebhookInbox;
  rateLimiter: RateLimitGate;
  expertQueriesEnabled?: boolean;
  expertCheckoutEnabled?: boolean;
  expertQueries?: TelegramExpertQueryIngress;
  expertAiEnabled?: boolean;
  expertAi?: TelegramExpertAiIngress;
  authenticatedLimit?: number;
  unauthenticatedLimit?: number;
  clientIngressEnabled: boolean | undefined;
  clientHybridRoutingEnabled: boolean | undefined;
  clientBotKey: string | undefined;
  clientGateway: HybridGateway | undefined;
  clientNavigationEnabled?: boolean | undefined;
  clientNavigationGateway?: Pick<ClientNavigationGateway, "handle"> | undefined;
  clientBotId?: string | undefined;
  clientIngressReplay?: ClientIngressReplayRead | undefined;
  testExpertPromoEnabled?: boolean;
  testExpertPromo?: TelegramTestExpertPromoIngress;
  expertCardEnabled?: boolean;
  expertCard?: ExpertCardTelegramIngress;
  bookingCallbacksEnabled?: boolean;
  bookingCallbacks?: BookingCallbackService;
}> = async (app, deps) => {
  if (
    deps.expertCardEnabled === true &&
    (!deps.expertCard ||
      !Number.isSafeInteger(Number(deps.expertCard.workBotId)) ||
      !/^[1-9][0-9]{0,15}$/u.test(deps.expertCard.workBotId) ||
      !deps.expertCard.workBotKey ||
      typeof deps.expertCard.service?.handleWork !== "function" ||
      typeof deps.expertCard.legacyReplay?.read !== "function" ||
      !secureEqual(deps.expertCard.webhookSecret, deps.secret))
  )
    throw new Error("expert_card_capability_required");
  const securityEvent = createSecurityEvent();
  app.addHook("onResponse", async (request, reply) => {
    if (
      reply.statusCode === 401 ||
      reply.statusCode === 403 ||
      reply.statusCode === 429
    )
      app.log.warn(
        securityEvent(
          reply.statusCode === 429 ? "rate_limited" : "authentication_rejected",
          request.ip,
          request.headers["user-agent"],
        ),
      );
  });
  const deletion = async (
    body: unknown,
    reply: FastifyReply,
  ): Promise<boolean> => {
    const result = await handleTelegramDeletion(body, deps.deletion);
    if (result.kind === "unhandled") return false;
    if (result.kind === "reply") reply.send(result.reply);
    else if (result.kind === "denied")
      reply.code(403).send({ error: "deletion_denied" });
    else reply.code(503).send({ error: "deletion_unavailable" });
    return true;
  };
  if (
    deps.bookingCallbacksEnabled === true &&
    (!deps.bookingCallbacks || !deps.clientBotKey)
  )
    throw new Error("Booking callback capability is required");
  const isBookingCallback = (body: unknown) => {
    if (!body || typeof body !== "object") return false;
    const callback = (body as Record<string, unknown>).callback_query;
    return (
      callback !== null &&
      typeof callback === "object" &&
      typeof (callback as Record<string, unknown>).data === "string" &&
      ((callback as Record<string, unknown>).data as string).startsWith("ct2.")
    );
  };
  const bookingCallback = async (
    body: unknown,
    reply: FastifyReply,
    correlationId: string,
  ) => {
    if (
      deps.bookingCallbacksEnabled !== true ||
      !deps.bookingCallbacks ||
      !deps.clientBotKey
    )
      return { accepted: true, unsupported: true };
    try {
      const result = await deps.bookingCallbacks.handle(
        body,
        deps.clientBotKey,
        correlationId,
      );
      if (result.kind === "rejected")
        return reply.code(403).send({ error: "invalid_booking_callback" });
      if (result.kind === "busy" || result.kind === "unavailable")
        return reply.code(503).send({ error: "booking_callback_unavailable" });
      return {
        accepted: true,
        route: "booking",
        ...(result.kind === "replayed" ? { duplicate: true } : {}),
      };
    } catch {
      return reply.code(503).send({ error: "booking_callback_unavailable" });
    }
  };
  if (
    (deps.expertQueriesEnabled === true ||
      deps.expertCheckoutEnabled === true) &&
    deps.expertQueries === undefined
  ) {
    throw new Error("Expert Telegram query capability is required");
  }
  if (deps.expertAiEnabled === true && deps.expertAi === undefined) {
    throw new Error("Expert Telegram AI capability is required");
  }
  app.post<{ Params: { botKey: string } }>(
    "/v1/webhooks/telegram/client/:botKey",
    {
      bodyLimit: 65_536,
      // Authentication must precede JSON parsing, validation and any DB work.
      onRequest: async (request, reply) => {
        const header = request.headers["x-telegram-bot-api-secret-token"];
        if (
          !secureEqual(
            typeof header === "string" ? header : undefined,
            deps.secret,
          )
        ) {
          const allowed = deps.rateLimiter.consume(
            `telegram:client:unauth:${request.ip}`,
            deps.unauthenticatedLimit ?? 100,
            60_000,
          );
          return reply
            .code(allowed ? 401 : 429)
            .send({ error: "unauthorized" });
        }
        if (
          deps.clientBotKey === undefined ||
          !secureEqual(request.params.botKey, deps.clientBotKey)
        ) {
          app.log.warn(
            securityEvent(
              "authentication_rejected",
              request.ip,
              request.headers["user-agent"],
            ),
          );
          return reply.send({ accepted: true, rejected: true });
        }
        if (
          !deps.rateLimiter.consume(
            `telegram:client:auth:${deps.clientBotKey}`,
            deps.authenticatedLimit ?? 100,
            60_000,
          )
        )
          return reply.code(429).send({ error: "rate_limited" });
      },
      errorHandler: (error, _request, reply) => {
        // Do not pass parser/validation/service prose or stacks to logger or response.
        if (error.statusCode === 413)
          return reply.code(413).send({ error: "payload_too_large" });
        if (error.statusCode !== undefined && error.statusCode < 500)
          return reply.code(400).send({ error: "invalid_update" });
        return reply.code(503).send({ error: "client_gateway_unavailable" });
      },
      schema: {
        params: {
          type: "object",
          required: ["botKey"],
          properties: { botKey: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          additionalProperties: true,
          required: ["update_id"],
          // No coercion: a string/null ID must not turn into a valid event number.
          properties: { update_id: {} },
        },
      },
    },
    async (request, reply) => {
      const updateId = clientIngressUpdateId(request.body);
      if (updateId === undefined)
        return reply.code(400).send({ error: "invalid_update" });
      if (await deletion(request.body, reply)) return;
      if (isBookingCallback(request.body))
        return bookingCallback(request.body, reply, crypto.randomUUID());
      if (deps.clientNavigationEnabled === true) {
        try {
          const result = await deps.clientNavigationGateway?.handle(
            request.body,
          );
          if (result?.status === "reply")
            return reply.type("application/json").send(result.reply);
          if (result?.status === "duplicate")
            return { accepted: true, duplicate: true };
          if (result?.status === "ignored")
            return { accepted: true, rejected: true };
          if (result?.status === "invalid")
            return reply.code(400).send({ error: "invalid_update" });
        } catch {
          /* fixed unavailable below */
        }
        return reply.code(503).send({ error: "client_navigation_unavailable" });
      }
      if (
        deps.clientIngressEnabled !== true ||
        deps.clientGateway === undefined
      ) {
        return reply.code(503).send({ error: "client_gateway_unavailable" });
      }
      // A previous navigation receipt stays terminal across mode/key changes.
      if (deps.clientBotId !== undefined) {
        try {
          const terminal = await deps.clientIngressReplay?.hasReceipt({
            botId: deps.clientBotId,
            updateId,
          });
          if (terminal === true) return { accepted: true, duplicate: true };
          if (terminal !== false)
            return reply
              .code(503)
              .send({ error: "client_gateway_unavailable" });
        } catch {
          return reply.code(503).send({ error: "client_gateway_unavailable" });
        }
      }
      if (deps.testExpertPromoEnabled === true && deps.testExpertPromo) {
        const root = request.body as Record<string, unknown>;
        const message = root.message;
        if (message && typeof message === "object") {
          const record = message as Record<string, unknown>;
          const from = record.from;
          const chat = record.chat;
          const text = record.text;
          const telegramUserId =
            from && typeof from === "object"
              ? String((from as Record<string, unknown>).id ?? "")
              : "";
          const chatRecord =
            chat && typeof chat === "object"
              ? (chat as Record<string, unknown>)
              : undefined;
          const chatId = String(chatRecord?.id ?? "");
          if (
            typeof text === "string" &&
            numericIdentity.test(telegramUserId) &&
            chatRecord?.type === "private" &&
            chatId === telegramUserId &&
            text.length >= 1 &&
            text.length <= 4_096 &&
            !/[\u0000-\u001F\u007F-\u009F]/u.test(text)
          ) {
            if (
              !deps.rateLimiter.consume(
                `telegram:test-expert:${deps.clientBotKey}:${telegramUserId}`,
                20,
                60_000,
              )
            )
              return reply.code(429).send({ error: "rate_limited" });
            const updateId = String(root.update_id);
            try {
              const result = await deps.testExpertPromo.handle({
                botKey: deps.clientBotKey!,
                telegramUserId,
                chatId,
                text,
                requestKey: `telegram:${updateId}:test-expert`,
                requestDigest: createHash("sha256").update(text).digest("hex"),
                correlationId:
                  typeof request.headers["x-correlation-id"] === "string"
                    ? request.headers["x-correlation-id"]
                    : `telegram:${deps.clientBotKey}:${updateId}`,
                occurredAt: new Date().toISOString(),
              });
              if (result.status === "unavailable")
                return reply
                  .code(503)
                  .send({ error: "test_expert_unavailable" });
              if (result.status === "handled")
                return { accepted: true, route: "test_expert" };
            } catch {
              return reply.code(503).send({ error: "test_expert_unavailable" });
            }
          }
        }
      }
      let result;
      try {
        result = await deps.clientGateway.handle(request.body);
      } catch {
        return reply.code(503).send({ error: "client_gateway_unavailable" });
      }
      if (result.status === "unavailable" || result.status === "disabled")
        return reply.code(503).send({ error: "client_gateway_unavailable" });
      if (result.status === "rejected" || result.status === "conflict")
        return { accepted: true, rejected: true };
      if (result.status === "duplicate")
        return { accepted: true, duplicate: true };
      return { accepted: true, route: result.route };
    },
  );
  app.post(
    "/v1/webhooks/telegram",
    {
      bodyLimit: 65_536,
      preValidation: async (request, reply) => {
        if (
          deps.expertCardEnabled === true &&
          !validRawExpertCardUpdateId(request.body)
        )
          return reply.code(400).send({ error: "invalid_update" });
      },
      onRequest: async (request, reply) => {
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
          return reply
            .code(allowed ? 401 : 429)
            .send({ error: "unauthorized" });
        }
      },
      errorHandler: (error, _request, reply) => {
        if (error.statusCode === 413)
          return reply.code(413).send({ error: "payload_too_large" });
        if (error.statusCode !== undefined && error.statusCode < 500)
          return reply.code(400).send({ error: "invalid_update" });
        return reply.code(503).send({ error: "telegram_gateway_unavailable" });
      },
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
      if (await deletion(request.body, reply)) return;
      if (deps.expertCardEnabled === true && deps.expertCard) {
        const parsed = parseExpertCardTelegramUpdate(
          request.body,
          deps.expertCard,
        );
        if (parsed.kind === "invalid")
          return reply.code(400).send({ error: "invalid_card_update" });
        if (parsed.kind === "parsed") {
          try {
            const legacy = await deps.expertCard.legacyReplay.read({
              botId: deps.expertCard.workBotId,
              updateId: parsed.input.updateId,
            });
            if (legacy === "complete")
              return { accepted: true, duplicate: true };
            if (legacy !== "absent")
              return reply
                .code(503)
                .send({ error: "expert_card_replay_unavailable" });
          } catch {
            return reply
              .code(503)
              .send({ error: "expert_card_replay_unavailable" });
          }
          if (
            !deps.rateLimiter.consume(
              `telegram:expert-card:${deps.expertCard.workBotId}:${parsed.input.telegramUserId}`,
              20,
              60000,
            )
          )
            return reply.code(429).send({ error: "rate_limited" });
          try {
            const result = await deps.expertCard.service.handleWork(
              parsed.input,
            );
            if (result.status === "handled")
              return {
                method: "sendMessage",
                chat_id: parsed.input.chatId,
                text: result.text,
                protect_content: true,
              };
            if (result.status === "duplicate")
              return { accepted: true, duplicate: true };
            if (result.status === "rejected")
              return reply.code(400).send({ error: "invalid_card_update" });
            if (result.status !== "unhandled")
              return reply.code(503).send({ error: "expert_card_unavailable" });
          } catch {
            return reply.code(503).send({ error: "expert_card_unavailable" });
          }
        }
      }
      const body = request.body as Record<string, unknown>;
      const correlationId =
        typeof request.headers["x-correlation-id"] === "string"
          ? request.headers["x-correlation-id"]
          : crypto.randomUUID();
      const callback = body.callback_query;
      if (isBookingCallback(body))
        return bookingCallback(body, reply, correlationId);
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
        // BOT-04: клавиатура попадает в групповой чат (пересланное сообщение), и нажатие в нём
        // приходит с тем же id пользователя. Экспертный callback принимается только из приватной
        // сессии. `message` в апдейте бывает отсутствует, поэтому требование предъявляется лишь
        // когда чат в апдейте есть.
        const callbackMessage = callbackRecord.message;
        const callbackChat =
          callbackMessage && typeof callbackMessage === "object"
            ? (callbackMessage as Record<string, unknown>).chat
            : undefined;
        if (
          callbackChat &&
          typeof callbackChat === "object" &&
          (callbackChat as Record<string, unknown>).type !== "private"
        ) {
          return reply.code(403).send({ error: "unauthorized_expert" });
        }
        if (data.startsWith("xr1.")) {
          if (
            deps.expertCheckoutEnabled !== true ||
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
                idempotencyKey: `telegram:${updateId}:checkout:answer`,
              });
            } catch {
              // Acknowledgement is separate from mutation and link delivery.
            }
          };
          const claim = await deps.inbox.claim("telegram", updateId);
          if (claim.kind === "duplicate") {
            await answerBestEffort("unavailable");
            return { accepted: true, unavailable: true };
          }
          if (claim.kind === "busy") {
            await answerBestEffort("unavailable");
            return reply
              .code(503)
              .send({ error: "expert_checkout_unavailable" });
          }
          try {
            const principal = await deps.expertQueries.resolvePrincipal(
              String(id),
            );
            if (principal === null) {
              await deps.inbox.complete(claim.claimId);
              await answerBestEffort("unavailable");
              return { accepted: true, unavailable: true };
            }
            const result = await deps.expertQueries.processResidencyCheckout({
              data,
              principal,
            });
            if (result.kind === "ready") {
              const delivery =
                await deps.expertQueries.sendResidencyCheckoutLink({
                  idempotencyKey: `telegram:${result.tokenHash}:checkout:delivery`,
                  telegramUserId: principal.telegramUserId,
                  checkoutUrl: result.checkoutUrl,
                });
              if (delivery.kind !== "applied") {
                await deps.inbox.fail(claim.claimId);
                await answerBestEffort("unavailable");
                return reply
                  .code(503)
                  .send({ error: "expert_checkout_delivery_unavailable" });
              }
              await deps.inbox.complete(claim.claimId);
              await answerBestEffort("processed");
              return { accepted: true };
            }
            if (result.kind === "processing") {
              await deps.inbox.fail(claim.claimId);
              await answerBestEffort("unavailable");
              return reply
                .code(503)
                .send({ error: "expert_checkout_unavailable" });
            }
            await deps.inbox.complete(claim.claimId);
            await answerBestEffort("unavailable");
            return { accepted: true, unavailable: true };
          } catch {
            await deps.inbox.fail(claim.claimId);
            await answerBestEffort("unavailable");
            return reply
              .code(503)
              .send({ error: "expert_checkout_unavailable" });
          }
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
            const processResult = await deps.expertQueries.processCommand({
              text,
              chatType: "private",
              principal,
              idempotencyKey: `telegram:${updateId}:command`,
              correlationId,
            });
            if (processResult.deliveryOutcome === "unknown_outcome") {
              await deps.inbox.fail(claim.claimId);
              return reply
                .code(503)
                .send({ error: "expert_query_unavailable" });
            }
            await deps.inbox.complete(claim.claimId);
          } catch {
            await deps.inbox.fail(claim.claimId);
            return reply.code(500).send({ error: "expert_query_unavailable" });
          }
          return { accepted: true };
        }
        if (
          deps.expertAiEnabled === true &&
          deps.expertAi !== undefined &&
          typeof text === "string" &&
          !text.startsWith("/")
        ) {
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
            String(chatRecord.id ?? "") !== telegramUserId ||
            text.trim().length === 0 ||
            text.length > 4_096 ||
            /[\u0000-\u001F\u007F-\u009F]/u.test(text)
          ) {
            return reply.code(403).send({ error: "unauthorized_expert" });
          }
          if (
            !deps.rateLimiter.consume(
              `telegram:expert-ai:${telegramUserId}`,
              20,
              60_000,
            )
          ) {
            return reply.code(429).send({ error: "rate_limited" });
          }
          const principal =
            await deps.expertAi.resolvePrincipal(telegramUserId);
          if (principal?.authenticated !== true)
            return reply.code(403).send({ error: "unauthorized_expert" });
          const updateId = String(body.update_id);
          const claim = await deps.inbox.claim("telegram", updateId);
          if (claim.kind !== "claimed")
            return { accepted: true, duplicate: true };
          try {
            const result = await deps.expertAi.handle({
              principal,
              text,
              locale: "ru-RU",
              idempotencyKey: `telegram:${updateId}:expert-ai`,
              correlationId,
            });
            if (result.kind === "unavailable") {
              await deps.inbox.fail(claim.claimId);
              return reply.code(503).send({ error: "expert_ai_unavailable" });
            }
            await deps.inbox.complete(claim.claimId);
            if (result.kind !== "completed")
              return { accepted: true, unavailable: true };
          } catch {
            await deps.inbox.fail(claim.claimId);
            return reply.code(503).send({ error: "expert_ai_unavailable" });
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
