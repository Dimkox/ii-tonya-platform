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

/** Approved v4 reminder copy. Dynamic values come from the claimed DB row. */
export const FUNNEL_TIMER_TEXT = {
  message6:
    "Привет! 👋\n\nВидим, что вы пока не торопитесь приглашать коллег. Возможно, хотите сначала разобраться сами? Это нормально.\n\nЧтобы помочь вам принять решение, мы решили запустить мини-акцию:\n**Подарим тот самый авторитетный гид «Как получить теплых целевых клиентов» за всего двух приглашенных партнеров.**\n\n✅ Новые клиенты без таргета — сервис приводит людей, готовых купить услугу.\n✅ Свобода от рутины — умный ассистент поможет с переписками, напоминаниями и записью.\n✅ Выгодные партнёрства и взаимный обмен аудиторией.\n✅ Внутренние купоны и бонусы для снижения стоимости размещения.\n✅ Юридическая безопасность работы через сервис.\n✅ Стратегия входа до основного потока участников.\n\nКак только второй новый человек зарегистрируется по вашему коду, бот автоматически пришлет вам файл.\n\nВ зачёт идут только новые люди: они ещё не запускали бота и не приходили по чужому коду. PDF придёт один раз, когда таких будет двое.",
  gift: "Привет! 👋\n\nМы видим, что вы пока не успели собрать двух партнеров. Ничего страшного — возможно, сейчас неподходящее время или мало свободного пространства.\n\nЧтобы вы не оставались в неведении, мы решили просто подарить вам наш главный гид **«Как получить теплых целевых клиентов на свои услуги с помощью нового сервиса ии-Тоня»**.\n\n🗺 Как Тоня фильтрует шум соцсетей и приводит готовых купить клиентов.\n💰 Как монетизировать пустые слоты через взаимный обмен аудиторией.\n🛡 Почему это легально и безопасно для вашего личного бренда.\n🚀 Какие шаги сделать первыми, чтобы войти в систему с преимуществами.\n\nИзучите информацию в спокойном режиме. PDF придёт следующим сообщением.",
} as const;
export async function runExpertPromoFunnelTimers(
  ports: {
    claimTimer(input: { kind: "message6" | "gift"; limit: number }): Promise<
      {
        userId: string;
        chatId: string;
        refCode?: string;
        referralCount?: number;
      }[]
    >;
    sendMessage(input: {
      chatId: string;
      text: string;
      replyMarkup?: unknown;
    }): Promise<unknown>;
    sendPhoto?(input: { chatId: string; photo: string }): Promise<unknown>;
  },
  config: { limit?: number; banner?: string } = {},
) {
  const result = { message6: 0, gift: 0, failed: 0 };
  for (const kind of ["message6", "gift"] as const) {
    for (const target of await ports.claimTimer({
      kind,
      limit: config.limit ?? 20,
    })) {
      try {
        if (config.banner && ports.sendPhoto)
          await ports.sendPhoto({
            chatId: target.chatId,
            photo: config.banner,
          });
        const count = target.referralCount ?? 0;
        const dynamic =
          kind === "message6"
            ? `\n\nСейчас по вашему коду зарегистрировано: **${count}** человек.\nОсталось пригласить ещё **${Math.max(0, 2 - count)}**!`
            : `\n\nВаш личный промокод ${target.refCode ?? ""} всегда активен. Напишите слово **«ПРОМОКОД»**, и я снова дам готовые тексты для рассылки.`;
        await ports.sendMessage({
          chatId: target.chatId,
          text: FUNNEL_TIMER_TEXT[kind] + dynamic,
          ...(kind === "message6"
            ? {
                replyMarkup: {
                  inline_keyboard: [
                    [
                      {
                        text: "Хочу вспомнить свой промокод",
                        callback_data: "wl:materials",
                      },
                    ],
                    [
                      {
                        text: "Не хочу участвовать, просто жду старта",
                        callback_data: "wl:optout",
                      },
                    ],
                  ],
                },
              }
            : {}),
        });
        result[kind]++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}

/** WAIT-T06 CRM sync. Disabled by default; the CRM port is injected and no
 * real CRM client exists in this repository (no external calls). */
export interface ExpertPromoCrmContact {
  userId: string;
  firstName: string | null;
  gender: "female" | "male" | null;
  status: string;
  referralCount: number;
}
export async function runExpertPromoCrmSync(
  ports: {
    listCrmDue(limit: number): Promise<ExpertPromoCrmContact[]>;
    markCrmSynced(input: {
      userId: string;
      referralCount: number;
    }): Promise<boolean>;
    crm?: { upsertContact(contact: ExpertPromoCrmContact): Promise<void> };
  },
  config: { enabled?: boolean; limit?: number } = {},
) {
  if (config.enabled !== true || !ports.crm)
    return { synced: 0, failed: 0, skipped: true };
  let synced = 0;
  let failed = 0;
  for (const contact of await ports.listCrmDue(config.limit ?? 50)) {
    try {
      await ports.crm.upsertContact(contact);
      await ports.markCrmSynced({
        userId: contact.userId,
        referralCount: contact.referralCount,
      });
      synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed, skipped: false };
}
