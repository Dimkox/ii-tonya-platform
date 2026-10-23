export interface ClientAccountQueriesConfig {
  botId: string;
  botKey: string;
  messagingConsentPolicyVersion: string;
  providerMode: "test" | "live";
}
export function assertClientAccountQueriesConfig(config: {
  features: { clientAccountQueries?: boolean };
  telegramWebhookSecret?: string | undefined;
  clientAccountQueries?: ClientAccountQueriesConfig;
  clientTelegramBotToken?: string | undefined;
  clientTelegramBotKey?: string | undefined;
  clientMessagingConsentPolicyVersion?: string | undefined;
}) {
  if (config.features.clientAccountQueries !== true) return;
  const s = config.clientAccountQueries;
  if (
    !s ||
    !/^[A-Za-z0-9_-]{32,256}$/u.test(config.telegramWebhookSecret ?? "") ||
    /placeholder/iu.test(config.telegramWebhookSecret ?? "") ||
    !/^[1-9]\d{0,15}$/.test(s.botId) ||
    !Number.isSafeInteger(Number(s.botId)) ||
    !s.botKey ||
    /placeholder/i.test(s.botKey) ||
    !s.messagingConsentPolicyVersion ||
    !["test", "live"].includes(s.providerMode) ||
    config.clientTelegramBotToken?.split(":")[0] !== s.botId ||
    config.clientTelegramBotKey !== s.botKey ||
    config.clientMessagingConsentPolicyVersion !==
      s.messagingConsentPolicyVersion
  )
    throw Error("client_account_queries_configuration_required");
}
export function readClientAccountQueriesConfig(
  source: Record<string, string | undefined>,
): ClientAccountQueriesConfig | undefined {
  if (
    source.CLIENT_ACCOUNT_QUERIES_ENABLED === undefined ||
    source.CLIENT_ACCOUNT_QUERIES_ENABLED === "false"
  )
    return undefined;
  if (source.CLIENT_ACCOUNT_QUERIES_ENABLED !== "true")
    throw Error("client_account_queries_configuration_required");
  const s = {
    botId: source.TELEGRAM_BOT_TOKEN?.split(":")[0] ?? "",
    botKey: source.CLIENT_TELEGRAM_BOT_KEY ?? "",
    messagingConsentPolicyVersion:
      source.CLIENT_MESSAGING_CONSENT_POLICY_VERSION ?? "",
    providerMode: source.CLIENT_ACCOUNT_QUERIES_PAYMENT_MODE as "test" | "live",
  };
  assertClientAccountQueriesConfig({
    features: { clientAccountQueries: true },
    clientAccountQueries: s,
    telegramWebhookSecret: source.TELEGRAM_WEBHOOK_SECRET,
    clientTelegramBotToken: source.TELEGRAM_BOT_TOKEN,
    clientTelegramBotKey: source.CLIENT_TELEGRAM_BOT_KEY,
    clientMessagingConsentPolicyVersion:
      source.CLIENT_MESSAGING_CONSENT_POLICY_VERSION,
  });
  return s;
}
