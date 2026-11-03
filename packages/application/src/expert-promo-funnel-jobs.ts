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
