import type { RuntimeConfig } from "@ii-tonya/config";
import {
  APPROVED_PROMO_GUIDE,
  createApprovedGuideReader,
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
  const readPresentation =
    scope.guideFileId === APPROVED_PROMO_GUIDE.slot
      ? createApprovedGuideReader(APPROVED_PROMO_GUIDE)
      : undefined;
  const send = async (
    method: string,
    body: Record<string, unknown> | FormData,
  ) => {
    const response = await fetcher(
      `https://api.telegram.org/bot${scope.botToken}/${method}`,
      {
        method: "POST",
        redirect: "error",
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
    const messageId = value.result?.message_id;
    if (
      value.ok !== true ||
      typeof messageId !== "number" ||
      !Number.isSafeInteger(messageId) ||
      messageId <= 0
    )
      throw new Error("expert_promo_telegram_receipt");
    return { messageId: String(messageId) };
  };
  return {
    async runOnce() {
      const presentation = await readPresentation?.();
      const document =
        readPresentation && !presentation ? undefined : scope.guideFileId;
      const timers = await runExpertPromoFunnelTimers(
        {
          claimTimer: repository.claimTimer.bind(repository),
          confirmFirstReminder:
            repository.confirmFirstReminder.bind(repository),
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
          guideAvailable: Boolean(document),
          banner:
            scope.giftBannerFileId || EXPERT_PROMO_LOCAL_ASSETS.banner.slot,
        },
      );
      const guide = await runExpertPromoGuideDelivery(
        {
          claimGuideDeliveries:
            repository.claimGuideDeliveries.bind(repository),
          markGuideDelivered: repository.markGuideDelivered.bind(repository),
          sendDocument: async ({ chatId, document, caption }) => {
            if (document === APPROVED_PROMO_GUIDE.slot) {
              if (!presentation)
                throw new Error("expert_promo_guide_unavailable");
              const form = new FormData();
              form.set("chat_id", chatId);
              form.set("document", presentation);
              form.set("caption", caption);
              return send("sendDocument", form);
            }
            return document === EXPERT_PROMO_LOCAL_ASSETS.guide.slot
              ? send(
                  "sendDocument",
                  await telegramAssetForm({
                    chatId,
                    field: "document",
                    caption,
                    ...EXPERT_PROMO_LOCAL_ASSETS.guide,
                  }),
                )
              : send("sendDocument", { chat_id: chatId, document, caption });
          },
        },
        {
          ...(document ? { document } : {}),
          limit: 20,
        },
      );
      return { timers, guide };
    },
  };
}
