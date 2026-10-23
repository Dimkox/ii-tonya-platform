import { createExpertApplicantService } from "@ii-tonya/application";
import {
  assertExpertApplicantConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import { PostgresExpertPromoRepository, type DrizzleDb } from "@ii-tonya/db";
import type { ExpertApplicantTelegramCapability } from "./routes/expert-applicant-telegram.js";
export function assertExpertApplicantCapability(
  config: RuntimeConfig,
  capability: ExpertApplicantTelegramCapability | undefined,
): void {
  assertExpertApplicantConfig(config);
  if (config.features.expertApplicant !== true) return;
  const scope = config.expertApplicant!;
  if (
    !capability ||
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
    botId: scope.botId,
    botKey: scope.botKey,
    webhookSecret: scope.webhookSecret,
    service: createExpertApplicantService({
      enabled: true,
      repository: new PostgresExpertPromoRepository(db, {
        messagingConsentPolicyVersion: scope.messagingConsentPolicyVersion,
      }),
    }),
  };
}
