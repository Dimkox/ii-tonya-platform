import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createAdminService,
  createClientCatalogService,
  createExpertReferralAdminService,
  createOperatorCaseService,
  ExpertCodeCrypto,
  type BookingService,
  type CatalogService,
  type ConversationService,
  type ExpertCodeKeyring,
  type ExpertAiIngressService,
  type PrivacyService,
  type ClientPrincipalResolver,
} from "@ii-tonya/application";
import { loadEnv } from "@ii-tonya/config";
import {
  checkDbReadiness,
  closeDb,
  createDb,
  defaultMigrationsFolder,
  migrateDb,
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  PostgresExpertReferralAdminRepository,
  PostgresExpertReferralControlRepository,
  PostgresExpertAiRequestReceiptStore,
  PostgresOperatorCaseRepository,
  PostgresClientCatalogRepository,
  PostgresWebhookInboxRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createExpertTelegramIngress,
  DisabledSelartiAdapter,
  EnvironmentExpertCodeSecretResolver,
  type ExpertTelegramIngressFactoryDependencies,
} from "@ii-tonya/integrations";
import { createLogger, shutdownTelemetry } from "@ii-tonya/observability";
import { buildApp, type AppDependencies } from "./app.js";
import { createWindowedRateLimiter } from "./rate-limit.js";
import type { FastifyInstance } from "fastify";
import type { ExpertPrincipalResolver } from "./expert-principal-resolver.js";

export interface ServerLifecycle {
  dependencies(
    config: ReturnType<typeof loadEnv>,
    db: DrizzleDb,
  ): Promise<AppDependencies>;
  migrate(db: DrizzleDb): Promise<void>;
  close(db: DrizzleDb): Promise<void>;
}
const disabledService = <T extends object>(name: string): T =>
  new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error(`${name} is disabled`);
      },
    },
  ) as T;

export const createDefaultLifecycle = (
  options: {
    expertCodeSecretResolver?: {
      resolve(input: {
        reference: string;
        currentVersion: string;
        requiredVersions: readonly string[];
      }): ExpertCodeKeyring;
    };
    expertAiComposition?: {
      readonly ingress: ExpertAiIngressService;
      readonly principals: ExpertPrincipalResolver;
      readonly telegramPrincipals?: {
        resolvePrincipal(
          telegramUserId: string,
        ): ReturnType<ExpertPrincipalResolver["resolve"]>;
      };
    };
    expertTelegramComposition?: Omit<
      ExpertTelegramIngressFactoryDependencies,
      | "enabled"
      | "financialViewsEnabled"
      | "referralMutationsEnabled"
      | "checkoutReadiness"
      | "referral"
      | "residency"
    > &
      Required<
        Pick<ExpertTelegramIngressFactoryDependencies, "referral" | "residency">
      >;
    clientCatalogComposition?: {
      readonly principals: ClientPrincipalResolver;
    };
  } = {},
): ServerLifecycle => ({
  async migrate(db) {
    await migrateDb(db, defaultMigrationsFolder);
  },
  async dependencies(config, db) {
    let expertCodeKeyring: ExpertCodeKeyring | undefined;
    if (config.features?.expertReferral) {
      const keyConfig = config.expertReferralKey;
      if (keyConfig === undefined)
        throw new Error("expert_referral_key_unavailable");
      const requiredVersions =
        await new PostgresExpertReferralControlRepository(
          db,
        ).activeCodeKeyVersions();
      const resolver =
        options.expertCodeSecretResolver ??
        new EnvironmentExpertCodeSecretResolver(process.env);
      expertCodeKeyring = resolver.resolve({
        reference: keyConfig.reference,
        currentVersion: keyConfig.currentVersion,
        requiredVersions,
      });
    }
    const adminApprovals = new PostgresAdminApprovalRepository(db);
    const codeCrypto =
      expertCodeKeyring === undefined
        ? {
            issue() {
              throw new Error("expert_referral_key_unavailable");
            },
            digestCandidates() {
              throw new Error("expert_referral_key_unavailable");
            },
          }
        : new ExpertCodeCrypto(expertCodeKeyring);
    const telegramEnabled =
      config.features.expertTelegramQueries === true ||
      config.features.expertTelegramFinancialViews === true ||
      config.features.expertTelegramReferral === true ||
      config.features.expertTelegramCheckout === true;
    const expertTelegramQueries =
      options.expertTelegramComposition === undefined
        ? undefined
        : createExpertTelegramIngress({
            ...options.expertTelegramComposition,
            enabled: telegramEnabled,
            financialViewsEnabled:
              config.features.expertTelegramFinancialViews === true,
            referralMutationsEnabled:
              config.features.expertTelegramReferral === true,
            checkoutReadiness: config.features.expertTelegramCheckout === true,
          });
    const clientCatalogService =
      config.features.clientCatalog === true &&
      options.clientCatalogComposition !== undefined
        ? createClientCatalogService({
            repository: new PostgresClientCatalogRepository(db),
          })
        : undefined;
    return {
      config,
      ...(expertCodeKeyring === undefined ? {} : { expertCodeKeyring }),
      conversationService: disabledService<ConversationService>(
        "conversation ingress",
      ),
      bookingService: disabledService<BookingService>("booking ingress"),
      catalogService: disabledService<CatalogService>("catalog ingress"),
      privacyService: disabledService<PrivacyService>("privacy ingress"),
      adminService: createAdminService({
        workflows: new PostgresAdminRepository(db),
      }),
      operatorCases: createOperatorCaseService({
        cases: new PostgresOperatorCaseRepository(db),
      }),
      adminApprovals,
      expertReferralAdminService: createExpertReferralAdminService({
        workflows: new PostgresExpertReferralAdminRepository(db, codeCrypto),
      }),
      selarti: new DisabledSelartiAdapter(),
      telegramCallbacks: {
        async isAuthorizedIdentity() {
          return false;
        },
        async verifyCallback() {
          return false;
        },
        async process() {
          throw new Error("Telegram integration is disabled");
        },
      },
      readiness: {
        async check() {
          const state = await checkDbReadiness(db);
          return {
            ...state,
            adapters: Object.values(config.integrations).every(
              (value) => value === false,
            ),
          };
        },
      },
      logger: createLogger(),
      inbox: new PostgresWebhookInboxRepository(db),
      rateLimiter: createWindowedRateLimiter(),
      telegramWebhookSecret: randomBytes(32).toString("base64url"),
      ...(clientCatalogService === undefined
        ? {}
        : {
            clientCatalogService,
            clientPrincipal: options.clientCatalogComposition!.principals,
          }),
      ...(expertTelegramQueries === undefined ? {} : { expertTelegramQueries }),
      ...(options.expertAiComposition === undefined
        ? {}
        : {
            expertAiIngress: options.expertAiComposition.ingress,
            expertAiPrincipal: options.expertAiComposition.principals,
            expertAiRequests: new PostgresExpertAiRequestReceiptStore(db),
            ...(options.expertAiComposition.telegramPrincipals === undefined
              ? {}
              : {
                  expertAiTelegramPrincipal:
                    options.expertAiComposition.telegramPrincipals,
                }),
          }),
    };
  },
  async close(db) {
    await shutdownTelemetry();
    await closeDb(db);
  },
});

export async function composeServer(
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
): Promise<FastifyInstance> {
  await lifecycle.migrate(db);
  return buildApp(await lifecycle.dependencies(loadEnv(process.env), db));
}

export async function closeServer(
  app: FastifyInstance,
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
): Promise<void> {
  await app.close();
  await lifecycle.close(db);
}

export async function listenServer(
  app: FastifyInstance,
  lifecycle: ServerLifecycle,
  db: DrizzleDb,
  address: { host: string; port: number },
  listen: () => Promise<unknown> = () => app.listen(address),
): Promise<void> {
  try {
    await listen();
  } catch (error) {
    await closeServer(app, lifecycle, db);
    throw error;
  }
}

export async function main(
  lifecycle: ServerLifecycle = createDefaultLifecycle(),
): Promise<void> {
  const config = loadEnv(process.env);
  const db = createDb(config.databaseUrl);
  let app: FastifyInstance;
  try {
    app = await composeServer(lifecycle, db);
  } catch (error) {
    await lifecycle.close(db);
    throw error;
  }
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "3000");
  await listenServer(app, lifecycle, db, { host, port });
  let closing: Promise<void> | undefined;
  const shutdown = () => (closing ??= closeServer(app, lifecycle, db));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  void main().catch((error: unknown) => {
    createLogger().fatal({ err: error }, "api startup failed");
    process.exitCode = 1;
  });
}
