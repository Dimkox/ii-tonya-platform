import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createPrivacyService,
  createAdminService,
  createClientCatalogService,
  createClientBookingService,
  createClientSessionService,
  createExpertReferralAdminService,
  createOperatorCaseService,
  ExpertCodeCrypto,
  type BookingService,
  type CatalogService,
  type ConversationService,
  type ExpertCodeKeyring,
  type ExpertAiIngressService,
  type PrivacyService,
  type IdentityProofVerifier,
  type ClientCommercialPolicyPort,
  HybridMessageGateway,
  createSelartiResponseService,
  TestExpertTelegramService,
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
  PostgresPrivacyRepository,
  PostgresConsentEvidenceRepository,
  currentConsentGrantedSql,
  sql,
  PostgresExpertReferralAdminRepository,
  PostgresExpertReferralControlRepository,
  PostgresExpertAiRequestReceiptStore,
  PostgresOperatorCaseRepository,
  PostgresClientCatalogRepository,
  PostgresCatalogRepository,
  PostgresBookingRepository,
  PostgresClientSessionRepository,
  PostgresWebhookInboxRepository,
  PostgresHybridMessageRepository,
  PostgresSelartiProposalRepository,
  PostgresTestExpertTelegramRepository,
  PostgresExpertTrialPricingPolicy,
  PostgresPartnerTrialPricingPolicy,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createExpertTelegramIngress,
  DisabledSelartiAdapter,
  EnvironmentExpertCodeSecretResolver,
  type ExpertTelegramIngressFactoryDependencies,
} from "@ii-tonya/integrations";
import {
  createLogger,
  installFatalProcessLogging,
  recordClientSessionMetric,
  recordSelartiBudgetMetric,
  shutdownTelemetry,
} from "@ii-tonya/observability";
import { buildApp, type AppDependencies } from "./app.js";
import { createTelegramClientProofVerifier } from "./telegram-client-proof.js";
import { createWindowedRateLimiter } from "./rate-limit.js";
import type { FastifyInstance } from "fastify";
import type { ExpertPrincipalResolver } from "./expert-principal-resolver.js";
import { assertClientCapabilityPreflight } from "./client-capability-preflight.js";
import { createClientPrincipalResolver } from "./client-principal-resolver.js";
import { createClientBookingPrincipalResolver } from "./client-booking-principal-resolver.js";
import { createClientProofVerifierGate } from "./client-proof-verifier-gate.js";
import {
  clientSessionTokenHash,
  createClientSessionToken,
} from "./client-session-token.js";

export interface ServerLifecycle {
  preflight(config: ReturnType<typeof loadEnv>): void;
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
    clientSessionComposition?: {
      readonly verifier: IdentityProofVerifier;
    };
    clientCommercialPolicyRepository?: ClientCommercialPolicyPort;
    testExpertMetricSink?: {
      record(
        event: import("@ii-tonya/application").TestExpertTrialMetricEvent,
      ): void;
    };
  } = {},
): ServerLifecycle => ({
  preflight(config) {
    if (
      config.features.clientFreeAccessV2 === true &&
      options.clientCommercialPolicyRepository === undefined
    ) {
      throw new Error("client_commercial_policy_repository_unavailable");
    }
    if (
      config.features.testExpertPromo === true &&
      config.features.testExpertDeterministicFlow === true &&
      options.testExpertMetricSink === undefined
    )
      throw new Error("test_expert_metric_sink_unavailable");
    assertClientCapabilityPreflight(config.features, {
      identityProofVerifier:
        options.clientSessionComposition?.verifier !== undefined ||
        (config.clientTelegramBotToken !== undefined &&
          /^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u.test(
            config.clientTelegramBotToken,
          )),
      bookingRuntime: true,
    });
    if (
      config.features.clientFreeAccessV2 === true &&
      options.clientCommercialPolicyRepository === undefined
    ) {
      throw new Error("client_commercial_policy_repository_unavailable");
    }
  },
  async migrate(db) {
    await migrateDb(db, defaultMigrationsFolder);
  },
  async dependencies(config, db) {
    if (
      config.features.testExpertPromo === true &&
      config.features.testExpertDeterministicFlow === true &&
      options.testExpertMetricSink === undefined
    )
      throw new Error("test_expert_metric_sink_unavailable");
    if (config.features.clientTelegramIngress && !config.clientTelegramBotKey)
      throw new Error("client_telegram_bot_key_required");
    assertClientCapabilityPreflight(config.features, {
      identityProofVerifier:
        options.clientSessionComposition?.verifier !== undefined ||
        (config.clientTelegramBotToken !== undefined &&
          /^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u.test(
            config.clientTelegramBotToken,
          )),
      bookingRuntime: true,
    });
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
    const clientSessionRepository =
      config.features.clientSession === true
        ? new PostgresClientSessionRepository(db)
        : undefined;
    const clientSessionService =
      clientSessionRepository === undefined
        ? undefined
        : createClientSessionService({
            verifier: createClientProofVerifierGate(
              options.clientSessionComposition?.verifier ??
                createTelegramClientProofVerifier({
                  botToken: config.clientTelegramBotToken!,
                  resolveIdentity: (externalId) =>
                    clientSessionRepository.resolveTelegramIdentity(externalId),
                  widgetEnabled: config.clientWeb?.widgetEnabled === true,
                }),
            ),
            sessions: clientSessionRepository,
            generateToken: createClientSessionToken,
            digestToken: clientSessionTokenHash,
          });
    const clientPrincipal =
      clientSessionRepository === undefined
        ? undefined
        : createClientPrincipalResolver(clientSessionRepository, {
            record: recordClientSessionMetric,
          });
    const clientBookingPrincipal =
      clientSessionRepository === undefined
        ? undefined
        : createClientBookingPrincipalResolver(clientSessionRepository);
    const clientCatalogService =
      config.features.clientCatalog === true &&
      clientSessionService !== undefined &&
      clientPrincipal !== undefined
        ? createClientCatalogService({
            repository: new PostgresClientCatalogRepository(db),
            bookingAware: config.features.clientBooking === true,
          })
        : undefined;
    const clientBookingService =
      config.features.clientBooking === true
        ? createClientBookingService({
            repository: new PostgresBookingRepository(db),
            confirmationBufferMs:
              config.clientBookingConfirmationBufferMs ?? 3_600_000,
          })
        : undefined;
    const clientGateway =
      config.features.clientTelegramIngress && config.clientTelegramBotKey
        ? new HybridMessageGateway({
            enabled: true,
            botKey: config.clientTelegramBotKey,
            routingEnabled: config.features.clientHybridRouting === true,
            costAdmissionEnabled: config.features.selartiCostAdmission === true,
            budgetMetric: (outcome) => recordSelartiBudgetMetric({ outcome }),
            messagingConsentPolicyVersion:
              config.clientMessagingConsentPolicyVersion!,
            hasMessagingConsent: async (telegramUserId) => {
              if (config.features.clientPrivacy !== true) return false;
              const row = (
                await db.execute<{ granted: boolean }>(sql`
                  select exists (
                    select 1
                    from channel_identities ci
                    where ci.provider = 'telegram'
                      and ci.bot_key = ${config.clientTelegramBotKey}
                      and ci.external_id = ${telegramUserId}
                      and ci.status = 'active'
                      and ${currentConsentGrantedSql({
                        userExpression: sql`ci.user_id`,
                        purpose: "client_messaging",
                        policyVersion: sql`${config.clientMessagingConsentPolicyVersion!}`,
                      })}
                  ) as granted
                `)
              ).rows[0];
              return row?.granted === true;
            },
            ...(config.selartiAiConsentPolicyVersion === undefined
              ? {}
              : {
                  selartiConsentPolicyVersion:
                    config.selartiAiConsentPolicyVersion,
                }),
            persist: async (input) =>
              new PostgresHybridMessageRepository(db).persist(input),
          })
        : undefined;
    const selartiResponses =
      config.features.selartiResponseIngress === true &&
      config.clientTelegramBotKey !== undefined
        ? createSelartiResponseService({
            enabled: true,
            tenantKey: config.clientTelegramBotKey,
            allowedUrlHosts: ["ii-tonya.ru"],
            clock: () => new Date(),
            proposals: new PostgresSelartiProposalRepository(db),
          })
        : undefined;
    const testExpertRepository = new PostgresTestExpertTelegramRepository(db, {
      messagingConsentPolicyVersion:
        config.clientMessagingConsentPolicyVersion ?? "unconfigured",
      ...(config.selartiAiConsentPolicyVersion === undefined
        ? {}
        : {
            selartiConsentPolicyVersion: config.selartiAiConsentPolicyVersion,
          }),
    });
    const testExpertResidualEnabled =
      config.features.testExpertSelarti === true &&
      config.features.clientHybridRouting === true &&
      config.features.selartiCostAdmission === true &&
      config.features.selartiResponseIngress === true &&
      config.features.b2TelegramDispatch === true &&
      config.features.b2SensitiveRetention === true &&
      config.features.testExpertReconciliation === true &&
      config.features.workerOutboxDelivery === true;
    const testExpertPromo =
      config.features.testExpertPromo === true &&
      config.features.testExpertDeterministicFlow === true
        ? Object.assign(
            new TestExpertTelegramService({
              telegram: testExpertRepository,
              expertPolicy: new PostgresExpertTrialPricingPolicy(db),
              partnerPolicy: new PostgresPartnerTrialPricingPolicy(db),
              residualEnabled: testExpertResidualEnabled,
              metrics: options.testExpertMetricSink!,
            }),
            {
              residualEnabled: testExpertResidualEnabled,
            },
          )
        : undefined;
    return {
      config,
      ...(expertCodeKeyring === undefined ? {} : { expertCodeKeyring }),
      conversationService: disabledService<ConversationService>(
        "conversation ingress",
      ),
      bookingService: disabledService<BookingService>("booking ingress"),
      catalogService: disabledService<CatalogService>("catalog ingress"),
      publicCatalog: {
        listPublicServices: (input) =>
          db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
            await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
            return new PostgresCatalogRepository(tx).listPublicServices(input);
          }),
      },
      privacyService:
        config.features.clientPrivacy === true
          ? createPrivacyService({
              repository: new PostgresPrivacyRepository(db, {
                privacyMutationCapability: { enabled: true },
              }),
              // Репозиторий дописывает аудит внутри своей сериализуемой транзакции;
              // этот порт остался в сигнатуре ради совместимости композиции.
              audit: { append: () => undefined },
              // Псевдоним нужен только уничтожению, а эта сборка его не выставляет.
              pseudonymize: () => {
                throw new Error("privacy erasure is not exposed");
              },
              capability: { enabled: true },
            })
          : disabledService<PrivacyService>("privacy ingress"),
      consentEvidence:
        config.features.clientPrivacy === true
          ? new PostgresConsentEvidenceRepository(db, {
              consentMutationCapability: { enabled: true },
              requiredPolicyVersions: {
                ...(config.clientMessagingConsentPolicyVersion === undefined
                  ? {}
                  : {
                      client_messaging:
                        config.clientMessagingConsentPolicyVersion,
                    }),
                ...(config.selartiAiConsentPolicyVersion === undefined
                  ? {}
                  : {
                      selarti_ai_processing:
                        config.selartiAiConsentPolicyVersion,
                    }),
              },
            })
          : undefined,
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
      clientIngressEnabled: config.features.clientTelegramIngress,
      clientHybridRoutingEnabled: config.features.clientHybridRouting,
      ...(config.clientTelegramBotKey === undefined
        ? {}
        : { clientBotKey: config.clientTelegramBotKey }),
      ...(clientGateway === undefined ? {} : { clientGateway }),
      ...(testExpertPromo === undefined ? {} : { testExpertPromo }),
      telegramWebhookSecret:
        config.telegramWebhookSecret ?? randomBytes(32).toString("base64url"),
      ...(config.selartiResponseSharedSecret === undefined
        ? {}
        : { selartiResponseSharedSecret: config.selartiResponseSharedSecret }),
      ...(selartiResponses === undefined ? {} : { selartiResponses }),
      ...(clientCatalogService === undefined
        ? {}
        : {
            clientCatalogService,
          }),
      ...(clientSessionService === undefined ||
      clientSessionRepository === undefined ||
      clientPrincipal === undefined
        ? {}
        : {
            clientSessionService,
            clientSessionRepository,
            clientPrincipal,
          }),
      ...(clientBookingService === undefined ||
      clientBookingPrincipal === undefined
        ? {}
        : { clientBookingService, clientBookingPrincipal }),
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
  const config = loadEnv(process.env);
  if (typeof lifecycle.preflight !== "function") {
    throw new Error("server_preflight_capability_unavailable");
  }
  lifecycle.preflight(config);
  await lifecycle.migrate(db);
  return buildApp(await lifecycle.dependencies(config, db));
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
  // Неперехваченное исключение иначе уходит в stderr мимо санитизатора.
  const removeFatalLogging = installFatalProcessLogging({
    logger: createLogger(),
  });
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    removeFatalLogging();
    return (closing ??= closeServer(app, lifecycle, db));
  };
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
