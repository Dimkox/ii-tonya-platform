import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  customType,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertOnboardingInvoices } from "./expert-verification.js";
import { expertResidencyOrders } from "./expert-residency.js";
import { payerReceiptContacts } from "./payer-receipt-contacts.js";
const instant = (name: string) => timestamp(name, { withTimezone: true });
const xid8 = customType<{ data: string }>({ dataType: () => "xid8" });
const pgName = customType<{ data: string }>({ dataType: () => "name" });
/** SQL owns polymorphic source guards, state transitions, exact checks and capability ACLs. */
export const publicExpertPaymentRequests = pgTable(
  "public_expert_payment_requests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    product: text("product").notNull(),
    kind: text("kind").notNull(),
    legacySourceId: uuid("legacy_source_id").notNull(),
    legacyOperationId: uuid("legacy_operation_id").notNull(),
    invoiceId: uuid("invoice_id").references(() => expertOnboardingInvoices.id),
    orderId: uuid("order_id").references(() => expertResidencyOrders.id),
    parentPaymentId: text("parent_payment_id"),
    mode: text("mode").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    contactId: uuid("contact_id").references(() => payerReceiptContacts.id),
    requestDigest: text("request_digest").notNull(),
    snapshotVersion: integer("snapshot_version").notNull().default(1),
    snapshot: jsonb("snapshot").notNull(),
    encryptedBody: text("encrypted_body"),
    keyReference: text("key_reference"),
    bodyExpiresAt: instant("body_expires_at"),
    paymentDeadline: instant("payment_deadline").notNull(),
    providerDeadline: instant("provider_deadline").notNull(),
    state: text("state").notNull().default("prepared"),
    admittedAt: instant("admitted_at"),
    dispatchedAt: instant("dispatched_at"),
    providerObjectId: text("provider_object_id"),
    createdAt: instant("created_at")
      .notNull()
      .default(sql`early_bird_current_time()`),
    applyAttemptId: uuid("apply_attempt_id"),
    applyObservationId: uuid("apply_observation_id"),
    applyAction: text("apply_action"),
    applyXid: xid8("apply_xid"),
    applyLogin: pgName("apply_login"),
    applyExpectedStart: instant("apply_expected_start"),
    applyExpectedEnd: instant("apply_expected_end"),
  },
  (t) => [unique().on(t.legacyOperationId, t.kind)],
);
export const publicExpertPaymentObservations = pgTable(
  "public_expert_payment_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => publicExpertPaymentRequests.id),
    providerObjectId: text("provider_object_id").notNull(),
    parentPaymentId: text("parent_payment_id"),
    status: text("status").notNull(),
    paid: boolean("paid"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    mode: text("mode").notNull(),
    providerCreatedAt: instant("provider_created_at").notNull(),
    providerCapturedAt: instant("provider_captured_at"),
    paymentMethodType: text("payment_method_type"),
    identity: jsonb("identity").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: instant("observed_at").notNull(),
    fact: jsonb("fact").notNull(),
  },
  (t) => [unique().on(t.requestId, t.evidenceDigest)],
);
export const publicExpertPaymentResolutions = pgTable(
  "public_expert_payment_resolutions",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => publicExpertPaymentRequests.id),
    kind: text("kind").notNull(),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => publicExpertPaymentObservations.id),
    applyAttemptId: uuid("apply_attempt_id").notNull(),
    action: text("action").notNull(),
    legacyFactId: text("legacy_fact_id"),
    providerObjectId: text("provider_object_id").notNull(),
    capturedAt: instant("captured_at"),
    paymentDeadline: instant("payment_deadline").notNull(),
    disposition: text("disposition").notNull(),
    reason: text("reason").notNull(),
    createdAt: instant("created_at")
      .notNull()
      .default(sql`early_bird_current_time()`),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.kind] })],
);
