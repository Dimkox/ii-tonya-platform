export interface ExpertCardConfig {
  paymentMode: "test" | "live";
  materialDeliveryEnabled: boolean;
  mainCheckoutEnabled: boolean;
  workBotToken?: string;
  workBotId: string;
  workBotKey: string;
  workBotUsername: string;
  messagingConsentPolicyVersion: string;
  webhookSecret: string;
}
type Config = {
  features: { expertCard?: boolean; expertCardMaterialDelivery?: boolean };
  expertCard?: ExpertCardConfig;
  clientTelegramBotToken?: string;
  clientTelegramBotKey?: string;
  expertApplicant?: { botId: string; botKey: string };
  yookassa?: { mode: "test" | "live" };
  expertSession?: { botToken: string; botKey: string; botUsername?: string };
};
const exact = (r: RegExp, v: unknown): v is string =>
  typeof v === "string" && r.exec(v)?.[0] === v;
export function assertExpertCardConfig(config: Config): void {
  if (
    config.features.expertCard !== true &&
    config.features.expertCardMaterialDelivery !== true &&
    config.expertCard?.materialDeliveryEnabled !== true
  )
    return;
  const c = config.expertCard;
  if (
    !c ||
    !["test", "live"].includes(c.paymentMode) ||
    typeof c.materialDeliveryEnabled !== "boolean" ||
    typeof c.mainCheckoutEnabled !== "boolean" ||
    (c.mainCheckoutEnabled && config.features.expertCard !== true) ||
    (config.features.expertCardMaterialDelivery === true &&
      !c.materialDeliveryEnabled) ||
    (c.materialDeliveryEnabled &&
      (!exact(/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u, c.workBotToken) ||
        c.workBotToken.split(":")[0] !== c.workBotId)) ||
    !exact(/^[1-9][0-9]{0,15}$/u, c.workBotId) ||
    !Number.isSafeInteger(Number(c.workBotId)) ||
    !exact(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, c.workBotKey) ||
    !exact(/^[A-Za-z0-9_]{2,29}bot$/iu, c.workBotUsername) ||
    !exact(
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
      c.messagingConsentPolicyVersion,
    ) ||
    !exact(/^[A-Za-z0-9_-]{32,256}$/u, c.webhookSecret) ||
    /placeholder/iu.test(
      c.workBotKey +
        c.workBotUsername +
        c.messagingConsentPolicyVersion +
        c.webhookSecret,
    )
  )
    throw new Error("expert_card_configuration_required");
  if (
    config.features.expertCard === true &&
    config.yookassa &&
    config.yookassa.mode !== c.paymentMode
  )
    throw new Error("expert_card_payment_mode_conflict");
  if (
    [
      config.clientTelegramBotToken?.split(":")[0],
      config.expertApplicant?.botId,
    ].includes(c.workBotId) ||
    [config.clientTelegramBotKey, config.expertApplicant?.botKey].includes(
      c.workBotKey,
    ) ||
    (config.expertSession?.botToken &&
      config.expertSession.botToken.split(":")[0] !== c.workBotId) ||
    (config.expertSession?.botKey &&
      config.expertSession.botKey !== c.workBotKey) ||
    (config.expertSession?.botUsername &&
      config.expertSession.botUsername.toLowerCase() !==
        c.workBotUsername.toLowerCase())
  )
    throw new Error("expert_card_bot_scope_conflict");
}
export function readExpertCardConfig(
  source: NodeJS.ProcessEnv,
): ExpertCardConfig | undefined {
  const enabled = source.EXPERT_CARD_ENABLED || "false";
  const delivery = source.EXPERT_CARD_MATERIAL_DELIVERY_ENABLED || "false";
  const checkout = source.EXPERT_CARD_MAIN_CHECKOUT_ENABLED || "false";
  if (
    !["true", "false"].includes(enabled) ||
    !["true", "false"].includes(delivery) ||
    !["true", "false"].includes(checkout)
  )
    throw new Error("expert_card_configuration_invalid");
  if (checkout === "true" && enabled !== "true")
    throw new Error("expert_card_configuration_required");
  if (enabled !== "true" && delivery !== "true") return undefined;
  if (
    enabled === "true" &&
    source.YOOKASSA_MODE &&
    source.YOOKASSA_MODE !== source.EXPERT_CARD_PAYMENT_MODE
  )
    throw new Error("expert_card_payment_mode_conflict");
  const card = {
    paymentMode: source.EXPERT_CARD_PAYMENT_MODE as "test" | "live",
    materialDeliveryEnabled: delivery === "true",
    mainCheckoutEnabled: checkout === "true",
    ...(delivery === "true" && source.EXPERT_TELEGRAM_BOT_TOKEN
      ? { workBotToken: source.EXPERT_TELEGRAM_BOT_TOKEN }
      : {}),
    workBotId: source.EXPERT_CARD_WORK_BOT_ID ?? "",
    workBotKey: source.EXPERT_CARD_WORK_BOT_KEY ?? "",
    workBotUsername: source.EXPERT_CARD_WORK_BOT_USERNAME ?? "",
    messagingConsentPolicyVersion:
      source.EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION ?? "",
    webhookSecret: source.TELEGRAM_WEBHOOK_SECRET ?? "",
  };
  assertExpertCardConfig({
    features: {
      expertCard: enabled === "true",
      expertCardMaterialDelivery: delivery === "true",
    },
    expertCard: card,
    ...(source.TELEGRAM_BOT_TOKEN
      ? { clientTelegramBotToken: source.TELEGRAM_BOT_TOKEN }
      : {}),
    ...(source.CLIENT_TELEGRAM_BOT_KEY
      ? { clientTelegramBotKey: source.CLIENT_TELEGRAM_BOT_KEY }
      : {}),
    expertApplicant: {
      botId: source.EXPERT_PROMO_TELEGRAM_BOT_ID ?? "",
      botKey: source.EXPERT_PROMO_TELEGRAM_BOT_KEY ?? "",
    },
    expertSession: {
      botToken: source.EXPERT_TELEGRAM_BOT_TOKEN ?? "",
      botKey: source.EXPERT_TELEGRAM_BOT_KEY ?? "",
      botUsername: source.EXPERT_TELEGRAM_LOGIN_BOT_USERNAME ?? "",
    },
  });
  return card;
}
