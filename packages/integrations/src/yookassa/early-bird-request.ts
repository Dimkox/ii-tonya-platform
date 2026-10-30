import { createHash } from "node:crypto";
import { z } from "zod";
import { serializeYooKassaPaymentRequest } from "./client.js";
import type { YooKassaVatCode } from "./contracts.js";

const date = z.iso.datetime({ offset: true });
const intent = z
  .object({
    invoiceId: z.uuid(),
    userId: z.uuid(),
    operationId: z.uuid(),
    idempotencyKey: z.uuidv4(),
    grantId: z.uuid(),
    pricingPolicy: z.literal("owner_test_10_20_v1"),
    priceKind: z.literal("fixed_test"),
    mode: z.literal("live"),
    onboardingMinor: z.literal("1000"),
    subscriptionMinor: z.literal("2000"),
    totalMinor: z.literal("3000"),
    baseOfferShownAt: date,
    expiresAt: date,
    launchAt: date,
  })
  .strict();
const fiscal = z
  .object({
    vatCode: z.number().int().min(1).max(12),
    paymentSubject: z.string().regex(/^[a-z_]{1,64}$/u),
    paymentMode: z.string().regex(/^[a-z_]{1,64}$/u),
  })
  .strict();
const inputSchema = z
  .object({
    intent,
    customer: z.object({ email: z.email().max(254) }).strict(),
    returnUrl: z.url().max(2048),
    onboardingFiscal: fiscal,
    subscriptionFiscal: fiscal,
  })
  .strict();

/** Pure serialization only. The caller must authorize and fence the first network send. */
export function buildEarlyBirdOwnerRequest(
  input: z.input<typeof inputSchema>,
): {
  readonly body: string;
  readonly digest: string;
  readonly idempotencyKey: string;
} {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("early_bird_request_invalid");
  const {
    intent: i,
    customer,
    returnUrl,
    onboardingFiscal,
    subscriptionFiscal,
  } = parsed.data;
  const url = new URL(returnUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(i.expiresAt) !==
      Date.parse(i.baseOfferShownAt) + 240 * 60 * 60 * 1000 ||
    Date.parse(i.launchAt) !== Date.parse("2027-01-11T00:00:00+03:00")
  )
    throw new Error("early_bird_request_invalid");
  return serializeComposite({
    idempotencyKey: i.idempotencyKey,
    invoiceId: i.invoiceId,
    userId: i.userId,
    operationId: i.operationId,
    pricingPolicy: i.pricingPolicy,
    priceKind: i.priceKind,
    grantId: i.grantId,
    onboardingMinor: 1000n,
    subscriptionMinor: 2000n,
    customer,
    returnUrl,
    onboardingFiscal,
    subscriptionFiscal,
  });
}

type Fiscal = z.output<typeof fiscal>;
function serializeComposite(input: {
  idempotencyKey: string;
  invoiceId: string;
  userId: string;
  operationId: string;
  pricingPolicy: string;
  priceKind: string;
  grantId?: string;
  onboardingMinor: bigint;
  subscriptionMinor: bigint;
  customer: { email: string };
  returnUrl: string;
  onboardingFiscal: Fiscal;
  subscriptionFiscal: Fiscal;
}) {
  const body = serializeYooKassaPaymentRequest({
    amountMinor: input.onboardingMinor + input.subscriptionMinor,
    idempotencyKey: input.idempotencyKey,
    description: "Онбординг и тариф резидента",
    returnUrl: input.returnUrl,
    metadata: {
      order_id: input.invoiceId,
      user_id: input.userId,
      operation_id: input.operationId,
      purpose: "combined_early_bird",
      pricing_policy: input.pricingPolicy,
      price_kind: input.priceKind,
      ...(input.grantId ? { pricing_grant_id: input.grantId } : {}),
    },
    receipt: {
      customer: input.customer,
      items: [
        {
          ...input.onboardingFiscal,
          vatCode: input.onboardingFiscal.vatCode as YooKassaVatCode,
          description: "Онбординг",
          amountMinor: input.onboardingMinor,
        },
        {
          ...input.subscriptionFiscal,
          vatCode: input.subscriptionFiscal.vatCode as YooKassaVatCode,
          description: "Тариф резидента",
          amountMinor: input.subscriptionMinor,
        },
      ],
    },
  });
  return Object.freeze({
    body,
    digest: `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`,
    idempotencyKey: input.idempotencyKey,
  });
}

const minor = z.string().regex(/^(0|[1-9]\d{0,11})$/u);
export const earlyBirdStandardIntentSchema = z
  .object({
    invoiceId: z.uuid(),
    userId: z.uuid(),
    operationId: z.uuid(),
    idempotencyKey: z.uuidv4(),
    pricingPolicy: z.literal("wave1_standard_v1"),
    ruleVersion: z.literal("expert_separated_sales_v3"),
    priceKind: z.enum(["discounted", "full_price"]),
    promotionEligible: z.boolean(),
    participantKind: z.enum(["expert", "space"]),
    mode: z.enum(["test", "live"]),
    baseMonthlyMinor: minor,
    onboardingMinor: z.literal("300000"),
    subscriptionMinor: minor,
    totalMinor: minor,
    baseOfferShownAt: date,
    quotedAt: date,
    expiresAt: date,
    launchAt: date,
  })
  .strict();
const standardInputSchema = inputSchema.extend({
  intent: earlyBirdStandardIntentSchema,
});
/** Validate snapshot consistency; the persisted DB/domain authority must establish the quote calculation. */
export function buildEarlyBirdStandardRequest(
  input: z.input<typeof standardInputSchema>,
) {
  const parsed = standardInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("early_bird_request_invalid");
  const {
    intent: i,
    customer,
    returnUrl,
    onboardingFiscal,
    subscriptionFiscal,
  } = parsed.data;
  const url = new URL(returnUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isEarlyBirdStandardSnapshotConsistent(i)
  )
    throw new Error("early_bird_request_invalid");
  const subscription = BigInt(i.subscriptionMinor);
  return serializeComposite({
    idempotencyKey: i.idempotencyKey,
    invoiceId: i.invoiceId,
    userId: i.userId,
    operationId: i.operationId,
    pricingPolicy: i.pricingPolicy,
    priceKind: i.priceKind,
    onboardingMinor: 300000n,
    subscriptionMinor: subscription,
    customer,
    returnUrl,
    onboardingFiscal,
    subscriptionFiscal,
  });
}

/** This checks arithmetic and chronology, not the DB-authoritative discount calculation. */
export function isEarlyBirdStandardSnapshotConsistent(
  i: Omit<z.output<typeof earlyBirdStandardIntentSchema>, "idempotencyKey">,
): boolean {
  const offer = Date.parse(i.baseOfferShownAt),
    quote = Date.parse(i.quotedAt),
    expiry = Date.parse(i.expiresAt),
    launch = Date.parse(i.launchAt);
  const base = BigInt(i.baseMonthlyMinor),
    subscription = BigInt(i.subscriptionMinor),
    total = BigInt(i.totalMinor);
  return (
    expiry === offer + 240 * 60 * 60 * 1000 &&
    launch === Date.parse("2027-01-11T00:00:00+03:00") &&
    quote >= offer &&
    quote < launch &&
    i.promotionEligible === quote < expiry &&
    base >= 500000n &&
    subscription >= 500000n &&
    subscription <= base &&
    total === subscription + 300000n &&
    i.priceKind === (subscription < base ? "discounted" : "full_price") &&
    (i.priceKind !== "discounted" || i.promotionEligible)
  );
}
