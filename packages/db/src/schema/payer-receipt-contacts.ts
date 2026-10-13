import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { expertCampaignQuotes } from "./expert-campaign-quotes.js";
import { expertResidencyOrders } from "./expert-residency.js";

// SQL migration owns validation/redaction triggers and matching composite FKs.
export const payerReceiptContacts = pgTable(
  "payer_receipt_contacts",
  {
    id: uuid("id").primaryKey(),
    quoteId: uuid("quote_id").notNull(),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    basis: text("basis").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    keyId: text("key_id"),
    ciphertext: text("ciphertext"),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    unique("payer_receipt_identity_unique").on(t.id, t.quoteId, t.userId),
    unique("payer_receipt_user_key_unique").on(t.userId, t.idempotencyKey),
    foreignKey({
      name: "payer_receipt_quote_owner_fk",
      columns: [t.quoteId, t.userId],
      foreignColumns: [expertCampaignQuotes.id, expertCampaignQuotes.userId],
    }),
  ],
);
export const payerReceiptOrderBindings = pgTable(
  "payer_receipt_order_bindings",
  {
    orderId: uuid("order_id").primaryKey(),
    contactId: uuid("contact_id").notNull().unique(),
    quoteId: uuid("quote_id").notNull(),
    userId: uuid("user_id").notNull(),
  },
  (t) => [
    foreignKey({
      name: "payer_receipt_binding_order_fk",
      columns: [t.orderId, t.quoteId],
      foreignColumns: [
        expertResidencyOrders.id,
        expertResidencyOrders.campaignQuoteId,
      ],
    }),
    foreignKey({
      name: "payer_receipt_binding_contact_fk",
      columns: [t.contactId, t.quoteId, t.userId],
      foreignColumns: [
        payerReceiptContacts.id,
        payerReceiptContacts.quoteId,
        payerReceiptContacts.userId,
      ],
    }),
  ],
);
