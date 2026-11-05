import type { RuntimeConfig } from "@ii-tonya/config";
import {
  EXPERT_PROMO_LOCAL_ASSETS,
  telegramAssetForm,
} from "./expert-promo-local-assets.js";
import {
  runExpertPromoFunnelTimers,
  runExpertPromoGuideDelivery,
} from "@ii-tonya/application";
import {
  PostgresExpertPromoFunnelRepository,
  type DrizzleDb,
} from "@ii-tonya/db";

/** Promo-bot delivery: configured file IDs or bundled multipart uploads. */
export function createExpertPromoFunnelRunner(
  db: DrizzleDb,
  config: RuntimeConfig,
  fetcher: typeof fetch = fetch,
) {
  const scope = config.expertApplicant;
  if (scope?.waitlistV4Enabled !== true) return undefined;
  if (!scope.botToken || scope.botToken.split(":")[0] !== scope.botId)
    throw new Error("expert_promo_funnel_configuration_required");
  const repository = new PostgresExpertPromoFunnelRepository(db, {
    botKey: scope.botKey,
    messagingConsentPolicyVersion: scope.messagingConsentPolicyVersion,
  });
  const send = async (
    method: string,
    body: Record<string, unknown> | FormData,
  ) => {
    const response = await fetcher(
      `https://api.telegram.org/bot${scope.botToken}/${method}`,
      {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("expert_promo_telegram_unavailable");
    const value = (await response.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
    };
    if (value.ok !== true || !Number.isSafeInteger(value.result?.message_id))
      throw new Error("expert_promo_telegram_receipt");
    return { messageId: String(value.result!.message_id) };
  };
  return {
    async runOnce() {
      const timers = await runExpertPromoFunnelTimers(
        {
          claimTimer: repository.claimTimer.bind(repository),
          sendMessage: ({ chatId, text, replyMarkup }) =>
            send("sendMessage", {
              chat_id: chatId,
              text,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          sendPhoto: async ({ chatId, photo }) =>
            photo === EXPERT_PROMO_LOCAL_ASSETS.banner.slot
              ? send(
                  "sendPhoto",
                  await telegramAssetForm({
                    chatId,
                    field: "photo",
                    ...EXPERT_PROMO_LOCAL_ASSETS.banner,
                  }),
                )
              : send("sendPhoto", { chat_id: chatId, photo }),
        },
        {
          limit: 20,
          banner:
            scope.giftBannerFileId || EXPERT_PROMO_LOCAL_ASSETS.banner.slot,
        },
      );
      const guide = await runExpertPromoGuideDelivery(
        {
          claimGuideDeliveries:
            repository.claimGuideDeliveries.bind(repository),
          markGuideDelivered: repository.markGuideDelivered.bind(repository),
          sendDocument: async ({ chatId, document, caption }) =>
            document === EXPERT_PROMO_LOCAL_ASSETS.guide.slot
              ? send(
                  "sendDocument",
                  await telegramAssetForm({
                    chatId,
                    field: "document",
                    caption,
                    ...EXPERT_PROMO_LOCAL_ASSETS.guide,
                  }),
                )
              : send("sendDocument", { chat_id: chatId, document, caption }),
        },
        {
          document: scope.guideFileId || EXPERT_PROMO_LOCAL_ASSETS.guide.slot,
          limit: 20,
        },
      );
      return { timers, guide };
    },
  };
}
