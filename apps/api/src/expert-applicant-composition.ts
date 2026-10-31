import { createEarlyBirdReadOnlyStatus } from "./expert-early-bird-readonly-status.js";
import { isInitializedEarlyBirdGatewayService } from "./expert-early-bird-runtime-composition.js";
import type { PayerReceiptVault } from "@ii-tonya/integrations";
import {
  createResidentVerificationService,
  createExpertSeparatedSalesService,
  createExpertApplicantService,
} from "@ii-tonya/application";
import {
  assertExpertApplicantConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  PostgresEarlyBirdPaidStatus,
  PostgresExpertPromoRepository,
  PostgresExpertSeparatedSalesRepository,
  PostgresResidentVerificationRepository,
  PostgresResidentPrivateJobsRepository,
  PostgresExpertPersonalOfferRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { ExpertApplicantTelegramCapability } from "./routes/expert-applicant-telegram.js";
export function assertExpertApplicantCapability(
  config: RuntimeConfig,
  capability: ExpertApplicantTelegramCapability | undefined,
  nowMs: number = Date.now(),
): void {
  assertExpertApplicantConfig(config);
  // Only a concrete gateway-backed authority that completed authenticated startup
  // readiness permits wave routing; an arbitrary feature boolean is insufficient.
  if (
    config.launchPhase?.configuredPhase === "WAVE_1_EARLY_BIRD" &&
    (!Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(config.launchPhase.clientStartMs) ||
      nowMs < config.launchPhase.clientStartMs) &&
    !(
      capability?.earlyBirdEnabled === true &&
      isInitializedEarlyBirdGatewayService(capability.earlyBirdAuthority)
    )
  )
    throw new Error("early_bird_capability_required");
  if (
    capability &&
    (capability.separatedSalesEnabled === true) !==
      (config.features.expertSeparatedSales === true)
  )
    throw new Error("expert_applicant_capability_required");
  if (
    capability?.verificationFormEnabled === true &&
    config.features.expertVerificationForm !== true
  )
    throw new Error("expert_applicant_capability_required");
  if (config.features.expertApplicant !== true) return;
  const scope = config.expertApplicant!;
  if (
    !capability ||
    (config.features.expertVerificationForm === true) !==
      (capability.verificationFormEnabled === true) ||
    capability.botId !== scope.botId ||
    capability.botKey !== scope.botKey ||
    capability.webhookSecret !== scope.webhookSecret ||
    typeof capability.service?.handle !== "function"
  )
    throw new Error("expert_applicant_capability_required");
}
export function createExpertApplicantComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  capabilities?: {
    receipt?: { vault: PayerReceiptVault; retentionDays: number };
    checkout?: Parameters<
      typeof createExpertSeparatedSalesService
    >[0]["checkout"];
    wave?: Parameters<typeof createExpertSeparatedSalesService>[0]["wave"];
  },
): ExpertApplicantTelegramCapability | undefined {
  assertExpertApplicantConfig(config);
  if (config.features.expertApplicant !== true) return undefined;
  const scope = config.expertApplicant!;
  const sales = new PostgresExpertSeparatedSalesRepository(db, scope);
  const privateDocuments = config.features.residentPrivateJobs
    ? new PostgresResidentPrivateJobsRepository(db, scope)
    : undefined;
  return {
    separatedSalesEnabled: config.features.expertSeparatedSales === true,
    earlyBirdEnabled:
      config.features.expertSeparatedSales === true &&
      capabilities?.wave !== undefined,
    ...(isInitializedEarlyBirdGatewayService(capabilities?.wave)
      ? { earlyBirdAuthority: capabilities!.wave }
      : {}),
    verificationFormEnabled: config.features.expertVerificationForm === true,
    botId: scope.botId,
    botKey: scope.botKey,
    webhookSecret: scope.webhookSecret,
    service: createExpertApplicantService({
      enabled: true,
      ...(config.features.expertSeparatedSales === true
        ? {
            separatedSales: createExpertSeparatedSalesService({
              repository: sales,
              paidStatus: createEarlyBirdReadOnlyStatus(
                new PostgresEarlyBirdPaidStatus(db, scope),
              ),
              ...(capabilities?.wave
                ? {
                    wave: capabilities.wave,
                    waveForm: createResidentVerificationService({
                      ...(privateDocuments ? { privateDocuments } : {}),
                      enabled: true,
                      salesFirst: true,
                      wavePaymentFlow: true,
                      repository: new PostgresResidentVerificationRepository(
                        db,
                        { ...scope, earlyBirdForm: true },
                      ),
                    }),
                  }
                : {}),
              ...(capabilities?.receipt
                ? {
                    captureReceipt: (input) =>
                      sales.captureReceipt(
                        input,
                        capabilities.receipt!.vault,
                        capabilities.receipt!.retentionDays,
                      ),
                  }
                : {}),
              ...(capabilities?.checkout
                ? { checkout: capabilities.checkout }
                : {}),
              form: createResidentVerificationService({
                ...(privateDocuments ? { privateDocuments } : {}),
                enabled: true,
                salesFirst: true,
                repository: new PostgresResidentVerificationRepository(
                  db,
                  scope,
                ),
              }),
            }),
          }
        : {}),
      ...(config.features.expertVerificationForm === true
        ? {
            verificationForm: createResidentVerificationService({
              ...(privateDocuments ? { privateDocuments } : {}),
              enabled: true,
              repository: new PostgresResidentVerificationRepository(db, {
                botId: scope.botId,
                botKey: scope.botKey,
                messagingConsentPolicyVersion:
                  scope.messagingConsentPolicyVersion,
              }),
            }),
          }
        : {}),
      personalOffers: new PostgresExpertPersonalOfferRepository(db, {
        workBotId: config.expertCard?.workBotId ?? "unconfigured",
        workBotKey: config.expertCard?.workBotKey ?? "unconfigured",
        promoBotId: scope.botId,
        promoBotKey: scope.botKey,
        promoConsentPolicyVersion: scope.messagingConsentPolicyVersion,
        messagingConsentPolicyVersion: scope.messagingConsentPolicyVersion,
      }),
      repository: new PostgresExpertPromoRepository(db, {
        separatedSalesEnabled: config.features.expertSeparatedSales === true,
        messagingConsentPolicyVersion: scope.messagingConsentPolicyVersion,
        verificationFormEnabled:
          config.features.expertVerificationForm === true,
      }),
    }),
  };
}
