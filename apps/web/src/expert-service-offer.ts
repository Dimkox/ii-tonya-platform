/** Client display for expert-service offer facts. Nulls stay hidden. */

export type ExpertServiceFormat = "online" | "offline" | "hybrid";

export interface ExpertServiceOfferView {
  priceMinor?: number;
  currency?: "RUB";
  format?: ExpertServiceFormat;
  location?: string;
}

const FORMATS = ["online", "offline", "hybrid"] as const;
const isFormat = (value: string): value is ExpertServiceFormat =>
  (FORMATS as readonly string[]).includes(value);

export function formatExpertServicePrice(minor: number): string {
  const rubles = Math.trunc(minor / 100);
  const kopecks = minor % 100;
  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (kopecks === 0) return `${grouped} ₽`;
  return `${grouped},${String(kopecks).padStart(2, "0")} ₽`;
}

const FORMAT_LABEL: Record<ExpertServiceFormat, string> = {
  online: "Онлайн",
  offline: "Офлайн",
  hybrid: "Онлайн/офлайн",
};

export function formatExpertServiceOfferLine(offer: {
  priceMinor?: number | null;
  currency?: string | null;
  format?: string | null;
  location?: string | null;
}): string {
  const parts: string[] = [];
  if (
    typeof offer.priceMinor === "number" &&
    Number.isSafeInteger(offer.priceMinor) &&
    offer.priceMinor >= 0 &&
    (offer.currency === undefined ||
      offer.currency === null ||
      offer.currency === "RUB")
  )
    parts.push(formatExpertServicePrice(offer.priceMinor));
  if (typeof offer.format === "string" && isFormat(offer.format))
    parts.push(FORMAT_LABEL[offer.format]);
  if (typeof offer.location === "string" && offer.location.length > 0)
    parts.push(offer.location);
  return parts.join(" · ");
}

export function readExpertServiceOffer(
  record: Record<string, unknown>,
): ExpertServiceOfferView {
  const { priceMinor, currency, format, location } = record;
  if (
    priceMinor === undefined &&
    currency === undefined &&
    format === undefined &&
    location === undefined
  )
    return {};
  if (
    (priceMinor !== undefined || currency !== undefined) &&
    (typeof priceMinor !== "number" ||
      !Number.isSafeInteger(priceMinor) ||
      priceMinor < 0 ||
      currency !== "RUB")
  )
    throw new Error("invalid_offer");
  if (format !== undefined && (typeof format !== "string" || !isFormat(format)))
    throw new Error("invalid_offer");
  if (
    location !== undefined &&
    (typeof location !== "string" ||
      location.length < 1 ||
      location.length > 500)
  )
    throw new Error("invalid_offer");
  if ((format === "offline" || format === "hybrid") && location === undefined)
    throw new Error("invalid_offer");
  return {
    ...(typeof priceMinor === "number"
      ? { priceMinor, currency: "RUB" as const }
      : {}),
    ...(format === undefined ? {} : { format }),
    ...(location === undefined ? {} : { location }),
  };
}
