import type {
  AdminService,
  BookingService,
  CatalogService,
  ConversationService,
  ExpertReferralAdminService,
  PrivacyService,
} from "@ii-tonya/application";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { PostgresAdminApprovalRepository } from "@ii-tonya/db";
import type { SelartiPort } from "@ii-tonya/integrations";
import { createLogger, type Logger } from "@ii-tonya/observability";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { createWindowedRateLimiter, type RateLimitGate } from "./rate-limit.js";
import { buildAdminApi } from "./routes/admin.js";
import { buildExpertReferralAdminApi } from "./routes/expert-referral-admin.js";
import {
  expertReferralRoutes,
  type ExpertReferralRouteDependencies,
} from "./routes/expert-referral.js";
import { healthRoutes, type ReadinessProbe } from "./routes/health.js";
import {
  selartiWebhookRoutes,
  type WebhookInbox,
} from "./routes/selarti-webhook.js";
import {
  telegramWebhookRoutes,
  type TelegramCallbackService,
} from "./routes/telegram-webhook.js";

type ApprovalPort = Pick<
  PostgresAdminApprovalRepository,
  "resolvePrincipal" | "requestApproval" | "approveApproval"
>;
export interface AppDependencies {
  config: RuntimeConfig;
  conversationService: ConversationService;
  bookingService: BookingService;
  catalogService: CatalogService;
  privacyService: PrivacyService;
  adminService: AdminService;
  selarti: SelartiPort;
  telegramCallbacks: TelegramCallbackService;
  readiness: ReadinessProbe;
  logger: Logger;
  inbox: WebhookInbox;
  rateLimiter: RateLimitGate;
  telegramWebhookSecret: string;
  adminApprovals?: ApprovalPort;
  expertReferralAdminService?: ExpertReferralAdminService;
  expertReferral?: ExpertReferralRouteDependencies;
  now?: () => Date;
}
const assertDisabled = (config: RuntimeConfig): void => {
  if (Object.values(config.integrations).some((enabled) => enabled !== false))
    throw new Error("Live provider activation is prohibited");
};
export async function buildApp(
  deps: AppDependencies,
): Promise<FastifyInstance> {
  assertDisabled(deps.config);
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 64_000 });
  await app.register(healthRoutes, { readiness: deps.readiness });
  await app.register(selartiWebhookRoutes, {
    selarti: deps.selarti,
    conversation: deps.conversationService,
    logger: deps.logger,
    rateLimiter: deps.rateLimiter,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  await app.register(telegramWebhookRoutes, {
    secret: deps.telegramWebhookSecret,
    callbacks: deps.telegramCallbacks,
    inbox: deps.inbox,
    rateLimiter: deps.rateLimiter,
  });
  if (deps.expertReferral !== undefined) {
    await app.register(expertReferralRoutes, deps.expertReferral);
  }
  if (deps.adminApprovals !== undefined) {
    const admin = await buildAdminApi({
      approvals: deps.adminApprovals,
      admin: deps.adminService,
    });
    app.post("/v1/admin/*", async (request, reply) => {
      const response = await admin.inject({
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
    app.addHook("onClose", () => admin.close());
  }
  if (
    deps.adminApprovals !== undefined &&
    deps.expertReferralAdminService !== undefined
  ) {
    const expertReferralAdmin = await buildExpertReferralAdminApi({
      approvals: deps.adminApprovals,
      admin: deps.expertReferralAdminService,
    });
    const forward = async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await expertReferralAdmin.inject({
        method: request.method as "GET" | "POST",
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
    };
    app.route({
      method: ["GET", "POST"],
      url: "/v1/admin/expert-referrals/*",
      handler: forward,
    });
    app.addHook("onClose", () => expertReferralAdmin.close());
  }
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
    callbackVerified?: boolean;
    authorizedIdentity?: boolean;
    telegramFailOnce?: boolean;
    now?: () => number;
    selartiEvent?: Awaited<ReturnType<SelartiPort["decodeVerifiedWebhook"]>>;
    selartiFailOnce?: boolean;
    expertReferralAdmin?: {
      readonly approvals: ApprovalPort;
      readonly service: ExpertReferralAdminService;
    };
    expertReferral?: ExpertReferralRouteDependencies;
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
        payments: false,
      },
      minorOnboarding: false,
      rawConversationLogging: false,
      selartiOutboundBillingMode: "disabled",
      displayTimezone: "Europe/Moscow",
      features: { expertReferral: false, expertResidencyBilling: false },
      expertReferralKeys: null,
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
    ...(options.expertReferralAdmin === undefined
      ? {}
      : {
          adminApprovals: options.expertReferralAdmin.approvals,
          expertReferralAdminService: options.expertReferralAdmin.service,
        }),
    ...(options.expertReferral === undefined
      ? {}
      : { expertReferral: options.expertReferral }),
    ...(options.now === undefined
      ? {}
      : { now: () => new Date(options.now!()) }),
  });
  return Object.assign(app, { services: { conversation, telegram } });
}
