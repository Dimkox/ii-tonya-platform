import {
  assertExpertCardConfig,
  type ExpertCardConfig,
} from "./expert-card-config.js";
export interface ResidentLifecycleCompletionConfig {
  enabled: boolean;
  deliveryEnabled: boolean;
}
export function readResidentLifecycleCompletionConfig(
  source: NodeJS.ProcessEnv,
): ResidentLifecycleCompletionConfig | undefined {
  const enabled = source.RESIDENT_LIFECYCLE_COMPLETION_ENABLED || "false",
    delivery = source.RESIDENT_WORK_NOTICE_DELIVERY_ENABLED || "false";
  if (![enabled, delivery].every((v) => v === "true" || v === "false"))
    throw new Error("resident_lifecycle_configuration_invalid");
  if (enabled !== "true" && delivery !== "true") return undefined;
  if (source.EXPERT_CARD_ENABLED !== "true")
    throw new Error("resident_lifecycle_card_required");
  return { enabled: enabled === "true", deliveryEnabled: delivery === "true" };
}
export function assertResidentLifecycleCompletionConfig(config: {
  residentLifecycleCompletion?: ResidentLifecycleCompletionConfig;
  expertCard?: ExpertCardConfig;
  features: { expertCard?: boolean };
}): void {
  const c = config.residentLifecycleCompletion;
  if (!c) return;
  if (
    typeof c.enabled !== "boolean" ||
    typeof c.deliveryEnabled !== "boolean" ||
    config.features.expertCard !== true ||
    !config.expertCard
  )
    throw new Error("resident_lifecycle_configuration_invalid");
  assertExpertCardConfig(config);
  if (
    c.deliveryEnabled &&
    (!config.expertCard.workBotToken ||
      config.expertCard.workBotToken.split(":")[0] !==
        config.expertCard.workBotId)
  )
    throw new Error("resident_work_transport_required");
}
