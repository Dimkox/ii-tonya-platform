import {
  assertExpertCardConfig,
  type ExpertCardConfig,
} from "./expert-card-config.js";
export interface ExpertResidencyLifecycleConfig {
  enabled: boolean;
  commandsEnabled: boolean;
  noticeDeliveryEnabled: boolean;
  renewalCheckoutEnabled: boolean;
}
type Config = {
  features: {
    expertResidencyLifecycle?: boolean;
    expertResidencyLifecycleCommands?: boolean;
    expertResidencyNoticeDelivery?: boolean;
    expertCard?: boolean;
    expertCardMaterialDelivery?: boolean;
  };
  expertResidencyLifecycle?: ExpertResidencyLifecycleConfig;
  expertCard?: ExpertCardConfig;
  yookassa?: { mode: "test" | "live" };
};
export function assertExpertResidencyLifecycleConfig(config: Config): void {
  const s = config.expertResidencyLifecycle,
    f = config.features;
  if (
    ![
      f.expertResidencyLifecycle,
      f.expertResidencyLifecycleCommands,
      f.expertResidencyNoticeDelivery,
      s?.enabled,
      s?.commandsEnabled,
      s?.noticeDeliveryEnabled,
      s?.renewalCheckoutEnabled,
    ].some((v) => v === true)
  )
    return;
  if (
    !s ||
    [
      s.enabled,
      s.commandsEnabled,
      s.noticeDeliveryEnabled,
      s.renewalCheckoutEnabled,
    ].some((v) => typeof v !== "boolean") ||
    s.enabled !== (f.expertResidencyLifecycle === true) ||
    s.commandsEnabled !== (f.expertResidencyLifecycleCommands === true) ||
    s.noticeDeliveryEnabled !== (f.expertResidencyNoticeDelivery === true) ||
    (s.renewalCheckoutEnabled && !s.commandsEnabled)
  )
    throw new Error("expert_residency_lifecycle_configuration_required");
  assertExpertCardConfig(config);
}
export function readExpertResidencyLifecycleConfig(
  source: NodeJS.ProcessEnv,
): ExpertResidencyLifecycleConfig | undefined {
  const keys = [
    "EXPERT_RESIDENCY_LIFECYCLE_ENABLED",
    "EXPERT_RESIDENCY_LIFECYCLE_COMMANDS_ENABLED",
    "EXPERT_RESIDENCY_NOTICE_DELIVERY_ENABLED",
    "EXPERT_RESIDENCY_RENEWAL_CHECKOUT_ENABLED",
  ] as const;
  const flags = keys.map((key) => source[key] || "false");
  if (flags.some((v) => v !== "true" && v !== "false"))
    throw new Error("expert_residency_lifecycle_configuration_invalid");
  if (!flags.some((v) => v === "true")) return undefined;
  const [
    enabled,
    commandsEnabled,
    noticeDeliveryEnabled,
    renewalCheckoutEnabled,
  ] = flags.map((v) => v === "true");
  if (renewalCheckoutEnabled && !commandsEnabled)
    throw new Error("expert_residency_lifecycle_configuration_required");
  return {
    enabled: enabled!,
    commandsEnabled: commandsEnabled!,
    noticeDeliveryEnabled: noticeDeliveryEnabled!,
    renewalCheckoutEnabled: renewalCheckoutEnabled!,
  };
}
