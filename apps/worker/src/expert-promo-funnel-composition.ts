import type { RuntimeConfig } from "@ii-tonya/config";
import {
  runExpertPromoFunnelTimers,
  runExpertPromoGuideDelivery,
} from "@ii-tonya/application";
import {
  PostgresExpertPromoFunnelRepository,
  type DrizzleDb,
} from "@ii-tonya/db";

/** Promo-bot delivery only. Missing owner assets leave guide work queued. */
export function createExpertPromoFunnelRunner(
  db: DrizzleDb,
  config: RuntimeConfig,
  fetcher: typeof fetch = fetch,
) {
  const scope = config.expertApplicant;
  if (scope?.waitlistV4Enabled !== true) return undefined;
  if (!scope.botToken || scope.botToken.split(":")[0] !== scope.botId)
    throw new Error("expert_promo_funnel_configuration_required");
  const repository = new PostgresExpertPromoFunnelRepository(db);
  const send = async (method: string, body: Record<string, unknown>) => {
    const response = await fetcher(
      `https://api.telegram.org/bot${scope.botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
          ...repository,
          sendMessage: ({ chatId, text, replyMarkup }) =>
            send("sendMessage", {
              chat_id: chatId,
              text,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          sendPhoto: ({ chatId, photo }) =>
            send("sendPhoto", { chat_id: chatId, photo }),
        },
        {
          limit: 20,
          ...(scope.giftBannerFileId ? { banner: scope.giftBannerFileId } : {}),
        },
      );
      const guide = await runExpertPromoGuideDelivery(
        {
          ...repository,
          sendDocument: ({ chatId, document, caption }) =>
            send("sendDocument", { chat_id: chatId, document, caption }),
        },
        { document: scope.guideFileId, limit: 20 },
      );
      return { timers, guide };
    },
  };
}
