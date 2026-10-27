import { PostgresYooKassaPaymentPurposeRepository } from "@ii-tonya/db";
import { createExpertManagerTelegramComposition } from "./expert-manager-telegram-composition.js";
import { createClientBotAccountComposition } from "./client-bot-account-composition.js";
import { assertClientAccountQueriesConfig } from "@ii-tonya/config";
import {
  createExpertResidencyLifecycleComposition,
  assertExpertResidencyLifecycleCheckout,
  type ExpertResidencyLifecycleCompositionOptions,
} from "./expert-residency-lifecycle-composition.js";
import { assertExpertResidencyLifecycleConfig } from "@ii-tonya/config";
import {
  createExpertCardComposition,
  assertExpertCardCheckout,
  type ExpertCardCompositionOptions,
} from "./expert-card-composition.js";
import { assertExpertCardConfig } from "@ii-tonya/config";
import type { YooKassaWebhookDependencies } from "./routes/yookassa-webhook.js";
import {
  createExpertVerificationComposition,
  assertExpertVerificationPayments,
  type ExpertVerificationPaymentCapabilities,
} from "./expert-verification-composition.js";
import { createExpertApplicantComposition } from "./expert-applicant-composition.js";
import { assertExpertApplicantConfig } from "@ii-tonya/config";
import { createTelegramDeletionCapability } from "./telegram-deletion-composition.js";
import { randomBytes } from "node:crypto";
import { createExpertSessionService } from "@ii-tonya/application";
import { PostgresExpertSessionRepository } from "@ii-tonya/db";
import { createTelegramExpertProofVerifier } from "./telegram-expert-proof.js";
import {
  createExpertSessionToken,
  expertSessionTokenHash,
} from "./expert-session-token.js";
import { createExpertBearerPrincipalResolver } from "./expert-principal-resolver.js";
import { createExpertCampaignComposition } from "./expert-campaign-composition.js";
import { createPayerReceiptComposition } from "./payer-receipt-composition.js";
import { pathToFileURL } from "node:url";
import {
  createPrivacyService,
  createErasureRequestService,
  createAdminService,
  createClientCatalogService,
  createClientBookingService,
  createBookingService,
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
  ClientNavigationGateway,
  createSelartiResponseService,
  TestExpertTelegramService,
} from "@ii-tonya/application";
import {
  loadEnv,
  assertClientNavigationConfig,
  clientTelegramBotId,
} from "@ii-tonya/config";
import {
  checkDbReadiness,
  closeDb,
  createDb,
  defaultMigrationsFolder,
  migrateDb,
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  PostgresPrivacyRepository,
  PostgresErasureRequestRepository,
  PostgresConsentEvidenceRepository,
  currentConsentGrantedSql,
  sql,
  PostgresExpertReferralAdminRepository,
  PostgresExpertReferralControlRepository,
  PostgresExpertAiRequestReceiptStore,
  PostgresOperatorCaseRepository,
  PostgresClientCatalogRepository,
  PostgresClientAccountPackagesRepository,
  PostgresCatalogRepository,
  PostgresBookingRepository,
  PostgresBookingNotificationCallbackRepository,
  PostgresClientSessionRepository,
  PostgresWebhookInboxRepository,
  PostgresHybridMessageRepository,
  PostgresClientIngressReplayRepository,
  PostgresSelartiProposalRepository,
  PostgresTestExpertTelegramRepository,
  PostgresExpertTrialPricingPolicy,
  PostgresPartnerTrialPricingPolicy,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createExpertTelegramIngress,
  DisabledSelartiAdapter,
  createBookingCallbackVault,
  issueCallback,
  EnvironmentExpertCodeSecretResolver,
  type ExpertTelegramIngressFactoryDependencies,
} from "@ii-tonya/integrations";
import {
  createLogger,
  classifyFailure,
  installFatalProcessLogging,
  recordClientSessionMetric,
  recordSelartiBudgetMetric,
  shutdownTelemetry,
} from "@ii-tonya/observability";
import { buildApp, type AppDependencies } from "./app.js";
import { createBookingCallbackService } from "./booking-callback-service.js";
import { createBookingCallbackAck } from "./booking-callback-ack.js";
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
    expertResidencyLifecycle?: ExpertResidencyLifecycleCompositionOptions;
    expertCard?: ExpertCardCompositionOptions;
    expertManagerTelegram?: Omit<
      Parameters<typeof createExpertManagerTelegramComposition>[1],
      "verification"
    >;
    expertVerificationPayments?: ExpertVerificationPaymentCapabilities;
    yookassaWebhook?: Omit<YooKassaWebhookDependencies, "onboarding">;
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
    assertClientAccountQueriesConfig(config);
    assertExpertResidencyLifecycleConfig(config);
    assertExpertResidencyLifecycleCheckout(
      config,
      options.expertResidencyLifecycle,
    );
    if (
      config.expertResidencyLifecycle?.renewalCheckoutEnabled &&
      (!config.features.yookassa || !options.yookassaWebhook)
    )
      throw new Error("expert_residency_lifecycle_merchant_callback_required");
    assertExpertCardConfig(config);
    assertExpertCardCheckout(config, options.expertCard);
    if (
      config.features.expertCard === true &&
      config.expertCard?.mainCheckoutEnabled &&
      (!config.features.yookassa || !options.yookassaWebhook)
    )
      throw new Error("expert_card_merchant_callback_required");
    assertExpertVerificationPayments(
      config,
      options.expertVerificationPayments,
    );
    if (
      config.expertVerification?.paymentVerificationEnabled &&
      (!config.features.yookassa || !options.yookassaWebhook)
    )
      throw new Error("expert_verification_merchant_callback_required");
    assertExpertApplicantConfig(config);
    if (
      (config.features.expertResidencyBilling ||
        config.features.expertReferral) &&
      (!config.features.expertSession || !config.expertSession)
    )
      throw new Error("expert_session_capability_unavailable");
    assertClientNavigationConfig(config);
    if (
      config.features.clientTelegramIngress === true &&
      clientTelegramBotId(config.clientTelegramBotToken) === undefined
    )
      throw new Error("client_ingress_bot_identity_required");
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
      (config.features.expertResidencyBilling ||
        config.features.expertReferral) &&
      (!config.features.expertSession || !config.expertSession)
    )
      throw new Error("expert_session_capability_unavailable");
    assertClientNavigationConfig(config);
    const notificationOrigin =
      config.bookingNotifications?.admissionEnabled === true
        ? {
            botKey: config.clientTelegramBotKey,
            messagingPolicyVersion: config.clientMessagingConsentPolicyVersion,
          }
        : undefined;
    if (
      notificationOrigin &&
      (!notificationOrigin.botKey || !notificationOrigin.messagingPolicyVersion)
    )
      throw new Error("booking_notification_capture_configuration_required");
    const inbox = new PostgresWebhookInboxRepository(db);
    let bookingCallbacks: AppDependencies["bookingCallbacks"];
    if (config.features.bookingCallbacks === true) {
      const material = config.bookingCallbacks;
      if (
        !material ||
        !config.clientTelegramBotKey ||
        !config.clientTelegramBotToken ||
        !config.telegramWebhookSecret
      ) {
        throw new Error("booking_callback_configuration_required");
      }
      const hmacKey = Uint8Array.from(material.hmacKey);
      const vault = createBookingCallbackVault(material);
      const repository = new PostgresBookingNotificationCallbackRepository(
        db,
        config.clientTelegramBotKey,
        {
          ...vault,
          async issue(claims) {
            let tokenHash = "";
            const token = await issueCallback(claims, hmacKey, {
              async put(hash) {
                tokenHash = hash;
              },
              async peek() {
                return null;
              },
              async consumeIfValid() {
                return null;
              },
            });
            return { token, tokenHash };
          },
        },
      );
      bookingCallbacks = createBookingCallbackService({
        botKey: config.clientTelegramBotKey,
        secret: hmacKey,
        repository,
        inbox,
        bookings: createBookingService({
          repository: new PostgresBookingRepository(db),
          clock: { now: () => new Date() },
        }),
        acknowledge: createBookingCallbackAck(config.clientTelegramBotToken),
      });
    }
    const clientBotId = clientTelegramBotId(config.clientTelegramBotToken);
    if (
      config.features.clientTelegramIngress === true &&
      clientBotId === undefined
    )
      throw new Error("client_ingress_bot_identity_required");
    const clientIngressReplay = new PostgresClientIngressReplayRepository(db);
    const clientNavigationGateway =
      config.features.clientTelegramNavigation === true
        ? new ClientNavigationGateway({
            botId: clientBotId!,
            origin: config.clientNavigation!.origin,
            replay: clientIngressReplay,
          })
        : undefined;
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
    if (
      config.features.expertSession === true &&
      (!config.expertSession ||
        typeof db.execute !== "function" ||
        typeof db.transaction !== "function")
    )
      throw new Error("expert_session_capability_unavailable");
    const expertSessionRepository =
      config.features.expertSession === true
        ? new PostgresExpertSessionRepository(db, config.expertSession!.botKey)
        : undefined;
    const expertSessions = expertSessionRepository
      ? {
          ...createExpertSessionService({
            sessions: expertSessionRepository,
            generateToken: createExpertSessionToken,
            digestToken: expertSessionTokenHash,
            verifier: createTelegramExpertProofVerifier({
              botToken: config.expertSession!.botToken,
              resolveIdentity: (id) =>
                expertSessionRepository.resolveTelegramIdentity(id),
              widgetEnabled: config.expertSession!.widgetEnabled,
            }),
          }),
          revoke: (hash: string) => expertSessionRepository.revoke(hash),
        }
      : undefined;
    const expertApi =
      (config.features.expertResidencyBilling ||
        config.features.expertReferral) &&
      expertSessionRepository
        ? createExpertCampaignComposition({
            payerReceipt: createPayerReceiptComposition(db, config),
            db,
            botKey: config.expertSession!.botKey,
            principals: createExpertBearerPrincipalResolver({
              sessions: expertSessionRepository,
            }),
            codeCrypto,
            referralEnabled: config.features.expertReferral,
            billingEnabled: config.features.expertResidencyBilling,
          })
        : undefined;
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
            bookingGrantsEnabled:
              config.features.clientSessionBookingGrants === true,
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
            repository: new PostgresBookingRepository(
              db,
              notificationOrigin
                ? {
                    notificationOrigin: {
                      botKey: notificationOrigin.botKey!,
                      messagingPolicyVersion:
                        notificationOrigin.messagingPolicyVersion!,
                    },
                  }
                : {},
            ),
            confirmationBufferMs:
              config.clientBookingConfirmationBufferMs ?? 3_600_000,
          })
        : undefined;
    const clientGateway =
      config.features.clientTelegramIngress && config.clientTelegramBotKey
        ? new HybridMessageGateway({
            enabled: true,
            botKey: config.clientTelegramBotKey,
            ...(clientBotId === undefined
              ? {}
              : { botId: clientBotId, ingressReplay: clientIngressReplay }),
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
              new PostgresHybridMessageRepository(db, {}, clientBotId).persist(
                input,
              ),
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
    const clientAccountQueries = createClientBotAccountComposition(db, config);
    const expertVerification = createExpertVerificationComposition(
      db,
      config,
      options.expertVerificationPayments,
    );
    if (
      options.expertManagerTelegram?.enabled &&
      (!expertVerification || config.features.expertVerification !== true)
    )
      throw new Error("manager_telegram_verification_required");
    const expertManagerTelegram =
      options.expertManagerTelegram && expertVerification
        ? createExpertManagerTelegramComposition(db, {
            ...options.expertManagerTelegram,
            verification: expertVerification,
          })
        : undefined;
    const expertResidencyLifecycle = createExpertResidencyLifecycleComposition(
      db,
      config,
      options.expertResidencyLifecycle,
    );
    const expertCard = createExpertCardComposition(
      db,
      config,
      options.expertCard,
    );
    await expertCard?.initializeTags?.();
    let expertAiIngress = options.expertAiComposition?.ingress;
    if (config.features.expertAiIngress === true && expertCard) {
      if (
        !expertCard.personalOfferReads ||
        !expertAiIngress?.withPersonalOffers
      )
        throw new Error("expert_ai_personal_offer_capability_required");
      expertAiIngress = expertAiIngress.withPersonalOffers(
        expertCard.personalOfferReads,
      );
    }
    const applicantReceipt = config.features.expertSeparatedSales
      ? createPayerReceiptComposition(db, config)
      : undefined;
    const originalExpertApplicantTelegram = createExpertApplicantComposition(
      db,
      config,
      {
        ...(applicantReceipt && config.payerReceipt
          ? {
              receipt: {
                vault: applicantReceipt.vault,
                retentionDays: config.payerReceipt.retentionDays,
              },
            }
          : {}),
        ...(expertVerification?.heldCheckout
          ? { checkout: expertVerification.heldCheckout }
          : {}),
      },
    );
    const expertApplicantTelegram =
      originalExpertApplicantTelegram && expertCard
        ? {
            ...originalExpertApplicantTelegram,
            service: {
              async handle(
                input: Parameters<
                  typeof originalExpertApplicantTelegram.service.handle
                >[0],
              ) {
                const result =
                  await expertCard.service.handlePromoHandoff(input);
                return result.status === "unhandled"
                  ? originalExpertApplicantTelegram.service.handle(input)
                  : result;
              },
            },
          }
        : originalExpertApplicantTelegram;
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
      ...(expertManagerTelegram ? { expertManagerTelegram } : {}),
      ...(clientAccountQueries ? { clientAccountQueries } : {}),
      ...(expertResidencyLifecycle ? { expertResidencyLifecycle } : {}),
      ...(expertCard ? { expertCard } : {}),
      ...(expertApplicantTelegram ? { expertApplicantTelegram } : {}),
      ...(expertVerification ? { expertVerification } : {}),
      ...(options.yookassaWebhook
        ? {
            yookassaWebhook: {
              ...options.yookassaWebhook,
              resolvePurpose: (providerObjectId, event) =>
                new PostgresYooKassaPaymentPurposeRepository(db).resolvePurpose(
                  providerObjectId,
                  event,
                ),
              ...(expertVerification?.onboardingWebhook
                ? { onboarding: expertVerification.onboardingWebhook }
                : {}),
            },
          }
        : {}),
      ...(expertApi ? { expertApi } : {}),
      ...(bookingCallbacks === undefined ? {} : { bookingCallbacks }),
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
      // Reads stay composed when request creation is closed. Physical execution
      // remains gated separately on real capture, custody and backup evidence.
      ...(config.features.clientPrivacy === true &&
      config.features.clientErasureRequests === true
        ? {
            telegramDeletion: createTelegramDeletionCapability({
              enabled: true,
              botKey: config.clientTelegramBotKey,
              botId: clientBotId,
              receiptKey: config.telegramWebhookSecret,
              repository: new PostgresErasureRequestRepository(db),
              service: createErasureRequestService({
                repository: new PostgresErasureRequestRepository(db),
                requestEnabled: true,
              }),
            }),
          }
        : {}),
      erasureRequests: createErasureRequestService({
        repository: new PostgresErasureRequestRepository(db),
        requestEnabled:
          config.features.clientPrivacy === true &&
          config.features.clientErasureRequests === true,
      }),
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
        queries: new PostgresAdminRepository(db),
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
      inbox,
      rateLimiter: createWindowedRateLimiter(),
      clientIngressEnabled: config.features.clientTelegramIngress,
      clientIngressReplay,
      ...(clientBotId === undefined ? {} : { clientBotId }),
      ...(clientNavigationGateway === undefined
        ? {}
        : { clientNavigationGateway }),
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
      ...(expertSessions && expertSessionRepository
        ? {
            expertSession: {
              sessions: expertSessions,
              lookup: expertSessionRepository,
              principals: createExpertBearerPrincipalResolver({
                sessions: expertSessionRepository,
              }),
              ...config.expertSession,
            },
          }
        : {}),
      ...(clientSessionService === undefined ||
      clientSessionRepository === undefined ||
      clientPrincipal === undefined
        ? {}
        : {
            clientSessionService,
            clientAccountPackages: new PostgresClientAccountPackagesRepository(
              db,
            ),
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
            expertAiIngress: expertAiIngress!,
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
    createLogger().fatal({
      event: "startup_failure",
      module: "api",
      failureClass: classifyFailure(error),
    });
    process.exitCode = 1;
  });
}
