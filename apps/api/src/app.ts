import type { AdminService, BookingService, CatalogService, ConversationService, PrivacyService } from "@ii-tonya/application";
import type { RuntimeConfig } from "@ii-tonya/config";
import type { PostgresAdminApprovalRepository } from "@ii-tonya/db";
import type { SelartiPort } from "@ii-tonya/integrations";
import { createLogger, type Logger } from "@ii-tonya/observability";
import Fastify, { type FastifyInstance } from "fastify";
import { buildAdminApi } from "./routes/admin.js";
import { healthRoutes, type ReadinessProbe } from "./routes/health.js";
import { selartiWebhookRoutes, type InboxDeduplicator } from "./routes/selarti-webhook.js";
import { telegramWebhookRoutes, type TelegramCallbackService } from "./routes/telegram-webhook.js";

type ApprovalPort = Pick<PostgresAdminApprovalRepository, "resolvePrincipal" | "requestApproval" | "approveApproval">;
export interface AppDependencies {
  config: RuntimeConfig; conversationService: ConversationService; bookingService: BookingService;
  catalogService: CatalogService; privacyService: PrivacyService; adminService: AdminService;
  selarti: SelartiPort; telegramCallbacks: TelegramCallbackService; readiness: ReadinessProbe; logger: Logger;
  inbox: InboxDeduplicator; telegramWebhookSecret: string; adminApprovals?: ApprovalPort;
}
const assertDisabled = (config: RuntimeConfig): void => {
  if (Object.values(config.integrations).some((enabled) => enabled !== false)) throw new Error("Live provider activation is prohibited");
};
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  assertDisabled(deps.config);
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 64_000 });
  await app.register(healthRoutes, { readiness: deps.readiness });
  await app.register(selartiWebhookRoutes, { selarti: deps.selarti, conversation: deps.conversationService, inbox: deps.inbox, logger: deps.logger });
  await app.register(telegramWebhookRoutes, { secret: deps.telegramWebhookSecret, callbacks: deps.telegramCallbacks, inbox: deps.inbox });
  if (deps.adminApprovals !== undefined) {
    const admin = await buildAdminApi({ approvals: deps.adminApprovals, admin: deps.adminService });
    app.all("/v1/admin/*", async (request, reply) => {
      const response = await admin.inject({ method: request.method === "GET" ? "GET" : "POST", url: request.url, headers: request.headers, ...(request.body === undefined ? {} : { payload: request.body as object }) });
      return reply.code(response.statusCode).headers(response.headers).send(response.body);
    });
    app.addHook("onClose", () => admin.close());
  }
  return app as unknown as FastifyInstance;
}

interface TestMockFunction {
  (...args: unknown[]): Promise<unknown>;
  readonly _isMockFunction: true;
  readonly mock: { readonly calls: unknown[][] };
  getMockName(): string;
}
const testMock = (): TestMockFunction => {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]) => { calls.push(args); };
  return Object.assign(fn, { _isMockFunction: true as const, mock: { calls }, getMockName: () => "testMock" });
};
type TestConversation = ConversationService & { handleInbound: TestMockFunction };
type TestTelegram = TelegramCallbackService & { processedUpdateCount(id: string): number };
export type TestApp = FastifyInstance & { services: { conversation: TestConversation; telegram: TestTelegram } };
export async function buildTestApp(): Promise<TestApp> {
  const seen = new Set<string>(); const counts = new Map<string, number>();
  const conversation = { handleInbound: testMock(), handleOutboundDelivery: testMock() } as unknown as TestConversation;
  const telegram = { async process(update: Readonly<Record<string, unknown>>) { const id = String(update.update_id); counts.set(id, (counts.get(id) ?? 0) + 1); }, processedUpdateCount: (id: string) => counts.get(id) ?? 0 } satisfies TestTelegram;
  const never = new Proxy({}, { get: () => testMock() });
  const app = await buildApp({
    config: { databaseUrl: "postgresql://placeholder.invalid/test", integrations: { selarti: false, planerka: false, telegram: false, makeProjection: false, intentModel: false, payments: false }, minorOnboarding: false, rawConversationLogging: false, selartiOutboundBillingMode: "disabled", displayTimezone: "Europe/Moscow" },
    conversationService: conversation, bookingService: never as BookingService, catalogService: never as CatalogService, privacyService: never as PrivacyService, adminService: never as AdminService,
    selarti: { decodeVerifiedWebhook: async () => { throw new Error("unverified"); }, sendMessage: async () => { throw new Error("disabled"); } }, telegramCallbacks: telegram,
    readiness: { check: async () => ({ postgres: true, migrations: true, workerLease: true, adapters: true }) }, logger: createLogger(),
    inbox: { claim: async (provider, id) => { const key = `${provider}:${id}`; if (seen.has(key)) return false; seen.add(key); return true; } }, telegramWebhookSecret: "__PLACEHOLDER_TELEGRAM_WEBHOOK_SECRET__",
  });
  return Object.assign(app, { services: { conversation, telegram } });
}
