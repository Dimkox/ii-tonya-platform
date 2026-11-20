/** Display-only offer facts for an expert service. Not a payment amount. */

export const EXPERT_SERVICE_FORMATS = ["online", "offline", "hybrid"] as const;
export type ExpertServiceFormat = (typeof EXPERT_SERVICE_FORMATS)[number];

export type ExpertServiceOfferReason =
  "price" | "format" | "location" | "currency" | "service";

export class ExpertServiceOfferInvalidError extends Error {
  readonly reason: ExpertServiceOfferReason;
  constructor(reason: ExpertServiceOfferReason) {
    super(`expert_service_offer_invalid:${reason}`);
    this.name = "ExpertServiceOfferInvalidError";
    this.reason = reason;
  }
}

export interface ExpertServiceOffer {
  readonly priceMinor: number | null;
  readonly currency: "RUB";
  readonly format: ExpertServiceFormat | null;
  readonly location: string | null;
}

export interface PublicExpertServiceOffer {
  readonly priceMinor?: number;
  readonly currency?: "RUB";
  readonly format?: ExpertServiceFormat;
  readonly location?: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/u;
const INTEGER_TEXT = /^(?:0|[1-9]\d*)$/u;
const MAX_MINOR = 2_147_483_647;
const MAX_LOCATION = 500;

const isFormat = (value: string): value is ExpertServiceFormat =>
  (EXPERT_SERVICE_FORMATS as readonly string[]).includes(value);

const coerceMinor = (value: unknown): unknown => {
  if (typeof value !== "string" || !INTEGER_TEXT.test(value)) return value;
  const parsed = Number(value);
  if (parsed > MAX_MINOR) throw new ExpertServiceOfferInvalidError("price");
  return parsed;
};

export function parseExpertServiceOffer(input: {
  priceMinor: unknown;
  currency?: unknown;
  format: unknown;
  location: unknown;
}): ExpertServiceOffer {
  const rawPrice = coerceMinor(input.priceMinor);
  let priceMinor: number | null;
  if (rawPrice === null) priceMinor = null;
  else if (
    typeof rawPrice === "number" &&
    Number.isSafeInteger(rawPrice) &&
    rawPrice >= 0 &&
    rawPrice <= MAX_MINOR
  )
    priceMinor = rawPrice;
  else throw new ExpertServiceOfferInvalidError("price");

  if (
    input.currency !== undefined &&
    input.currency !== null &&
    input.currency !== "RUB"
  )
    throw new ExpertServiceOfferInvalidError("currency");

  let format: ExpertServiceFormat | null;
  if (input.format === null) format = null;
  else if (typeof input.format === "string" && isFormat(input.format))
    format = input.format;
  else throw new ExpertServiceOfferInvalidError("format");

  let location: string | null;
  if (input.location === null) location = null;
  else if (
    typeof input.location === "string" &&
    input.location === input.location.trim() &&
    input.location.length >= 1 &&
    input.location.length <= MAX_LOCATION &&
    !CONTROL.test(input.location)
  )
    location = input.location;
  else throw new ExpertServiceOfferInvalidError("location");

  if ((format === "offline" || format === "hybrid") && location === null)
    throw new ExpertServiceOfferInvalidError("location");

  return { priceMinor, currency: "RUB", format, location };
}

/** Omits nulls so existing public payloads keep their previous keys. */
export function projectExpertServiceOffer(input: {
  priceMinor?: unknown;
  currency?: unknown;
  format?: unknown;
  location?: unknown;
}): PublicExpertServiceOffer {
  const offer = parseExpertServiceOffer({
    priceMinor:
      input.priceMinor === undefined ? null : coerceMinor(input.priceMinor),
    currency: input.currency === undefined ? "RUB" : input.currency,
    format: input.format === undefined ? null : input.format,
    location: input.location === undefined ? null : input.location,
  });
  return {
    ...(offer.priceMinor === null
      ? {}
      : { priceMinor: offer.priceMinor, currency: "RUB" as const }),
    ...(offer.format === null ? {} : { format: offer.format }),
    ...(offer.location === null ? {} : { location: offer.location }),
  };
}

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
    offer.priceMinor <= MAX_MINOR &&
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
