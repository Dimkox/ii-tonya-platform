import { expertCardAdminRoutes } from "./routes/expert-cards.js";
import {
  assertExpertCardCapability,
  type ExpertCardCapability,
} from "./expert-card-composition.js";
import { expertVerificationRoutes } from "./routes/expert-verification.js";
import {
  assertExpertVerificationCapability,
  type ExpertVerificationCapability,
} from "./expert-verification-composition.js";
import {
  expertApplicantTelegramRoutes,
  type ExpertApplicantTelegramCapability,
} from "./routes/expert-applicant-telegram.js";
import { assertExpertApplicantCapability } from "./expert-applicant-composition.js";
import type { TelegramDeletionCapability } from "./telegram-deletion.js";
import { createRequire } from "node:module";
import { expertSessionRoutes } from "./routes/expert-sessions.js";
import {
  expertBrowserSessionRoutes,
  type ExpertBrowserOptions,
} from "./routes/expert-browser-session.js";
import type { BookingCallbackService } from "./booking-callback-service.js";
import type { ClientAccountPackagesRepository } from "../../../packages/contracts/src/client-account-packages.js";
import type {
  AdminService,
  BookingService,
  CatalogService,
  ClientCatalogService,
  ClientBookingService,
  ClientPrincipalResolver,
  ClientSessionService,
  ClientNavigationGateway,
  ClientIngressReplayRead,
  ConversationService,
  ExpertAiIngressService,
  ExpertCodeKeyring,
  ExpertReferralAdminService,
  OperatorCaseService,
  PrivacyService,
  ErasureRequestService,
  SelartiProposalAcceptResult,
} from "@ii-tonya/application";
import {
  assertClientNavigationConfig,
  clientTelegramBotId,
  type RuntimeConfig,
} from "@ii-tonya/config";
import type { PostgresAdminApprovalRepository } from "@ii-tonya/db";
import type { SelartiPort } from "@ii-tonya/integrations";
import {
  createLogger,
  classifyFailure,
  httpErrorStatus,
  httpRetryAfter,
  recordClientSessionMetric,
  recordClientBookingMetric,
  type Logger,
} from "@ii-tonya/observability";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import { createWindowedRateLimiter, type RateLimitGate } from "./rate-limit.js";
import { buildAdminApi } from "./routes/admin.js";
import { operatorCaseRoutes } from "./routes/operator-cases.js";
import { buildExpertReferralAdminApi } from "./routes/expert-referral-admin.js";
import {
  expertAiIngressRoutes,
  type ExpertAiRequestLedger,
} from "./routes/expert-ai-ingress.js";
import {
  expertReferralRoutes,
  type ExpertReferralApiDependencies,
} from "./routes/expert-referral.js";
import { healthRoutes, type ReadinessProbe } from "./routes/health.js";
import {
  selartiWebhookRoutes,
  type WebhookInbox,
} from "./routes/selarti-webhook.js";
import {
  telegramWebhookRoutes,
  type TelegramCallbackService,
  type TelegramExpertAiIngress,
  type TelegramExpertQueryIngress,
  type TelegramTestExpertPromoIngress,
} from "./routes/telegram-webhook.js";
import {
  yookassaWebhookRoutes,
  type YooKassaWebhookDependencies,
} from "./routes/yookassa-webhook.js";
import type { ExpertPrincipalResolver } from "./expert-principal-resolver.js";
import { clientCatalogRoutes } from "./routes/client-catalog.js";
import {
  publicClientCatalogRoutes,
  type PublicCatalogRead,
  type PublicCatalogLoadState,
} from "./routes/public-client-catalog.js";
import { clientSessionRoutes } from "./routes/client-sessions.js";
import { clientBookingRoutes } from "./routes/client-booking.js";
import { clientPrivacyRoutes } from "./routes/client-privacy.js";
import { browserAccountRoutes } from "./routes/browser-account.js";
import { assertClientCapabilityPreflight } from "./client-capability-preflight.js";
import { selartiResponseRoutes } from "./routes/selarti-response.js";

// Fastify exposes no public distinction between implicit and explicit 200.
// Use its installed status-set marker, guarded by the differential tests.
const { kReplyHasStatusCode } = createRequire(import.meta.url)(
  "fastify/lib/symbols.js",
) as { kReplyHasStatusCode: symbol };

type ApprovalPort = Pick<
  PostgresAdminApprovalRepository,
  "resolvePrincipal" | "requestApproval" | "approveApproval"
>;
type ClientSessionRevocation = {
  revoke(
    tokenDigest: `sha256:${string}`,
  ): Promise<{ readonly kind: "revoked" } | { readonly kind: "denied" }>;
};
export interface AppDependencies {
  expertCard?: ExpertCardCapability;
  expertVerification?: ExpertVerificationCapability;
  expertApplicantTelegram?: ExpertApplicantTelegramCapability;
  expertSession?: ExpertBrowserOptions;
  config: RuntimeConfig;
  conversationService: ConversationService;
  bookingService: BookingService;
  catalogService: CatalogService;
  privacyService: PrivacyService;
  erasureRequests?: ErasureRequestService;
  telegramDeletion?: TelegramDeletionCapability | undefined;
  consentEvidence?:
    | {
        issuePresentation(command: {
          userId: string;
          purpose: string;
          channel: "web" | "telegram";
          documentKey: string;
        }): Promise<unknown>;
        recordDecision(command: {
          token: string;
          userId: string;
          purpose: string;
          decision: "granted" | "denied";
          policyVersion: string;
          correlationId: string;
        }): Promise<unknown>;
      }
    | undefined;
  adminService: AdminService;
  selarti: SelartiPort;
  telegramCallbacks: TelegramCallbackService;
  readiness: ReadinessProbe;
  logger: Logger;
  inbox: WebhookInbox;
  rateLimiter: RateLimitGate;
  clientIngressEnabled?: boolean | undefined;
  clientNavigationGateway?: Pick<ClientNavigationGateway, "handle">;
  clientBotId?: string;
  clientIngressReplay?: ClientIngressReplayRead;
  clientHybridRoutingEnabled?: boolean | undefined;
  clientBotKey?: string | undefined;
  clientGateway?:
    | {
        handle(
          raw: unknown,
        ): Promise<{ readonly status: string; readonly route?: string }>;
      }
    | undefined;
  telegramWebhookSecret: string;
  bookingCallbacks?: BookingCallbackService;
  selartiResponseSharedSecret?: string;
  selartiResponses?: {
    handle(raw: unknown): Promise<{
      readonly status: SelartiProposalAcceptResult | "unavailable";
    }>;
  };
  adminApprovals?: ApprovalPort;
  operatorCases?: OperatorCaseService;
  expertReferralAdminService?: ExpertReferralAdminService;
  expertApi?: ExpertReferralApiDependencies;
  expertCodeKeyring?: ExpertCodeKeyring;
  expertTelegramQueries?: TelegramExpertQueryIngress;
  expertAiIngress?: ExpertAiIngressService;
  expertAiPrincipal?: ExpertPrincipalResolver;
  expertAiRequests?: ExpertAiRequestLedger;
  expertAiTelegramPrincipal?: Pick<TelegramExpertAiIngress, "resolvePrincipal">;
  yookassaWebhook?: YooKassaWebhookDependencies;
  clientCatalogService?: ClientCatalogService;
  publicCatalog?: PublicCatalogRead;
  publicCatalogLoadState?: PublicCatalogLoadState;
  clientSessionService?: ClientSessionService;
  clientAccountPackages?: ClientAccountPackagesRepository;
  clientSessionRepository?: ClientSessionRevocation;
  clientPrincipal?: ClientPrincipalResolver;
  clientBookingService?: ClientBookingService;
  clientBookingPrincipal?: ClientPrincipalResolver;
  now?: () => Date;
  testExpertPromo?: TelegramTestExpertPromoIngress;
}
const assertDisabled = (config: RuntimeConfig): void => {
  const nonPaymentIntegrations = {
    ...config.integrations,
    payments: false,
  };
  if (
    Object.values(nonPaymentIntegrations).some((enabled) => enabled !== false)
  )
    throw new Error("Live provider activation is prohibited");
};

const diagnostic = (write: () => void): void => {
  try {
    write();
  } catch {
    /* A broken logger cannot alter the HTTP outcome. */
  }
};

function terminalErrorReply(
  reply: FastifyReply,
  statusCode: number,
): FastifyReply {
  const payload = JSON.stringify({
    error:
      statusCode >= 500
        ? "internal_error"
        : statusCode === 413
          ? "body_too_large"
          : "invalid_request",
  });
  // The root error boundary is terminal: re-entering serialization/onSend lets
  // a second failure reach Fastify's prose-bearing parent fallback. onError has
  // already run; raw.end still triggers onResponse. Route-local handlers remain.
  reply.hijack();
  if (reply.raw.headersSent) {
    reply.raw.destroy();
    return reply;
  }
  const fixedHeaders = {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
  };
  const body = reply.request.method === "HEAD" ? undefined : payload;
  try {
    // Preserve headers deliberately set by trusted routes (auth/cookies/CORS),
    // not error.headers. Replace framing left over from the failed response.
    reply.removeHeader("content-encoding");
    reply.removeHeader("transfer-encoding");
    reply.raw.removeHeader("content-encoding");
    reply.raw.removeHeader("transfer-encoding");
    const headers: Record<string, string | number | string[] | undefined> =
      reply.getHeaders();
    reply.raw.writeHead(statusCode, { ...headers, ...fixedHeaders });
    reply.raw.end(body);
  } catch {
    // Invalid preselected headers must not send us back into error serialization.
    if (!reply.raw.headersSent) {
      for (const key of reply.raw.getHeaderNames()) reply.raw.removeHeader(key);
      try {
        reply.raw.writeHead(statusCode, fixedHeaders);
        reply.raw.end(body);
      } catch {
        reply.raw.destroy();
      }
    } else reply.raw.destroy();
  }
  return reply;
}

export async function buildApp(
  deps: AppDependencies,
): Promise<FastifyInstance> {
  assertDisabled(deps.config);
  assertExpertCardCapability(deps.config, deps.expertCard);
  if (
    deps.config.features.expertCard === true &&
    deps.expertCard?.webhookSecret !== deps.telegramWebhookSecret
  )
    throw new Error("expert_card_webhook_scope_conflict");
  assertExpertVerificationCapability(deps.config, deps.expertVerification);
  assertExpertApplicantCapability(deps.config, deps.expertApplicantTelegram);
  if (
    deps.config.features.expertSession === true &&
    (!deps.expertSession?.sessions ||
      !deps.expertSession.lookup ||
      !deps.expertSession.principals ||
      !deps.expertSession.origin ||
      !deps.expertSession.botUsername)
  )
    throw new Error("expert_session_capability_unavailable");
  const expertSession =
    deps.config.features.expertSession === true ? deps.expertSession! : {};
  assertClientNavigationConfig(deps.config);
  if (
    deps.config.features.clientTelegramNavigation === true &&
    (typeof deps.clientNavigationGateway?.handle !== "function" ||
      typeof deps.clientIngressReplay?.hasReceipt !== "function" ||
      deps.clientBotId !==
        clientTelegramBotId(deps.config.clientTelegramBotToken) ||
      deps.clientBotKey !== deps.config.clientTelegramBotKey ||
      deps.telegramWebhookSecret !== deps.config.telegramWebhookSecret ||
      deps.clientIngressEnabled === true ||
      deps.clientHybridRoutingEnabled === true)
  )
    throw new Error("client_navigation_capability_unavailable");
  const clientBotId = clientTelegramBotId(deps.config.clientTelegramBotToken);
  if (
    (deps.config.features.clientTelegramIngress === true ||
      deps.clientIngressEnabled === true) &&
    (clientBotId === undefined ||
      deps.clientBotId !== clientBotId ||
      typeof deps.clientIngressReplay?.hasReceipt !== "function")
  )
    throw new Error("client_ingress_replay_capability_unavailable");
  const sessionCapability =
    deps.clientSessionService !== undefined &&
    deps.clientSessionRepository !== undefined &&
    deps.clientPrincipal !== undefined;
  assertClientCapabilityPreflight(deps.config.features, {
    identityProofVerifier: sessionCapability,
    bookingRuntime:
      deps.clientBookingService !== undefined &&
      deps.clientBookingPrincipal !== undefined,
  });
  if (
    (deps.config.features.expertReferral ||
      deps.config.features.expertResidencyBilling) &&
    deps.expertApi === undefined
  ) {
    throw new Error("Expert API runtime capability is required");
  }
  if (
    deps.config.features.clientBooking === true &&
    (deps.clientBookingService === undefined ||
      deps.clientBookingPrincipal === undefined ||
      deps.clientCatalogService === undefined)
  ) {
    throw new Error("Client booking runtime capability is required");
  }
  if (
    (deps.config.features.expertTelegramQueries === true ||
      deps.config.features.expertTelegramFinancialViews === true ||
      deps.config.features.expertTelegramReferral === true) &&
    deps.expertTelegramQueries === undefined
  ) {
    throw new Error("Expert Telegram query capability is required");
  }
  if (
    deps.config.features.expertTelegramCheckout === true &&
    deps.expertTelegramQueries === undefined
  ) {
    throw new Error("Expert Telegram checkout capability is required");
  }
  if (
    deps.config.features.expertAiIngress === true &&
    (deps.expertAiIngress === undefined ||
      deps.expertAiPrincipal === undefined ||
      deps.expertAiRequests === undefined)
  ) {
    throw new Error("Expert AI ingress runtime capability is required");
  }
  if (
    deps.config.features.clientCatalog === true &&
    (deps.clientCatalogService === undefined ||
      deps.clientPrincipal === undefined)
  ) {
    throw new Error("Client catalog runtime capability is required");
  }
  if (
    deps.config.features.selartiResponseIngress === true &&
    (deps.selartiResponses === undefined ||
      deps.selartiResponseSharedSecret === undefined)
  ) {
    throw new Error("Selarti response runtime capability is required");
  }
  if (
    deps.config.features.testExpertPromo === true &&
    (deps.testExpertPromo === undefined ||
      deps.config.features.testExpertDeterministicFlow !== true ||
      deps.config.features.clientTelegramIngress !== true ||
      deps.clientBotKey === undefined)
  )
    throw new Error("Test expert promo runtime capability is required");
  if (
    deps.config.features.testExpertSelarti === true &&
    (deps.testExpertPromo?.residualEnabled !== true ||
      deps.config.features.clientHybridRouting !== true ||
      deps.config.features.selartiCostAdmission !== true ||
      deps.config.features.selartiResponseIngress !== true ||
      deps.config.features.b2TelegramDispatch !== true ||
      deps.config.features.b2SensitiveRetention !== true)
  )
    throw new Error("Test expert residual runtime capability is required");
  if (
    deps.config.expertVerification?.paymentVerificationEnabled &&
    (!deps.config.features.yookassa ||
      !deps.expertVerification?.onboardingWebhook ||
      deps.yookassaWebhook?.onboarding !==
        deps.expertVerification.onboardingWebhook)
  )
    throw new Error("expert_verification_merchant_callback_required");
  if (
    deps.config.features.expertCard === true &&
    deps.config.expertCard?.mainCheckoutEnabled &&
    (!deps.config.features.yookassa || !deps.yookassaWebhook)
  )
    throw new Error("expert_card_merchant_callback_required");
  const yookassaEnabled = deps.config.features.yookassa === true;
  if (
    yookassaEnabled !== deps.config.integrations.payments ||
    yookassaEnabled !== (deps.config.yookassa !== undefined) ||
    yookassaEnabled !== (deps.yookassaWebhook !== undefined)
  ) {
    throw new Error("YooKassa runtime capability is required");
  }
  const app = Fastify({
    loggerInstance: deps.logger,
    logController: new LogController({ disableRequestLogging: true }),
    frameworkErrors(error, request, reply: FastifyReply) {
      // Router decoding errors precede normal error handlers and otherwise echo paths.
      const statusCode = httpErrorStatus(
        error,
        reply.statusCode,
        Object.getOwnPropertyDescriptor(reply, kReplyHasStatusCode)?.value ===
          true,
      );
      diagnostic(() =>
        request.log.error({
          event: "http_request_failed",
          method: request.method,
          statusCode,
          failureClass:
            statusCode >= 500 ? "internal_error" : "invalid_request",
        }),
      );
      return terminalErrorReply(reply, statusCode);
    },
    bodyLimit: 64_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  // Register at the root so plugins inherit this boundary and can retain their
  // stricter local status contracts (notably session/booking oversized 400s).
  app.setNotFoundHandler((request, reply) => {
    diagnostic(() =>
      request.log.info({
        event: "http_not_found",
        method: request.method,
        statusCode: 404,
      }),
    );
    return reply.code(404).send({ error: "not_found" });
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = httpErrorStatus(
      error,
      reply.statusCode,
      Object.getOwnPropertyDescriptor(reply, kReplyHasStatusCode)?.value ===
        true,
    );
    const retryAfter = httpRetryAfter(error);
    if (retryAfter !== undefined) reply.header("retry-after", retryAfter);
    diagnostic(() =>
      request.log.error({
        event: "http_request_failed",
        method: request.method,
        statusCode,
        failureClass: classifyFailure(error),
      }),
    );
    return terminalErrorReply(reply, statusCode);
  });
  app.addHook("onResponse", async (request, reply) => {
    diagnostic(() =>
      request.log.info({
        event: "http_request_completed",
        method: request.method,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      }),
    );
  });
  if (deps.expertCodeKeyring !== undefined) {
    app.decorate("expertCodeKeyring", deps.expertCodeKeyring);
  }
  await app.register(healthRoutes, { readiness: deps.readiness });
  await app.register(publicClientCatalogRoutes, {
    ...(deps.publicCatalog === undefined
      ? {}
      : { catalog: deps.publicCatalog }),
    ...(deps.publicCatalogLoadState === undefined
      ? {}
      : { loadState: deps.publicCatalogLoadState }),
  });
  if (
    deps.config.features.clientSession === true &&
    deps.clientSessionService !== undefined &&
    deps.clientSessionRepository !== undefined &&
    deps.clientPrincipal !== undefined
  ) {
    await app.register(clientSessionRoutes, {
      sessions: {
        issue: (identityProof, signal) =>
          deps.clientSessionService!.issue(identityProof, signal),
        revoke: (tokenDigest) =>
          deps.clientSessionRepository!.revoke(tokenDigest),
      },
      principals: deps.clientPrincipal,
      metrics: { record: recordClientSessionMetric },
    });
  }
  if (
    deps.config.features.clientCatalog === true &&
    deps.clientCatalogService !== undefined &&
    deps.clientPrincipal !== undefined
  ) {
    await app.register(clientCatalogRoutes, {
      catalog: deps.clientCatalogService,
      principals: deps.clientPrincipal,
    });
  }
  if (
    deps.config.features.clientBooking === true &&
    deps.clientBookingService !== undefined &&
    deps.clientBookingPrincipal !== undefined
  ) {
    await app.register(clientBookingRoutes, {
      bookings: deps.clientBookingService,
      principals: deps.clientBookingPrincipal,
      reserveEnabled: deps.config.features.clientBookingReserve === true,
      metrics: { record: recordClientBookingMetric },
    });
  }
  if (
    deps.config.features.clientPrivacy === true &&
    deps.clientPrincipal !== undefined
  ) {
    await app.register(clientPrivacyRoutes, {
      privacy: deps.privacyService,
      principals: deps.clientPrincipal,
      // Erasure remains uncomposed until content, processor and backup coverage is verified.
      ...(deps.consentEvidence === undefined
        ? {}
        : { consentEvidence: deps.consentEvidence }),
    });
  }
  await app.register(browserAccountRoutes, {
    ...(deps.config.features.clientSession === true &&
    deps.clientAccountPackages
      ? { clientAccountPackages: deps.clientAccountPackages }
      : {}),
    logLevel: "silent",
    ...(deps.config.clientWeb === undefined
      ? {}
      : {
          origin: deps.config.clientWeb.origin,
          botUsername: deps.config.clientWeb.botUsername,
        }),
    widgetEnabled: deps.config.clientWeb?.widgetEnabled === true,
    privacyEnabled: deps.config.features.clientPrivacy === true,
    erasureRequestsEnabled: deps.config.features.clientErasureRequests === true,
    ...(deps.erasureRequests ? { erasureRequests: deps.erasureRequests } : {}),
    bookingEnabled:
      deps.config.features.clientBooking === true &&
      deps.clientBookingService !== undefined,
    bookingReserveEnabled: deps.config.features.clientBookingReserve === true,
    catalogEnabled:
      deps.config.features.clientCatalog === true &&
      deps.clientCatalogService !== undefined,
    ...(deps.clientBookingPrincipal === undefined
      ? {}
      : { bookingPrincipals: deps.clientBookingPrincipal }),
    ...(deps.config.features.clientSession !== true ||
    !deps.clientSessionService ||
    !deps.clientSessionRepository ||
    !deps.clientPrincipal
      ? {}
      : {
          sessions: {
            issue: (proof, signal) =>
              deps.clientSessionService!.issue(proof, signal),
            revoke: (digest) => deps.clientSessionRepository!.revoke(digest),
          },
          principals: deps.clientPrincipal,
        }),
  });
  if (deps.yookassaWebhook !== undefined) {
    await app.register(yookassaWebhookRoutes, deps.yookassaWebhook);
  }
  await app.register(selartiWebhookRoutes, {
    selarti: deps.selarti,
    conversation: deps.conversationService,
    logger: deps.logger,
    rateLimiter: deps.rateLimiter,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  await app.register(selartiResponseRoutes, {
    enabled: deps.config.features.selartiResponseIngress === true,
    secret:
      deps.selartiResponseSharedSecret ??
      "disabled_B2_response_secret_0000000000000000",
    responses: deps.selartiResponses ?? {
      async handle() {
        return { status: "unavailable" as const };
      },
    },
    rateLimiter: deps.rateLimiter,
  });
  await app.register(expertCardAdminRoutes, {
    enabled: deps.config.features.expertCard === true,
    ...(deps.expertCard ? { service: deps.expertCard.admin } : {}),
  });
  await app.register(expertVerificationRoutes, {
    enabled: deps.config.features.expertVerification === true,
    ...(deps.expertVerification
      ? { service: deps.expertVerification.service }
      : {}),
  });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: deps.config.features.expertApplicant === true,
    ...(deps.expertApplicantTelegram
      ? { capability: deps.expertApplicantTelegram }
      : {}),
  });
  await app.register(telegramWebhookRoutes, {
    expertCardEnabled: deps.config.features.expertCard === true,
    ...(deps.expertCard ? { expertCard: deps.expertCard } : {}),
    ...(deps.config.features.clientPrivacy === true &&
    deps.config.features.clientErasureRequests === true &&
    deps.telegramDeletion
      ? { deletion: deps.telegramDeletion }
      : {}),
    bookingCallbacksEnabled: deps.config.features.bookingCallbacks === true,
    ...(deps.bookingCallbacks === undefined
      ? {}
      : { bookingCallbacks: deps.bookingCallbacks }),
    secret: deps.telegramWebhookSecret,
    clientIngressEnabled: deps.clientIngressEnabled,
    clientNavigationEnabled: deps.config.features.clientTelegramNavigation,
    clientNavigationGateway: deps.clientNavigationGateway,
    clientBotId: deps.clientBotId,
    clientIngressReplay: deps.clientIngressReplay,
    clientHybridRoutingEnabled: deps.clientHybridRoutingEnabled,
    clientBotKey: deps.clientBotKey,
    clientGateway: deps.clientGateway,
    testExpertPromoEnabled:
      deps.config.features.testExpertPromo === true &&
      deps.config.features.testExpertDeterministicFlow === true,
    ...(deps.testExpertPromo === undefined
      ? {}
      : { testExpertPromo: deps.testExpertPromo }),
    callbacks: deps.telegramCallbacks,
    inbox: deps.inbox,
    rateLimiter: deps.rateLimiter,
    expertQueriesEnabled:
      deps.config.features.expertTelegramQueries === true ||
      deps.config.features.expertTelegramFinancialViews === true ||
      deps.config.features.expertTelegramReferral === true,
    expertCheckoutEnabled: deps.config.features.expertTelegramCheckout === true,
    ...(deps.expertTelegramQueries === undefined
      ? {}
      : { expertQueries: deps.expertTelegramQueries }),
    expertAiEnabled:
      deps.config.features.expertAiIngress === true &&
      deps.expertAiIngress !== undefined &&
      deps.expertAiTelegramPrincipal !== undefined,
    ...(deps.expertAiIngress === undefined ||
    deps.expertAiTelegramPrincipal === undefined
      ? {}
      : {
          expertAi: {
            resolvePrincipal: deps.expertAiTelegramPrincipal.resolvePrincipal,
            handle: deps.expertAiIngress.handle,
          },
        }),
  });
  if (deps.expertApi !== undefined) {
    await app.register(expertReferralRoutes, {
      ...deps.expertApi,
      enabled: deps.config.features,
    });
  }
  if (
    deps.config.features.expertAiIngress === true &&
    deps.expertAiIngress !== undefined &&
    deps.expertAiPrincipal !== undefined &&
    deps.expertAiRequests !== undefined
  ) {
    await app.register(expertAiIngressRoutes, {
      ingress: deps.expertAiIngress,
      principals: deps.expertAiPrincipal,
      requests: deps.expertAiRequests,
    });
  }
  if (deps.adminApprovals !== undefined) {
    const admin = await buildAdminApi({
      approvals: deps.adminApprovals,
      admin: deps.adminService,
    });
    const expertAdmin =
      deps.expertReferralAdminService === undefined
        ? undefined
        : await buildExpertReferralAdminApi({
            approvals: deps.adminApprovals,
            admin: deps.expertReferralAdminService,
            environmentCeilings: {
              expertReferral: deps.config.features?.expertReferral ?? false,
              expertResidencyBilling:
                deps.config.features?.expertResidencyBilling ?? false,
            },
          });
    if (expertAdmin !== undefined)
      app.get(
        "/v1/admin/expert-referrals/inventory",
        async (request, reply) => {
          const response = await expertAdmin.inject({
            method: "GET",
            url: request.url,
            headers: request.headers,
          });
          reply.code(response.statusCode);
          for (const [name, value] of Object.entries(response.headers))
            if (name !== "content-length" && value !== undefined)
              reply.header(name, value);
          return reply.send(response.rawPayload);
        },
      );
    if (deps.operatorCases !== undefined)
      await app.register(operatorCaseRoutes, {
        approvals: deps.adminApprovals,
        cases: deps.operatorCases,
      });
    for (const path of [
      "/v1/admin/expert-residency/late-payments",
      "/v1/admin/expert-residency/late-payments/:errorId",
    ])
      app.get(path, async (request, reply) => {
        const response = await admin.inject({
          method: "GET",
          url: request.url,
          headers: request.headers,
        });
        reply.code(response.statusCode);
        for (const [name, value] of Object.entries(response.headers))
          if (name !== "content-length" && value !== undefined)
            reply.header(name, value);
        return reply.send(response.rawPayload);
      });
    app.post("/v1/admin/*", async (request, reply) => {
      const expertAction =
        /^\/v1\/admin\/actions\/(?:expert_referral|expert_residency)\./u.test(
          request.url,
        );
      const target =
        expertAdmin !== undefined && expertAction ? expertAdmin : admin;
      const response = await target.inject({
        method: "POST",
        url: request.url,
        headers: request.headers,
        ...(request.body === undefined
          ? {}
          : { payload: request.body as object }),
      });
      reply.code(response.statusCode);
      for (const [name, value] of Object.entries(response.headers)) {
        if (name !== "content-length" && value !== undefined)
          reply.header(name, value);
      }
      return reply.send(response.rawPayload);
    });
    app.addHook("onClose", async () => {
      await admin.close();
      await expertAdmin?.close();
    });
  }
  await app.register(expertSessionRoutes, expertSession);
  await app.register(expertBrowserSessionRoutes, {
    ...expertSession,
    receiptCapture: deps.expertApi?.receiptCapture,
    // The browser facade must not activate billing or fall back to legacy pricing.
    campaign:
      deps.config.features.expertSession === true &&
      deps.config.features.expertResidencyBilling &&
      deps.expertApi?.residency.kind === "campaign"
        ? deps.expertApi.residency
        : undefined,
  });
  return app as unknown as FastifyInstance;
}

interface TestMockFunction {
  (...args: unknown[]): Promise<unknown>;
  readonly _isMockFunction: true;
  readonly mock: { readonly calls: unknown[][] };
  getMockName(): string;
}
const testMock = (
  implementation: (...args: unknown[]) => Promise<unknown> = async () =>
    undefined,
): TestMockFunction => {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]) => {
    calls.push(args);
    return implementation(...args);
  };
  return Object.assign(fn, {
    _isMockFunction: true as const,
    mock: { calls },
    getMockName: () => "testMock",
  });
};
type TestConversation = ConversationService & {
  handleInbound: TestMockFunction;
};
type TestTelegram = TelegramCallbackService & {
  processedUpdateCount(id: string): number;
};
export type TestApp = FastifyInstance & {
  services: { conversation: TestConversation; telegram: TestTelegram };
};
export async function buildTestApp(
  options: {
    telegramDeletion?: TelegramDeletionCapability;
    callbackVerified?: boolean;
    authorizedIdentity?: boolean;
    telegramFailOnce?: boolean;
    now?: () => number;
    selartiEvent?: Awaited<ReturnType<SelartiPort["decodeVerifiedWebhook"]>>;
    selartiFailOnce?: boolean;
    expertApi?: ExpertReferralApiDependencies;
    expertTelegramQueries?: TelegramExpertQueryIngress;
    expertAiIngress?: ExpertAiIngressService;
    expertAiPrincipal?: ExpertPrincipalResolver;
    expertAiRequests?: ExpertAiRequestLedger;
    expertAiTelegramPrincipal?: Pick<
      TelegramExpertAiIngress,
      "resolvePrincipal"
    >;
    yookassaWebhook?: YooKassaWebhookDependencies;
    clientCatalogService?: ClientCatalogService;
    publicCatalog?: PublicCatalogRead;
    publicCatalogLoadState?: PublicCatalogLoadState;
    clientSessionService?: ClientSessionService;
    clientAccountPackages?: ClientAccountPackagesRepository;
    clientSessionRepository?: ClientSessionRevocation;
    clientPrincipal?: ClientPrincipalResolver;
    features?: Partial<RuntimeConfig["features"]>;
  } = {},
): Promise<TestApp> {
  const receipts = new Map<string, "processing" | "complete">();
  const counts = new Map<string, number>();
  let selartiFailures = options.selartiFailOnce === true ? 1 : 0;
  const conversation = {
    handleInbound: testMock(async () => {
      if (selartiFailures-- > 0) throw new Error("temporary");
      return { kind: "answer_queued", chargedMessages: 1 };
    }),
    handleOutboundDelivery: testMock(),
  } as unknown as TestConversation;
  let telegramFailures = options.telegramFailOnce === true ? 1 : 0;
  const telegram = {
    async isAuthorizedIdentity() {
      return options.authorizedIdentity ?? true;
    },
    async verifyCallback() {
      return options.callbackVerified ?? true;
    },
    async process(update: Readonly<Record<string, unknown>>) {
      if (telegramFailures-- > 0) throw new Error("temporary");
      const id = String(update.update_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    },
    processedUpdateCount: (id: string) => counts.get(id) ?? 0,
  } satisfies TestTelegram;
  const never = new Proxy({}, { get: () => testMock() });
  const app = await buildApp({
    config: {
      databaseUrl: "postgresql://placeholder.invalid/test",
      integrations: {
        selarti: false,
        planerka: false,
        telegram: false,
        makeProjection: false,
        intentModel: false,
        payments: options.features?.yookassa === true,
      },
      minorOnboarding: false,
      rawConversationLogging: false,
      selartiOutboundBillingMode: "disabled",
      displayTimezone: "Europe/Moscow",
      yookassaRecovery: { enabled: false },
      features: {
        workerOutboxDelivery: false,
        clientSession: false,
        clientCatalog: false,
        expertReferral: false,
        expertReferralMaturityWorker: false,
        expertResidencyBilling: false,
        ...options.features,
      },
      ...(options.features?.yookassa === true
        ? {
            yookassa: {
              mode: "test" as const,
              shopId: "123456",
              secretReference: "env://YOOKASSA_SECRET_KEY" as const,
              returnUrl: "https://ii-tonya.ru/payments/return",
              receipt: {
                vatCode: 1 as const,
                paymentSubject: "service",
                paymentMode: "full_payment",
              },
            },
          }
        : {}),
    },
    conversationService: conversation,
    bookingService: never as BookingService,
    catalogService: never as CatalogService,
    privacyService: never as PrivacyService,
    adminService: never as AdminService,
    selarti: {
      decodeVerifiedWebhook: async () => {
        if (options.selartiEvent === undefined) throw new Error("unverified");
        return options.selartiEvent;
      },
      sendMessage: async () => {
        throw new Error("disabled");
      },
    },
    ...(options.telegramDeletion
      ? { telegramDeletion: options.telegramDeletion }
      : {}),
    telegramCallbacks: telegram,
    readiness: {
      check: async () => ({
        postgres: true,
        migrations: true,
        workerLease: true,
        adapters: true,
      }),
    },
    logger: createLogger(),
    inbox: {
      claim: async (provider, id) => {
        const key = `${provider}:${id}`;
        if (receipts.has(key))
          return {
            kind:
              receipts.get(key) === "complete"
                ? ("duplicate" as const)
                : ("busy" as const),
          };
        receipts.set(key, "processing");
        return { kind: "claimed" as const, claimId: key };
      },
      complete: async (id) => {
        receipts.set(id, "complete");
      },
      fail: async (id) => {
        receipts.delete(id);
      },
    },
    rateLimiter: createWindowedRateLimiter(
      options.now === undefined ? {} : { now: options.now },
    ),
    telegramWebhookSecret: "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__",
    ...(options.expertApi === undefined
      ? {}
      : { expertApi: options.expertApi }),
    ...(options.expertTelegramQueries === undefined
      ? {}
      : { expertTelegramQueries: options.expertTelegramQueries }),
    ...(options.expertAiIngress === undefined
      ? {}
      : { expertAiIngress: options.expertAiIngress }),
    ...(options.expertAiPrincipal === undefined
      ? {}
      : { expertAiPrincipal: options.expertAiPrincipal }),
    ...(options.expertAiRequests === undefined
      ? {}
      : { expertAiRequests: options.expertAiRequests }),
    ...(options.expertAiTelegramPrincipal === undefined
      ? {}
      : { expertAiTelegramPrincipal: options.expertAiTelegramPrincipal }),
    ...(options.yookassaWebhook === undefined
      ? {}
      : { yookassaWebhook: options.yookassaWebhook }),
    ...(options.clientCatalogService === undefined
      ? {}
      : { clientCatalogService: options.clientCatalogService }),
    ...(options.publicCatalog === undefined
      ? {}
      : { publicCatalog: options.publicCatalog }),
    publicCatalogLoadState: options.publicCatalogLoadState ?? {
      limiter: createWindowedRateLimiter(),
      inFlight: 0,
    },
    ...(options.clientAccountPackages === undefined
      ? {}
      : { clientAccountPackages: options.clientAccountPackages }),
    ...(options.clientSessionService === undefined
      ? {}
      : { clientSessionService: options.clientSessionService }),
    ...(options.clientSessionRepository === undefined
      ? {}
      : { clientSessionRepository: options.clientSessionRepository }),
    ...(options.clientPrincipal === undefined
      ? {}
      : { clientPrincipal: options.clientPrincipal }),
    ...(options.now === undefined
      ? {}
      : { now: () => new Date(options.now!()) }),
  });
  return Object.assign(app, { services: { conversation, telegram } });
}
