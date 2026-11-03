/** WAIT-T05 deterministic FAQ matcher (no LLM). Entries are injectable; the
 * defaults cover only mechanics already implemented in the promo bot. */
export type ExpertPromoFaqEntry = readonly [question: string, answer: string];
export const EXPERT_PROMO_DEFAULT_FAQ: readonly ExpertPromoFaqEntry[] = [
  [
    "Как получить реферальный код?",
    "Отправьте /start. Бот выдаст ваш личный код promo_…, им можно делиться с коллегами.",
  ],
  [
    "Когда я получу гайд PDF?",
    "Гайд приходит автоматически, когда по вашему коду зарегистрируются два коллеги.",
  ],
  [
    "Как отключить напоминания о реферальной программе?",
    "Отправьте /optout_ref. Напоминания остановятся, остальные функции бота работают.",
  ],
  [
    "Когда запуск платформы?",
    "Мы сообщим о запуске в этом боте. Пока вы в листе ожидания.",
  ],
];
const stem = (w: string) => w.slice(0, 5);
const tokens = (text: string) =>
  new Set(
    (
      text
        .toLowerCase()
        .replace(/ё/gu, "е")
        .match(/[\p{L}\p{N}]{4,}/gu) ?? []
    ).map(stem),
  );
export function matchExpertPromoFaq(
  text: string,
  entries: readonly ExpertPromoFaqEntry[] = EXPERT_PROMO_DEFAULT_FAQ,
): string | null {
  const input = tokens(text);
  if (input.size === 0) return null;
  let best: { score: number; answer: string } | null = null;
  for (const [question, answer] of entries) {
    const q = tokens(question);
    let hit = 0;
    for (const t of q) if (input.has(t)) hit++;
    const score = q.size ? hit / q.size : 0;
    if (hit >= 2 && score >= 0.4 && (!best || score > best.score))
      best = { score, answer };
  }
  return best?.answer ?? null;
}
