import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { expertResidencyTariffVersions } from "./expert-residency.js";
import {
  expertOnboardingInvoices,
  expertOnboardingPaymentFacts,
} from "./expert-verification.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
import { payerReceiptContacts } from "./payer-receipt-contacts.js";
const instant = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: "bigint" });
const id = () => uuid("id").primaryKey().defaultRandom();
const created = () =>
  instant("created_at")
    .notNull()
    .default(sql`clock_timestamp()`);
// Composite ownership constraints, state/arithmetic guards, append-only and
// erasure triggers are hand-authored in 0059 and retained in its SQL catalogue.
export const expertSalesBases = pgTable(
  "expert_sales_bases",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => expertResidencyTariffVersions.id),
    profileRevision: integer("profile_revision").notNull(),
    baseTariffAmount: money("base_tariff_amount").notNull(),
    baseOfferShownAt: instant("base_offer_shown_at")
      .notNull()
      .default(sql`date_trunc('milliseconds',clock_timestamp())`),
    participantKind: text("participant_kind")
      .$type<"expert" | "space">()
      .notNull(),
    policyVersion: text("policy_version")
      .notNull()
      .default("expert_separated_sales_v3"),
    botId: text("bot_id"),
    botKey: text("bot_key"),
    chatId: text("chat_id"),
    consentVersion: text("consent_version"),
  },
  (t) => [unique().on(t.id, t.userId)],
);
export const expertSalesChoices = pgTable(
  "expert_sales_choices",
  {
    id: id(),
    baseId: uuid("base_id").notNull(),
    userId: uuid("user_id").notNull(),
    revision: integer("revision").notNull(),
    action: text("action")
      .$type<"positive" | "promo" | "base" | "month" | "quarter">()
      .notNull(),
    chosenAt: instant("chosen_at")
      .notNull()
      .default(sql`date_trunc('milliseconds',clock_timestamp())`),
    requestKey: text("request_key"),
    requestDigest: text("request_digest"),
  },
  (t) => [
    unique().on(t.baseId, t.revision),
    unique().on(t.baseId, t.requestKey),
    unique().on(t.id, t.userId),
  ],
);
export const expertSalesSelections = pgTable(
  "expert_sales_selections",
  {
    id: id(),
    baseId: uuid("base_id").notNull(),
    userId: uuid("user_id").notNull(),
    choiceId: uuid("choice_id").notNull(),
    promoAcceptedFlag: boolean("promo_accepted_flag").notNull(),
    termMonths: integer("term_months").$type<1 | 3>().notNull(),
    monthlyPriceMinor: money("monthly_price_minor").notNull(),
    packagePriceMinor: money("package_price_minor"),
    selectedTotalMinor: money("selected_total_minor").notNull(),
    energyDiscountBps: integer("energy_discount_bps").notNull(),
    packageDiscountBps: integer("package_discount_bps").notNull(),
    selectedAt: instant("selected_at")
      .notNull()
      .default(sql`date_trunc('milliseconds',clock_timestamp())`),
    offerExpiryDate: instant("offer_expiry_date").notNull(),
  },
  (t) => [unique().on(t.id, t.userId)],
);
export const expertSalesFormBridges = pgTable("expert_sales_form_bridges", {
  applicationId: uuid("application_id")
    .primaryKey()
    .references(() => expertOnboardingApplications.id, { onDelete: "cascade" }),
  formId: uuid("form_id").notNull().unique(),
  userId: uuid("user_id").notNull(),
  submittedRevision: integer("submitted_revision").notNull(),
  selectionId: uuid("selection_id").notNull(),
  quoteId: uuid("quote_id").notNull(),
});
export const expertSalesFeeAttempts = pgTable("expert_sales_fee_attempts", {
  invoiceId: uuid("invoice_id")
    .primaryKey()
    .references(() => expertOnboardingInvoices.id),
  userId: uuid("user_id").notNull(),
  selectionId: uuid("selection_id").notNull(),
  policyVersion: text("policy_version")
    .notNull()
    .default("expert_separated_sales_v3"),
  expiresAt: instant("expires_at").notNull(),
  createdAt: created(),
});
export const expertSalesPaidLocks = pgTable("expert_sales_paid_locks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .unique()
    .references(() => expertOnboardingPaymentFacts.invoiceId),
  selectionId: uuid("selection_id").notNull(),
  finalLockedPrice: money("final_locked_price").notNull(),
  termMonths: integer("term_months").$type<1 | 3>().notNull(),
  lockedAt: instant("locked_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});
export const expertSalesRecoveryWork = pgTable("expert_sales_recovery_work", {
  invoiceId: uuid("invoice_id")
    .primaryKey()
    .references(() => expertOnboardingPaymentFacts.invoiceId),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("refund_review"),
  createdAt: created(),
});
export const expertSalesProviderRequests = pgTable(
  "expert_sales_provider_requests",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => expertSalesFeeAttempts.invoiceId),
    kind: text("kind").$type<"create" | "capture" | "cancel">().notNull(),
    idempotencyKey: uuid("idempotency_key").notNull().unique(),
    requestBody: text("request_body"),
    encryptedBody: text("encrypted_body"),
    keyReference: text("key_reference"),
    requestDigest: text("request_digest").notNull(),
    bodyExpiresAt: instant("body_expires_at"),
    contactId: uuid("contact_id").references(() => payerReceiptContacts.id),
    status: text("status").notNull().default("prepared"),
    providerObjectId: text("provider_object_id"),
    createdAt: created(),
    dispatchedAt: instant("dispatched_at"),
  },
  (t) => [unique().on(t.invoiceId, t.kind)],
);
export const expertSalesProviderObservations = pgTable(
  "expert_sales_provider_observations",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => expertSalesFeeAttempts.invoiceId),
    providerObjectId: text("provider_object_id").notNull(),
    status: text("status").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    observedAt: instant("observed_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [unique().on(t.invoiceId, t.evidenceDigest)],
);
export const expertSalesNotices = pgTable(
  "expert_sales_notices",
  {
    id: id(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => expertSalesBases.id),
    stageAt: instant("stage_at").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptId: uuid("attempt_id"),
    receipt: jsonb("receipt"),
    createdAt: created(),
  },
  (t) => [unique().on(t.baseId, t.stageAt, t.kind)],
);
export const expertSalesErasedCohorts = pgTable("expert_sales_erased_cohorts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  erasedAt: instant("erased_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});
export const expertSalesTicks = pgTable("expert_sales_ticks", {
  baseId: uuid("base_id")
    .primaryKey()
    .references(() => expertSalesBases.id),
  checkedAt: instant("checked_at")
    .notNull()
    .default(sql`'-infinity'::timestamptz`),
});
