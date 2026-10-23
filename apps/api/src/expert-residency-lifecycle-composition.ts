import {
  createExpertResidencyLifecycleService,
  type ExpertResidencyLifecycleService,
  type ExpertCardMainCheckout,
} from "@ii-tonya/application";
import {
  assertExpertResidencyLifecycleConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  PostgresExpertResidencyLifecycleRepository,
  PostgresExpertOnboardingMainPaymentRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createExpertCardLegacyReplayRead } from "./expert-card-composition.js";
import type { ExpertCardLegacyReplayRead } from "./expert-card-telegram-ingress.js";
export interface ExpertResidencyLifecycleCapability {
  workBotId: string;
  workBotKey: string;
  webhookSecret: string;
  paymentMode: "test" | "live";
  renewalCheckoutEnabled: boolean;
  mainCheckout?: ExpertCardMainCheckout;
  legacyReplay: ExpertCardLegacyReplayRead;
  service: ExpertResidencyLifecycleService;
}
export interface ExpertResidencyLifecycleCompositionOptions {
  mainCheckout?: ExpertCardMainCheckout;
}
export function assertExpertResidencyLifecycleCheckout(
  config: RuntimeConfig,
  options: ExpertResidencyLifecycleCompositionOptions = {},
): void {
  assertExpertResidencyLifecycleConfig(config);
  if (!config.expertResidencyLifecycle?.renewalCheckoutEnabled) return;
  if (
    options.mainCheckout?.strictFirstSendCancellation !== true ||
    typeof options.mainCheckout.createOrRecover !== "function"
  )
    throw new Error("expert_residency_lifecycle_checkout_capability_required");
}
export function assertExpertResidencyLifecycleCapability(
  config: RuntimeConfig,
  cap: ExpertResidencyLifecycleCapability | undefined,
): void {
  assertExpertResidencyLifecycleConfig(config);
  if (config.features.expertResidencyLifecycleCommands !== true) return;
  const work = config.expertCard!,
    s = config.expertResidencyLifecycle!;
  if (
    !cap ||
    cap.workBotId !== work.workBotId ||
    cap.workBotKey !== work.workBotKey ||
    cap.webhookSecret !== work.webhookSecret ||
    cap.paymentMode !== work.paymentMode ||
    cap.renewalCheckoutEnabled !== s.renewalCheckoutEnabled ||
    typeof cap.service?.handleWork !== "function" ||
    typeof cap.legacyReplay?.read !== "function" ||
    (s.renewalCheckoutEnabled &&
      (cap.mainCheckout?.strictFirstSendCancellation !== true ||
        typeof cap.mainCheckout.createOrRecover !== "function"))
  )
    throw new Error("expert_residency_lifecycle_capability_required");
}
export function createExpertResidencyLifecycleComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  options: ExpertResidencyLifecycleCompositionOptions = {},
): ExpertResidencyLifecycleCapability | undefined {
  assertExpertResidencyLifecycleConfig(config);
  if (config.features.expertResidencyLifecycleCommands !== true)
    return undefined;
  assertExpertResidencyLifecycleCheckout(config, options);
  const work = config.expertCard!,
    s = config.expertResidencyLifecycle!;
  const repository = new PostgresExpertResidencyLifecycleRepository(db, {
    workBotId: work.workBotId,
    workBotKey: work.workBotKey,
    messagingConsentPolicyVersion: work.messagingConsentPolicyVersion,
  });
  const financial = new PostgresExpertOnboardingMainPaymentRepository(db, {
    providerMode: work.paymentMode,
    messagingConsentPolicyVersion: work.messagingConsentPolicyVersion,
  });
  return {
    workBotId: work.workBotId,
    workBotKey: work.workBotKey,
    webhookSecret: work.webhookSecret,
    paymentMode: work.paymentMode,
    renewalCheckoutEnabled: s.renewalCheckoutEnabled,
    ...(s.renewalCheckoutEnabled && options.mainCheckout
      ? { mainCheckout: options.mainCheckout }
      : {}),
    legacyReplay: createExpertCardLegacyReplayRead(db, work.workBotId),
    service: createExpertResidencyLifecycleService({
      enabled: true,
      workBotId: work.workBotId,
      workBotKey: work.workBotKey,
      paymentMode: work.paymentMode,
      repository,
      financial,
      ...(s.renewalCheckoutEnabled && options.mainCheckout
        ? { mainCheckout: options.mainCheckout }
        : {}),
    }),
  };
}
