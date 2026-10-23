import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { adminSessions } from "./audit.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = () =>
  bigint("amount_minor", { mode: "bigint" })
    .notNull()
    .default(sql`300000`);
export const expertVerificationDecisions = pgTable(
  "expert_verification_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").references(
      () => expertOnboardingApplications.id,
      { onDelete: "set null" },
    ),
    applicationAuditId: uuid("application_audit_id").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    managerSessionHash: text("manager_session_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    reasonCode: text("reason_code").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("expert_verification_decision_binding").on(
      t.id,
      t.applicationAuditId,
      t.userId,
      t.decision,
    ),
    unique("expert_verification_decision_replay").on(
      t.managerId,
      t.idempotencyKey,
    ),
    check(
      "expert_verification_decision_status",
      sql`${t.decision} IN ('approved','rejected')`,
    ),
    check(
      "expert_verification_reason_code",
      sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "expert_verification_request_key",
      sql`${t.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check(
      "expert_verification_application_audit",
      sql`${t.applicationId} IS NULL OR ${t.applicationId}=${t.applicationAuditId}`,
    ),
  ],
);
export const expertOnboardingInvoices = pgTable(
  "expert_onboarding_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").references(
      () => expertOnboardingApplications.id,
      { onDelete: "set null" },
    ),
    applicationAuditId: uuid("application_audit_id").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    decisionId: uuid("decision_id").notNull().unique(),
    decision: text("decision").notNull().default("approved"),
    purpose: text("purpose").notNull().default("onboarding"),
    amountMinor: money(),
    currency: text("currency").notNull().default("RUB"),
    providerMode: text("provider_mode").$type<"test" | "live">().notNull(),
    status: text("status")
      .$type<"pending" | "settled" | "cancelled">()
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "expert_onboarding_invoice_decision_fk",
      columns: [t.decisionId, t.applicationAuditId, t.userId, t.decision],
      foreignColumns: [
        expertVerificationDecisions.id,
        expertVerificationDecisions.applicationAuditId,
        expertVerificationDecisions.userId,
        expertVerificationDecisions.decision,
      ],
    }),
    unique("expert_onboarding_invoice_binding").on(
      t.id,
      t.applicationAuditId,
      t.userId,
      t.purpose,
      t.amountMinor,
      t.currency,
      t.providerMode,
    ),
    check(
      "expert_onboarding_invoice_purpose",
      sql`${t.purpose}='onboarding' AND ${t.amountMinor}=300000 AND ${t.currency}='RUB' AND ${t.decision}='approved'`,
    ),
    check(
      "expert_onboarding_invoice_mode",
      sql`${t.providerMode} IN ('test','live')`,
    ),
    check(
      "expert_onboarding_invoice_status",
      sql`${t.status} IN ('pending','settled','cancelled')`,
    ),
    check(
      "expert_onboarding_invoice_audit",
      sql`${t.applicationId} IS NULL OR ${t.applicationId}=${t.applicationAuditId}`,
    ),
  ],
);
export const expertOnboardingPaymentOperations = pgTable(
  "expert_onboarding_payment_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id").notNull().unique(),
    applicationAuditId: uuid("application_audit_id").notNull(),
    userId: uuid("user_id").notNull(),
    purpose: text("purpose").notNull().default("onboarding"),
    amountMinor: money(),
    currency: text("currency").notNull().default("RUB"),
    providerMode: text("provider_mode").$type<"test" | "live">().notNull(),
    providerObjectId: text("provider_object_id").unique(),
    status: text("status")
      .$type<
        "created" | "pending" | "unknown_outcome" | "succeeded" | "cancelled"
      >()
      .notNull()
      .default("created"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "expert_onboarding_operation_invoice_fk",
      columns: [
        t.invoiceId,
        t.applicationAuditId,
        t.userId,
        t.purpose,
        t.amountMinor,
        t.currency,
        t.providerMode,
      ],
      foreignColumns: [
        expertOnboardingInvoices.id,
        expertOnboardingInvoices.applicationAuditId,
        expertOnboardingInvoices.userId,
        expertOnboardingInvoices.purpose,
        expertOnboardingInvoices.amountMinor,
        expertOnboardingInvoices.currency,
        expertOnboardingInvoices.providerMode,
      ],
    }),
    unique("expert_onboarding_operation_binding").on(
      t.id,
      t.invoiceId,
      t.userId,
      t.purpose,
      t.amountMinor,
      t.currency,
      t.providerMode,
      t.providerObjectId,
    ),
    check(
      "expert_onboarding_operation_purpose",
      sql`${t.purpose}='onboarding' AND ${t.amountMinor}=300000 AND ${t.currency}='RUB'`,
    ),
    check(
      "expert_onboarding_operation_mode",
      sql`${t.providerMode} IN ('test','live')`,
    ),
    check(
      "expert_onboarding_operation_status",
      sql`${t.status} IN ('created','pending','unknown_outcome','succeeded','cancelled')`,
    ),
    check(
      "expert_onboarding_operation_provider_id",
      sql`${t.providerObjectId} IS NULL OR ${t.providerObjectId} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
  ],
);
export const expertVerificationWork = pgTable(
  "expert_verification_work",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => expertOnboardingApplications.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<
        "onboarding_invoice" | "verification_rejected" | "interview_ready"
      >()
      .notNull(),
    reasonCode: text("reason_code"),
    contentSlot: text("content_slot")
      .notNull()
      .default("TODO: Wait for Content Spec"),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("expert_verification_work_once").on(t.applicationId, t.kind),
    check(
      "expert_verification_work_kind",
      sql`${t.kind} IN ('onboarding_invoice','verification_rejected','interview_ready')`,
    ),
    check(
      "expert_verification_work_reason",
      sql`${t.reasonCode} IS NULL OR ${t.reasonCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "expert_verification_work_status",
      sql`${t.status} IN ('pending','completed','cancelled')`,
    ),
  ],
);
export const expertOnboardingPaymentFacts = pgTable(
  "expert_onboarding_payment_facts",
  {
    invoiceId: uuid("invoice_id")
      .primaryKey()
      .references(() => expertOnboardingInvoices.id),
    operationId: uuid("operation_id").notNull().unique(),
    userId: uuid("user_id").notNull(),
    purpose: text("purpose").notNull().default("onboarding"),
    amountMinor: money(),
    currency: text("currency").notNull().default("RUB"),
    providerMode: text("provider_mode").notNull(),
    providerObjectId: text("provider_object_id").notNull().unique(),
    eventId: text("event_id").notNull().unique(),
    evidenceDigest: text("evidence_digest").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    admission: text("admission").$type<"interview" | "blocked">().notNull(),
    reasonCode: text("reason_code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "expert_onboarding_fact_operation_fk",
      columns: [
        t.operationId,
        t.invoiceId,
        t.userId,
        t.purpose,
        t.amountMinor,
        t.currency,
        t.providerMode,
        t.providerObjectId,
      ],
      foreignColumns: [
        expertOnboardingPaymentOperations.id,
        expertOnboardingPaymentOperations.invoiceId,
        expertOnboardingPaymentOperations.userId,
        expertOnboardingPaymentOperations.purpose,
        expertOnboardingPaymentOperations.amountMinor,
        expertOnboardingPaymentOperations.currency,
        expertOnboardingPaymentOperations.providerMode,
        expertOnboardingPaymentOperations.providerObjectId,
      ],
    }),
    check(
      "expert_onboarding_fact_binding",
      sql`${t.purpose}='onboarding' AND ${t.amountMinor}=300000 AND ${t.currency}='RUB' AND ${t.providerMode} IN ('test','live')`,
    ),
    check(
      "expert_onboarding_fact_evidence",
      sql`${t.evidenceDigest} ~ '^sha256:[0-9a-f]{64}$' AND length(${t.eventId}) BETWEEN 1 AND 200`,
    ),
    check(
      "expert_onboarding_fact_admission",
      sql`(${t.admission}='interview' AND ${t.reasonCode}='payment_verified') OR (${t.admission}='blocked' AND ${t.reasonCode} IN ('application_erased','owner_inactive','consent_unavailable','application_unavailable'))`,
    ),
    check(
      "expert_onboarding_fact_capture",
      sql`isfinite(${t.capturedAt}) AND ${t.capturedAt}>='1970-01-01'::timestamptz`,
    ),
  ],
);
