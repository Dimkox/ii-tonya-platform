import {
  createResidentVerificationService,
  createExpertApplicantService,
} from "@ii-tonya/application";
import {
  assertExpertApplicantConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  PostgresExpertPromoRepository,
  PostgresResidentVerificationRepository,
  PostgresExpertPersonalOfferRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { ExpertApplicantTelegramCapability } from "./routes/expert-applicant-telegram.js";
export function assertExpertApplicantCapability(
  config: RuntimeConfig,
  capability: ExpertApplicantTelegramCapability | undefined,
): void {
  assertExpertApplicantConfig(config);
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
): ExpertApplicantTelegramCapability | undefined {
  assertExpertApplicantConfig(config);
  if (config.features.expertApplicant !== true) return undefined;
  const scope = config.expertApplicant!;
  return {
    verificationFormEnabled: config.features.expertVerificationForm === true,
    botId: scope.botId,
    botKey: scope.botKey,
    webhookSecret: scope.webhookSecret,
    service: createExpertApplicantService({
      enabled: true,
      ...(config.features.expertVerificationForm === true
        ? {
            verificationForm: createResidentVerificationService({
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
        messagingConsentPolicyVersion: scope.messagingConsentPolicyVersion,
        verificationFormEnabled:
          config.features.expertVerificationForm === true,
      }),
    }),
  };
}
