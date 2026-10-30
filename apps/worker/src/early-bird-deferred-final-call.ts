/** No message-open tracking is claimed. Repeats require the approved campaign policy and
 * no Pay click after the initial delivery.
 */
export type DeferredFinalCallStore = {
  enqueueDue(limit: number): Promise<number>;
  excludeUnpaid(limit: number): Promise<number>;
  queue: {
    claim(): Promise<FinalCallClaim | null>;
    dispatch(claim: FinalCallClaim): Promise<boolean>;
  };
  sendIfCurrent(
    claim: FinalCallClaim,
    send: (resume: FinalCallResume) => Promise<{ messageId: string }>,
  ): Promise<FinalCallResult>;
  finish(claim: FinalCallClaim, result: FinalCallResult): Promise<boolean>;
};
type FinalCallClaim = {
  noticeId: string;
  attemptId: string;
  userId: string;
  kind: "first" | "repeat";
};
type FinalCallResume = {
  chatId: string;
  subscriptionMinor: string;
  clientStartMs: number;
  callbackData: string;
};
type FinalCallResult =
  | { kind: "delivered"; messageId: string }
  | { kind: "cancelled" | "retry" | "uncertain" };
export type FinalCallTelegram = {
  send(input: {
    chatId: string;
    text: string;
    replyMarkup: {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    signal: AbortSignal;
  }): Promise<{ messageId: string }>;
};
export function finalCallResumeMessage(input: {
  subscriptionMinor: string;
  clientStartMs: number;
}): string {
  if (
    !/^[1-9]\d{0,11}$/u.test(input.subscriptionMinor) ||
    !Number.isSafeInteger(input.clientStartMs)
  )
    throw new Error("early_bird_notice_invalid");
  const amount = BigInt(input.subscriptionMinor);
  const price = `${amount / 100n}${amount % 100n === 0n ? "" : `,${(amount % 100n).toString().padStart(2, "0")}`}`;
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
  return `Напоминаем: старт платформы ${date.format(input.clientStartMs)}.\n\nАкция «Энергия начала» завершена. Ваша базовая цена: ${price} ₽/мес.\n\nОплатите тариф до ${date.format(input.clientStartMs - 86400000)} включительно, чтобы участвовать в первой волне показов. Нажмите «Оплатить тариф»: бот проверит ваши данные и выдаст ссылку ЮKassa. Для чека может понадобиться заново указать email.`;
}

/** Explicitly started and default-off. Calendar selection uses PostgreSQL time;
 * polling catches outages without resending dispatched/uncertain messages.
 */
export function createDeferredFinalCallJob(
  store: DeferredFinalCallStore,
  telegram: FinalCallTelegram,
) {
  let running = false;
  return async (
    limit = 20,
    signal: AbortSignal = new AbortController().signal,
  ) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_notice_limit_invalid");
    const counts = { queued: 0, delivered: 0, uncertain: 0, excluded: 0 };
    if (running || signal.aborted) return counts;
    running = true;
    try {
      counts.excluded = await store.excludeUnpaid(limit);
      counts.queued = await store.enqueueDue(limit);
      for (let i = 0; i < limit && !signal.aborted; i++) {
        const claim = await store.queue.claim();
        if (!claim) break;
        if (!(await store.queue.dispatch(claim))) continue;
        let result: FinalCallResult;
        try {
          result = await store.sendIfCurrent(claim, (resume) =>
            telegram.send({
              chatId: resume.chatId,
              text: finalCallResumeMessage(resume),
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: "Оплатить тариф",
                      callback_data: resume.callbackData,
                    },
                  ],
                ],
              },
              signal,
            }),
          );
        } catch {
          result = { kind: "uncertain" };
        }
        if (!(await store.finish(claim, result))) {
          counts.uncertain++;
          continue;
        }
        if (result.kind === "delivered") counts.delivered++;
        if (result.kind === "uncertain") counts.uncertain++;
      }
      return counts;
    } finally {
      running = false;
    }
  };
}
