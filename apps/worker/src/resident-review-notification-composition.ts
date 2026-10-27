import type { RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresResidentReviewRepository,
  type DrizzleDb,
  type ResidentReviewTransport,
} from "@ii-tonya/db";
import { createResidentReviewNotificationTransport } from "@ii-tonya/integrations";
import { createExpertCardMaterialsRunner } from "@ii-tonya/worker";
export function createResidentReviewNotificationLifecycle(
  config: RuntimeConfig,
  db: DrizzleDb,
  notifier?: ResidentReviewTransport,
) {
  if (config.features.residentReviewNotifications !== true) return undefined;
  const promo = config.expertApplicant,
    review = config.expertVerification;
  if (
    !promo ||
    !review ||
    config.features.expertVerification !== true ||
    !promo.botToken
  )
    throw Error("resident_review_notifier_required");
  const transport =
    notifier ??
    createResidentReviewNotificationTransport({
      token: promo.botToken,
      botKey: promo.botKey,
    });
  return createExpertCardMaterialsRunner({
    enabled: true,
    repository: new PostgresResidentReviewRepository(db, {
      providerMode: review.paymentMode,
      messagingConsentPolicyVersion: review.messagingConsentPolicyVersion,
      notifier: {
        send(input) {
          if (input.botId !== promo.botId || input.botKey !== promo.botKey)
            return Promise.reject(Error("resident_review_channel_invalid"));
          return transport.send(input);
        },
      },
    }),
  });
}
