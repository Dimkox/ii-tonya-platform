const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const DAY_MILLISECONDS = 86_400_000;

export type ClientPaidPackageCode = "start" | "base" | "deep" | "maximum";

export interface ClientPaidPackage {
  readonly code: ClientPaidPackageCode;
  readonly policyVersion: "client_paid_v1";
  readonly currency: "RUB";
  readonly units: number;
  readonly priceMinor: bigint;
  readonly couponGrantMinor: bigint;
}

export interface ClientPaidGrantTerms extends ClientPaidPackage {
  readonly packageExpiresAt: Date;
  readonly couponExpiresAt: Date;
}

export interface ClientServiceQuote {
  readonly couponMinor: bigint;
  readonly cashMinor: bigint;
}

/** New paid purchases only; never reinterpret historical or administrative grants. */
export function getClientPaidPackage(code: string): ClientPaidPackage {
  let units: number;
  let priceMinor: bigint;
  switch (code) {
    case "start":
      units = 500;
      priceMinor = 499900n;
      break;
    case "base":
      units = 1000;
      priceMinor = 599900n;
      break;
    case "deep":
      units = 1500;
      priceMinor = 799900n;
      break;
    case "maximum":
      units = 2000;
      priceMinor = 1099000n;
      break;
    default:
      throw new Error("invalid_client_paid_package");
  }
  return Object.freeze({
    code,
    policyVersion: "client_paid_v1",
    currency: "RUB",
    units,
    priceMinor,
    couponGrantMinor: priceMinor * 2n,
  });
}

/** Callers must verify successful provider payment and persist grants atomically/idempotently. */
export function clientPaidGrantTerms(
  code: string,
  paidAt: Date,
): ClientPaidGrantTerms {
  const terms = getClientPaidPackage(code);
  if (!(paidAt instanceof Date) || !Number.isFinite(paidAt.getTime())) {
    throw new Error("invalid_date");
  }
  // Fixed GMT+3 has no DST: calendar days preserve the local clock and milliseconds.
  const packageExpiresAt = new Date(paidAt.getTime() + 60 * DAY_MILLISECONDS);
  const couponExpiresAt = new Date(paidAt.getTime() + 45 * DAY_MILLISECONDS);
  if (
    !Number.isFinite(packageExpiresAt.getTime()) ||
    !Number.isFinite(couponExpiresAt.getTime())
  ) {
    throw new Error("invalid_date");
  }
  return { ...terms, packageExpiresAt, couponExpiresAt };
}

function assertMinor(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    throw new Error("invalid_money");
  }
}

/** Client coupons only; the fixed 20% service cap is separate from package grants. */
export function quoteClientService(
  priceMinor: bigint,
  availableCouponMinor: bigint,
): ClientServiceQuote {
  assertMinor(priceMinor);
  assertMinor(availableCouponMinor);
  if (priceMinor === 0n) throw new Error("invalid_money");
  const ceiling = priceMinor / 5n;
  const couponMinor =
    availableCouponMinor < ceiling ? availableCouponMinor : ceiling;
  return { couponMinor, cashMinor: priceMinor - couponMinor };
}
