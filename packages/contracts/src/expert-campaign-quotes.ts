import { z } from "zod";

const identity = z.uuid().transform((value) => value.toLowerCase());
const idempotencyKey = z.string().refine(
  // Compare the entire match: JavaScript `$` alone permits a final newline.
  (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.exec(value)?.[0] === value,
  "Invalid idempotency key",
);

/** Identity, clock and financial authority come from server composition only. */
export const expertCampaignQuoteRequestSchema = z.strictObject({
  tariffVersionId: identity,
  termMonths: z.union([z.literal(1), z.literal(3)]),
  idempotencyKey,
});

/** Accept the saved quote; never calculate another price from checkout input. */
export const expertCampaignCheckoutRequestSchema = z.strictObject({
  quoteId: identity,
  idempotencyKey,
});

export const payerReceiptCheckoutRequestSchema = z.strictObject({
  quoteId: identity,
  receiptContactId: identity,
  idempotencyKey,
});
export const payerReceiptCaptureRequestSchema = z.strictObject({
  quoteId: identity,
  email: z.email().max(254),
  idempotencyKey,
});
export type PayerReceiptCheckoutRequest = z.infer<
  typeof payerReceiptCheckoutRequestSchema
>;
export type PayerReceiptCaptureRequest = z.infer<
  typeof payerReceiptCaptureRequestSchema
>;

export type ExpertCampaignQuoteRequest = z.infer<
  typeof expertCampaignQuoteRequestSchema
>;
export type ExpertCampaignCheckoutRequest = z.infer<
  typeof expertCampaignCheckoutRequestSchema
>;
