/** Formatting alone does not authorize a notice or prove ownership of a checkout. */
export function renderFinalCallMessage(input: {
  name: string;
  basePriceMinor: bigint;
  clientStartAtMs: number;
  checkoutUrl: string;
}): string {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.name.trim().length === 0 ||
    input.name.length > 100 ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(input.name) ||
    !Number.isSafeInteger(input.clientStartAtMs) ||
    Math.abs(input.clientStartAtMs) > 8640000000000000 - 86400000 ||
    typeof input.basePriceMinor !== "bigint" ||
    input.basePriceMinor <= 0n ||
    input.basePriceMinor > 999999999999n ||
    typeof input.checkoutUrl !== "string" ||
    input.checkoutUrl.length > 2048
  )
    throw new Error("early_bird_notice_invalid");
  let url: URL;
  try {
    url = new URL(input.checkoutUrl);
  } catch {
    throw new Error("early_bird_notice_invalid");
  }
  if (
    url.protocol !== "https:" ||
    !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new Error("early_bird_notice_invalid");
  const rubles = (input.basePriceMinor / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  const kopecks = input.basePriceMinor % 100n;
  const amount =
    kopecks === 0n
      ? rubles
      : `${rubles},${kopecks.toString().padStart(2, "0")}`;
  const dateFormat = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
  const date = (value: number) =>
    dateFormat.format(new Date(value)).replace(/\s*г\.$/u, " года");
  const start = date(input.clientStartAtMs);
  const deadline = date(input.clientStartAtMs - 86400000);
  return `${input.name.trim()}, напоминаем: старт платформы ${start}!\n\nАкция «Энергия начала» завершена. Ваша базовая цена за размещение: ${amount} ₽/мес.\n\nЧтобы занять место в первой волне показов, оплатите тариф до ${deadline} включительно.\n\n${url.href}`;
}
