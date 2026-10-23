import type { ExpertCardLegacyReplayRead } from "./expert-card-telegram-ingress.js";
import {
  createExpertCardService,
  createExpertCardAdminService,
  type ExpertCardService,
  type ExpertCardAdminService,
  type ExpertCardMainCheckout,
} from "@ii-tonya/application";
import { assertExpertCardConfig, type RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresExpertCardRepository,
  PostgresExpertOnboardingMainPaymentRepository,
  type DrizzleDb,
  sql,
} from "@ii-tonya/db";
export interface ExpertCardCapability {
  legacyReplay: ExpertCardLegacyReplayRead;
  mainCheckoutEnabled: boolean;
  mainCheckout?: ExpertCardMainCheckout;
  workBotId: string;
  workBotKey: string;
  workBotUsername: string;
  webhookSecret: string;
  paymentMode: "test" | "live";
  service: ExpertCardService;
  admin: ExpertCardAdminService;
}
export type ExpertCardCompositionOptions = {
  mainCheckout?: ExpertCardMainCheckout;
  materialTransport?: ConstructorParameters<
    typeof PostgresExpertCardRepository
  >[1]["materialTransport"];
};
export function assertExpertCardCapability(
  config: RuntimeConfig,
  capability: ExpertCardCapability | undefined,
): void {
  assertExpertCardConfig(config);
  if (config.features.expertCard !== true) return;
  const settings = config.expertCard!;
  if (
    !capability ||
    capability.mainCheckoutEnabled !== settings.mainCheckoutEnabled ||
    typeof capability.legacyReplay?.read !== "function" ||
    (settings.mainCheckoutEnabled &&
      (capability.mainCheckout?.strictFirstSendCancellation !== true ||
        typeof capability.mainCheckout.createOrRecover !== "function")) ||
    capability.workBotId !== settings.workBotId ||
    capability.workBotKey !== settings.workBotKey ||
    capability.workBotUsername !== settings.workBotUsername ||
    capability.webhookSecret !== settings.webhookSecret ||
    capability.paymentMode !== settings.paymentMode ||
    typeof capability.service?.handleWork !== "function" ||
    typeof capability.service.handlePromoHandoff !== "function" ||
    typeof capability.admin?.list !== "function" ||
    typeof capability.admin.detail !== "function" ||
    typeof capability.admin.edit !== "function" ||
    typeof capability.admin.review !== "function" ||
    typeof capability.admin.confirmPromo !== "function"
  )
    throw new Error("expert_card_capability_required");
}
export function createExpertCardComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  options: ExpertCardCompositionOptions = {},
): ExpertCardCapability | undefined {
  assertExpertCardConfig(config);
  if (config.features.expertCard !== true) return undefined;
  const settings = config.expertCard!;
  assertExpertCardCheckout(config, options);
  const repository = new PostgresExpertCardRepository(db, {
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
    workBotId: settings.workBotId,
    workBotKey: settings.workBotKey,
    ...(options.materialTransport
      ? { materialTransport: options.materialTransport }
      : {}),
  });
  const financial = new PostgresExpertOnboardingMainPaymentRepository(db, {
    messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
    providerMode: settings.paymentMode,
  });
  return {
    workBotId: settings.workBotId,
    workBotKey: settings.workBotKey,
    workBotUsername: settings.workBotUsername,
    webhookSecret: settings.webhookSecret,
    paymentMode: settings.paymentMode,
    mainCheckoutEnabled: settings.mainCheckoutEnabled,
    ...(settings.mainCheckoutEnabled && options.mainCheckout
      ? { mainCheckout: options.mainCheckout }
      : {}),
    legacyReplay: createExpertCardLegacyReplayRead(db, settings.workBotId),
    service: createExpertCardService({
      enabled: true,
      paymentMode: settings.paymentMode,
      ...(settings.mainCheckoutEnabled && options.mainCheckout
        ? { mainCheckout: options.mainCheckout }
        : {}),
      workBotId: settings.workBotId,
      workBotKey: settings.workBotKey,
      workBotUsername: settings.workBotUsername,
      ...(config.expertApplicant
        ? {
            promoScope: {
              botId: config.expertApplicant.botId,
              botKey: config.expertApplicant.botKey,
            },
          }
        : {}),
      repository,
      financial,
    }),
    admin: createExpertCardAdminService({ enabled: true, repository }),
  };
}

export function assertExpertCardCheckout(
  config: RuntimeConfig,
  options: ExpertCardCompositionOptions = {},
): void {
  assertExpertCardConfig(config);
  if (
    config.features.expertCard !== true ||
    !config.expertCard?.mainCheckoutEnabled
  )
    return;
  if (
    options.mainCheckout?.strictFirstSendCancellation !== true ||
    typeof options.mainCheckout.createOrRecover !== "function"
  )
    throw new Error("expert_card_checkout_capability_required");
}

export function createExpertCardLegacyReplayRead(
  db: DrizzleDb,
  workBotId: string,
): ExpertCardLegacyReplayRead {
  return {
    async read(input) {
      if (
        input.botId !== workBotId ||
        !/^(0|[1-9][0-9]{0,15})$/u.test(input.updateId) ||
        !Number.isSafeInteger(Number(input.updateId))
      )
        throw new Error("expert_card_legacy_replay_invalid");
      const row = (
        await db.execute<{ status: string }>(
          sql`select status from webhook_inbox where provider='telegram' and external_event_id=${input.updateId} limit 1`,
        )
      ).rows[0];
      return !row
        ? "absent"
        : row.status === "complete"
          ? "complete"
          : "pending";
    },
  };
}
