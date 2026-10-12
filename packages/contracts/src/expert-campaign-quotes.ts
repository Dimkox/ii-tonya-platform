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

export type ExpertCampaignQuoteRequest = z.infer<
  typeof expertCampaignQuoteRequestSchema
>;
export type ExpertCampaignCheckoutRequest = z.infer<
  typeof expertCampaignCheckoutRequestSchema
>;
