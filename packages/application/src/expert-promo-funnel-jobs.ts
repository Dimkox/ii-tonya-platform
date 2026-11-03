/** WAIT-T03: PDF guide delivery through the promo bot's existing Telegram channel. */
export interface ExpertPromoGuideDeliveryPorts {
  claimGuideDeliveries(input: {
    contentSlot: string;
    limit: number;
  }): Promise<{ userId: string; chatId: string }[]>;
  markGuideDelivered(input: {
    userId: string;
    receipt: string;
  }): Promise<boolean>;
  sendDocument(input: {
    chatId: string;
    document: string;
    caption: string;
  }): Promise<{ messageId: string }>;
}
export const GUIDE_CAPTION =
  "Спасибо! Двое коллег зарегистрировались по вашему коду. Ваш гайд — в этом PDF.";
export async function runExpertPromoGuideDelivery(
  ports: ExpertPromoGuideDeliveryPorts,
  config: { document?: string; limit?: number },
): Promise<{ delivered: number; failed: number; skipped: boolean }> {
  // Without owner content (WAIT-T07) the work stays waiting_content.
  if (!config.document) return { delivered: 0, failed: 0, skipped: true };
  const claimed = await ports.claimGuideDeliveries({
    contentSlot: config.document,
    limit: config.limit ?? 20,
  });
  let delivered = 0;
  let failed = 0;
  for (const target of claimed) {
    try {
      const sent = await ports.sendDocument({
        chatId: target.chatId,
        document: config.document,
        caption: GUIDE_CAPTION,
      });
      if (
        await ports.markGuideDelivered({
          userId: target.userId,
          receipt: `telegram:${sent.messageId}`,
        })
      )
        delivered++;
    } catch {
      // Claimed row stays pending: uncertain delivery is never retried automatically.
      failed++;
    }
  }
  return { delivered, failed, skipped: false };
}

/** WAIT-T04 reminder texts; final wording is owner content (WAIT-T07). */
export const FUNNEL_TIMER_TEXT = {
  message6:
    "Напоминаем: пригласите двух коллег по вашему коду и получите гайд. Отписаться от напоминаний: /optout_ref",
  gift: "Ваш подарок ждёт: пригласите коллег по коду, чтобы получить гайд и бонус. Отписаться: /optout_ref",
} as const;
export async function runExpertPromoFunnelTimers(
  ports: {
    claimTimer(input: {
      kind: "message6" | "gift";
      limit: number;
    }): Promise<{ userId: string; chatId: string }[]>;
    sendMessage(input: { chatId: string; text: string }): Promise<unknown>;
  },
  config: { limit?: number } = {},
) {
  const result = { message6: 0, gift: 0, failed: 0 };
  for (const kind of ["message6", "gift"] as const) {
    for (const target of await ports.claimTimer({
      kind,
      limit: config.limit ?? 20,
    })) {
      try {
        await ports.sendMessage({
          chatId: target.chatId,
          text: FUNNEL_TIMER_TEXT[kind],
        });
        result[kind]++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
