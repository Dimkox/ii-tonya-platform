import type { RuntimeConfig } from "@ii-tonya/config";
import {
  createExpertMaterialTransport,
  type ExpertMaterialTransport,
} from "@ii-tonya/integrations";
export function assertPersonalOfferNoticeConfig(config: RuntimeConfig): void {
  if (
    config.features.expertResidencyNoticeDelivery !== true ||
    config.features.expertApplicant !== true
  )
    return;
  const promo = config.expertApplicant;
  if (
    !promo?.botToken ||
    /^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u.exec(promo.botToken)?.[0] !==
      promo.botToken ||
    promo.botToken.split(":")[0] !== promo.botId
  )
    throw new Error("personal_offer_promo_notice_configuration_required");
}
/** Exact bot scope routing; tokens never cross the configured bot boundary. */
export function createPersonalOfferNoticeTransport(
  config: RuntimeConfig,
  fetch?: typeof globalThis.fetch,
): ExpertMaterialTransport {
  assertPersonalOfferNoticeConfig(config);
  const work = config.expertCard!;
  const promo = config.expertApplicant;
  const workTransport = createExpertMaterialTransport({
    token: work.workBotToken!,
    botId: work.workBotId,
    botKey: work.workBotKey,
    ...(fetch ? { fetch } : {}),
  });
  const promoTransport = promo?.botToken
    ? createExpertMaterialTransport({
        token: promo.botToken,
        botId: promo.botId,
        botKey: promo.botKey,
        ...(fetch ? { fetch } : {}),
      })
    : undefined;
  return {
    send(request) {
      if (
        promoTransport &&
        request.botId === promo!.botId &&
        request.botKey === promo!.botKey
      )
        return promoTransport.send(request);
      if (
        request.botId === work.workBotId &&
        request.botKey === work.workBotKey
      )
        return workTransport.send(request);
      return Promise.reject(
        new Error("personal_offer_notice_scope_unavailable"),
      );
    },
  };
}
