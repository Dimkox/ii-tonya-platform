/** Copy and callback format only. Do not expose until wave-one payment authority is enabled. */
export function earlyBirdTermsMessage(
  name: string,
  clientStart: Date,
  discountEligible: boolean,
): string {
  if (typeof discountEligible !== "boolean")
    throw new Error("early_bird_invalid_eligibility");
  if (!Number.isFinite(clientStart.getTime()))
    throw new Error("early_bird_invalid_start");
  const start = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  })
    .format(clientStart)
    .replace(/\s*г\.$/u, " года");
  const deadline = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(clientStart.getTime() - 86400000));
  return `${name}, отлично! Вы подтвердили участие в программе «Первые Птички».

Важные даты:
• Набор резидентов: ноябрь–декабрь 2026.
• Старт приёма клиентов: ${start}.

Сейчас вам НЕ НУЖНО публиковать анонсы участия: сервис ещё не готов к массовому приёму клиентов. После объявления старта мы пришлём комплект промо-материалов — тогда вы сможете рассказать о нас своей аудитории.

У вас есть два пути:
${discountEligible ? "1. Оплатить тариф сейчас единым чеком с онбордингом в течение 10 дней после расчёта, чтобы сохранить скидку «Энергия начала»." : "1. Скидка недоступна. Оплатить онбординг и тариф сейчас по базовой цене."}
2. Оплатить онбординг сейчас, а тариф перед стартом до ${deadline} по базовой цене без скидки.

Оплаченный период тарифа начинается с даты старта. Как хотите поступить?`;
}

const offerPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type Choice = "now" | "later" | "subscription";
export function earlyBirdChoiceButtons(
  offerId: string,
  revision: number,
  discountEligible: boolean,
) {
  if (
    typeof discountEligible !== "boolean" ||
    !offerPattern.test(offerId) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision > 999999
  )
    throw new Error("early_bird_invalid_choice");
  const button = (text: string, choice: Choice) => ({
    text,
    callback_data: `eb:${offerId}:${revision}:${choice}`,
  });
  return [
    [
      button(
        discountEligible
          ? "Оплачу сейчас со скидкой"
          : "Оплачу сейчас по базовой цене",
        "now",
      ),
    ],
    [button("Оплачу перед стартом", "later")],
  ];
}

export function parseEarlyBirdChoice(
  data: string,
): { offerId: string; revision: number; choice: Choice } | null {
  const match =
    /^eb:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(0|[1-9]\d{0,5}):(now|later|subscription)$/u.exec(
      data,
    );
  return match
    ? {
        offerId: match[1]!,
        revision: Number(match[2]),
        choice: match[3] as Choice,
      }
    : null;
}

const compactUuid = (value: string): string => {
  if (!offerPattern.test(value)) throw new Error("early_bird_invalid_choice");
  return Buffer.from(value.replaceAll("-", ""), "hex").toString("base64url");
};
const expandUuid = (value: string): string | null => {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(value)) return null;
  const raw = Buffer.from(value, "base64url");
  if (raw.length !== 16 || raw.toString("base64url") !== value) return null;
  const hex = raw.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export function earlyBirdPositiveButton(
  offerId: string,
  revision: number,
  grantId: string | null,
) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= 999999)
    throw new Error("early_bird_invalid_choice");
  const callback_data = `ep:${compactUuid(offerId)}:${revision}:${grantId === null ? "s" : compactUuid(grantId)}`;
  if (Buffer.byteLength(callback_data) > 64)
    throw new Error("early_bird_invalid_choice");
  return { text: "Условия подходят", callback_data };
}
export function parseEarlyBirdPositive(
  data: string,
): { offerId: string; revision: number; grantId: string | null } | null {
  const m =
    /^ep:([A-Za-z0-9_-]{22}):(0|[1-9]\d{0,5}):(s|[A-Za-z0-9_-]{22})$/u.exec(
      data,
    );
  if (!m || Number(m[2]) >= 999999) return null;
  const offerId = expandUuid(m[1]!);
  const grantId = m[3] === "s" ? null : expandUuid(m[3]!);
  return offerId && (m[3] === "s" || grantId)
    ? { offerId, revision: Number(m[2]), grantId }
    : null;
}
