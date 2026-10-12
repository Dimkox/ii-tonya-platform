import { expect, it } from "vitest";
import {
  expertCampaignQuoteRequestSchema,
  expertCampaignCheckoutRequestSchema,
} from "./expert-campaign-quotes.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key = "campaign:quote-001";
const quote = { tariffVersionId: id, termMonths: 1, idempotencyKey: key };
const checkout = { quoteId: id, idempotencyKey: key };

it("requires term and key independently on otherwise valid requests", () => {
  expect(
    expertCampaignQuoteRequestSchema.safeParse({
      tariffVersionId: id,
      idempotencyKey: key,
    }).success,
  ).toBe(false);
  expect(
    expertCampaignQuoteRequestSchema.safeParse({
      tariffVersionId: id,
      termMonths: 1,
    }).success,
  ).toBe(false);
  expect(
    expertCampaignCheckoutRequestSchema.safeParse({ quoteId: id }).success,
  ).toBe(false);
});

it.each([1, 3])(
  "accepts a %s-month quote selection with no client price",
  (termMonths) => {
    const value = { ...quote, termMonths };
    expect(expertCampaignQuoteRequestSchema.parse(value)).toEqual(value);
  },
);

it("accepts checkout by quote identity only", () => {
  expect(expertCampaignCheckoutRequestSchema.parse(checkout)).toEqual(checkout);
});

it("canonicalizes UUIDs without rewriting idempotency keys", () => {
  expect(
    expertCampaignQuoteRequestSchema.parse({
      ...quote,
      tariffVersionId: id.toUpperCase(),
      idempotencyKey: "Campaign:KEY-001",
    }),
  ).toEqual({ ...quote, idempotencyKey: "Campaign:KEY-001" });
  expect(
    expertCampaignCheckoutRequestSchema.parse({
      ...checkout,
      quoteId: id.toUpperCase(),
    }),
  ).toEqual(checkout);
});

it.each([
  "userId",
  "expertId",
  "priceMinor",
  "cashMinor",
  "creditMinor",
  "baseMonthlyMinor",
  "calculationTimestampMs",
  "quotedAtMs",
  "expiresAt",
  "energyDiscountBps",
  "startDiscountBps",
  "commercialPolicyVersion",
])("rejects caller-controlled authority field %s", (field) => {
  expect(
    expertCampaignQuoteRequestSchema.safeParse({ ...quote, [field]: "forged" })
      .success,
  ).toBe(false);
  expect(
    expertCampaignCheckoutRequestSchema.safeParse({
      ...checkout,
      [field]: "forged",
    }).success,
  ).toBe(false);
});

it.each([0, 2, 4, "1", "3", null, true, 1.5])(
  "rejects wrong term %# without coercion",
  (termMonths) => {
    expect(
      expertCampaignQuoteRequestSchema.safeParse({ ...quote, termMonths })
        .success,
    ).toBe(false);
  },
);

it("does not accept a fresh tariff or term at quote-bound checkout", () => {
  expect(
    expertCampaignCheckoutRequestSchema.safeParse({
      ...checkout,
      tariffVersionId: id,
    }).success,
  ).toBe(false);
  expect(
    expertCampaignCheckoutRequestSchema.safeParse({
      ...checkout,
      termMonths: 3,
    }).success,
  ).toBe(false);
});

it.each([
  "",
  "short",
  " leading-001",
  "trailing-001 ",
  "newline\n001",
  "abcdefgh\n",
  "abcdefgh\r\n",
  "abcdefgh\u0000",
  "a".repeat(129),
  123,
  null,
])("rejects invalid idempotency key %#", (idempotencyKey) => {
  expect(
    expertCampaignQuoteRequestSchema.safeParse({ ...quote, idempotencyKey })
      .success,
  ).toBe(false);
  expect(
    expertCampaignCheckoutRequestSchema.safeParse({
      ...checkout,
      idempotencyKey,
    }).success,
  ).toBe(false);
});

it.each(["abcdefgh", "a".repeat(128)])(
  "accepts boundary-length idempotency key %#",
  (idempotencyKey) => {
    expect(
      expertCampaignQuoteRequestSchema.safeParse({ ...quote, idempotencyKey })
        .success,
    ).toBe(true);
    expect(
      expertCampaignCheckoutRequestSchema.safeParse({
        ...checkout,
        idempotencyKey,
      }).success,
    ).toBe(true);
  },
);

it.each([null, [], {}, "", 42])(
  "rejects malformed or incomplete request %#",
  (value) => {
    expect(expertCampaignQuoteRequestSchema.safeParse(value).success).toBe(
      false,
    );
    expect(expertCampaignCheckoutRequestSchema.safeParse(value).success).toBe(
      false,
    );
  },
);

it.each(["not-a-uuid", 42, null, undefined])(
  "rejects invalid or missing identity %#",
  (value) => {
    expect(
      expertCampaignQuoteRequestSchema.safeParse({
        ...quote,
        tariffVersionId: value,
      }).success,
    ).toBe(false);
    expect(
      expertCampaignCheckoutRequestSchema.safeParse({
        ...checkout,
        quoteId: value,
      }).success,
    ).toBe(false);
  },
);
