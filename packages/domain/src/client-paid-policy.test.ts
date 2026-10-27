import { describe, expect, it } from "vitest";
import {
  clientPaidGrantTerms,
  getClientPaidPackage,
  quoteClientService,
} from "./client-paid-policy.js";

const MAX = 9_223_372_036_854_775_807n;
const DAY = 86_400_000;

describe("client paid package policy", () => {
  it.each([
    ["start", 500, 499900n],
    ["base", 1000, 599900n],
    ["deep", 1500, 799900n],
    ["maximum", 2000, 1099000n],
  ] as const)("defines immutable %s terms", (code, units, priceMinor) => {
    const terms = getClientPaidPackage(code);
    expect(terms).toEqual({
      code,
      policyVersion: "client_paid_v1",
      currency: "RUB",
      units,
      priceMinor,
      couponGrantMinor: priceMinor * 2n,
    });
    expect(Object.isFrozen(terms)).toBe(true);
    expect(Reflect.set(terms, "priceMinor", 1n)).toBe(false);
    expect(getClientPaidPackage(code)).toEqual(terms);
  });

  it.each([
    "intro",
    "unknown",
    "__proto__",
    "constructor",
    "toString",
    "START",
    "",
    null,
    undefined,
    1,
    1n,
    {},
    [],
    Symbol("start"),
  ])("rejects invalid SKU %# with a fixed error", (code) => {
    expect(() => getClientPaidPackage(code as string)).toThrow(
      /^invalid_client_paid_package$/,
    );
    expect(() => clientPaidGrantTerms(code as string, new Date(0))).toThrow(
      /^invalid_client_paid_package$/,
    );
  });

  it.each([
    [
      "2024-02-29T15:16:17.123+03:00",
      "2024-04-29T15:16:17.123+03:00",
      "2024-04-14T15:16:17.123+03:00",
    ],
    [
      "2026-12-15T23:59:58.999+03:00",
      "2027-02-13T23:59:58.999+03:00",
      "2027-01-29T23:59:58.999+03:00",
    ],
  ])("anchors expiry to payment %s", (iso, packageEnd, couponEnd) => {
    const paidAt = new Date(iso);
    const original = paidAt.getTime();
    const grant = clientPaidGrantTerms("start", paidAt);
    expect(grant).toEqual({
      ...getClientPaidPackage("start"),
      packageExpiresAt: new Date(packageEnd),
      couponExpiresAt: new Date(couponEnd),
    });
    expect(grant.packageExpiresAt.getTime() - original).toBe(60 * DAY);
    expect(grant.couponExpiresAt.getTime() - original).toBe(45 * DAY);
    expect(paidAt.getTime()).toBe(original);
    const repeated = clientPaidGrantTerms("start", new Date(original));
    expect(repeated).toEqual(grant);
    expect(repeated.packageExpiresAt).not.toBe(grant.packageExpiresAt);
    expect(repeated.couponExpiresAt).not.toBe(grant.couponExpiresAt);
    grant.packageExpiresAt.setTime(0);
    grant.couponExpiresAt.setTime(1);
    expect(clientPaidGrantTerms("start", paidAt)).toEqual(repeated);
    expect(paidAt.getTime()).toBe(original);
  });

  it.each([
    new Date(NaN),
    new Date(8_640_000_000_000_000),
    new Date(8_640_000_000_000_000 - 59 * DAY),
    null,
    undefined,
    0,
    "2026-10-10",
    {},
  ])("rejects invalid or overflowing payment date %#", (paidAt) => {
    expect(() => clientPaidGrantTerms("start", paidAt as Date)).toThrow(
      /^invalid_date$/,
    );
  });

  it("accepts date boundaries whose calculated expiries remain valid", () => {
    for (const time of [
      -8_640_000_000_000_000,
      8_640_000_000_000_000 - 60 * DAY,
    ]) {
      const grant = clientPaidGrantTerms("base", new Date(time));
      expect(grant.packageExpiresAt.getTime()).toBe(time + 60 * DAY);
      expect(grant.couponExpiresAt.getTime()).toBe(time + 45 * DAY);
    }
  });
});

describe("client service coupon quote", () => {
  it.each([
    [499900n, 999800n, 99980n, 399920n],
    [101n, 999n, 20n, 81n],
    [101n, 0n, 0n, 101n],
    [101n, 7n, 7n, 94n],
    [1n, MAX, 0n, 1n],
    [MAX, MAX, MAX / 5n, MAX - MAX / 5n],
  ])(
    "quotes price %s and balance %s",
    (price, balance, couponMinor, cashMinor) => {
      expect(quoteClientService(price, balance)).toEqual({
        couponMinor,
        cashMinor,
      });
    },
  );

  it("preserves price and bounds at rounding and bigint boundaries", () => {
    for (const price of [1n, 4n, 5n, 6n, 99n, 100n, 101n, MAX - 1n, MAX]) {
      for (const balance of [0n, 1n, price / 5n, price, MAX]) {
        const quote = quoteClientService(price, balance);
        expect(quote.cashMinor + quote.couponMinor).toBe(price);
        expect(quote.couponMinor).toBeLessThanOrEqual(price / 5n);
        expect(quote.couponMinor).toBeLessThanOrEqual(balance);
        expect(quote.couponMinor).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it.each([0n, -1n, MAX + 1n, 1, "100", null, undefined, {}, NaN])(
    "rejects invalid price %#",
    (price) => {
      expect(() => quoteClientService(price as bigint, 0n)).toThrow(
        /^invalid_money$/,
      );
    },
  );
  it.each([-1n, MAX + 1n, 0, "0", null, undefined, {}, NaN])(
    "rejects invalid coupon balance %#",
    (balance) => {
      expect(() => quoteClientService(100n, balance as bigint)).toThrow(
        /^invalid_money$/,
      );
    },
  );
});
