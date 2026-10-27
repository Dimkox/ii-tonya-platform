export interface ExpertApplicantConfig {
  botToken?: string;
  botId: string;
  botKey: string;
  webhookSecret: string;
  messagingConsentPolicyVersion: string;
}
type ScopeConfig = {
  features: { expertApplicant?: boolean };
  expertApplicant?: ExpertApplicantConfig;
  clientTelegramBotToken?: string;
  clientTelegramBotKey?: string;
  telegramWebhookSecret?: string;
  expertSession?: { botToken: string; botKey: string };
};
const exact = (pattern: RegExp, value: unknown): value is string =>
  typeof value === "string" && pattern.exec(value)?.[0] === value;
const valid = (
  config: ExpertApplicantConfig | undefined,
): config is ExpertApplicantConfig =>
  config !== undefined &&
  exact(/^[1-9][0-9]{0,15}$/u, config.botId) &&
  Number.isSafeInteger(Number(config.botId)) &&
  exact(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, config.botKey) &&
  exact(/^[A-Za-z0-9_-]{32,256}$/u, config.webhookSecret) &&
  exact(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    config.messagingConsentPolicyVersion,
  ) &&
  !/placeholder/iu.test(
    config.botKey + config.webhookSecret + config.messagingConsentPolicyVersion,
  );
export function assertExpertApplicantConfig(config: ScopeConfig): void {
  if (config.features.expertApplicant !== true) return;
  const promo = config.expertApplicant;
  if (!valid(promo)) throw new Error("expert_applicant_configuration_required");
  if (
    promo.botToken !== undefined &&
    (!exact(/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u, promo.botToken) ||
      promo.botToken.split(":")[0] !== promo.botId)
  )
    throw new Error("expert_applicant_configuration_required");
  if (
    [
      config.clientTelegramBotToken?.split(":")[0],
      config.expertSession?.botToken.split(":")[0],
    ].includes(promo.botId) ||
    [config.clientTelegramBotKey, config.expertSession?.botKey].includes(
      promo.botKey,
    ) ||
    config.telegramWebhookSecret === promo.webhookSecret
  )
    throw new Error("expert_applicant_bot_scope_conflict");
}
export function readExpertApplicantConfig(
  source: NodeJS.ProcessEnv,
): ExpertApplicantConfig | undefined {
  const enabled = source.EXPERT_APPLICANT_ENABLED || "false";
  if (!["true", "false"].includes(enabled))
    throw new Error("expert_applicant_configuration_invalid");
  if (enabled !== "true") return undefined;
  const config = {
    ...(source.EXPERT_PROMO_TELEGRAM_BOT_TOKEN
      ? { botToken: source.EXPERT_PROMO_TELEGRAM_BOT_TOKEN }
      : {}),
    botId: source.EXPERT_PROMO_TELEGRAM_BOT_ID ?? "",
    botKey: source.EXPERT_PROMO_TELEGRAM_BOT_KEY ?? "",
    webhookSecret: source.EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET ?? "",
    messagingConsentPolicyVersion:
      source.EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION ?? "",
  };
  assertExpertApplicantConfig({
    features: { expertApplicant: true },
    expertApplicant: config,
    ...(source.TELEGRAM_BOT_TOKEN
      ? { clientTelegramBotToken: source.TELEGRAM_BOT_TOKEN }
      : {}),
    ...(source.TELEGRAM_WEBHOOK_SECRET
      ? { telegramWebhookSecret: source.TELEGRAM_WEBHOOK_SECRET }
      : {}),
    ...(source.CLIENT_TELEGRAM_BOT_KEY
      ? { clientTelegramBotKey: source.CLIENT_TELEGRAM_BOT_KEY }
      : {}),
    ...(source.EXPERT_TELEGRAM_BOT_TOKEN || source.EXPERT_TELEGRAM_BOT_KEY
      ? {
          expertSession: {
            botToken: source.EXPERT_TELEGRAM_BOT_TOKEN ?? "",
            botKey: source.EXPERT_TELEGRAM_BOT_KEY ?? "",
          },
        }
      : {}),
  });
  return config;
}
