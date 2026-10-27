import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { experts } from "./catalog.js";
import { expertCampaignQuotes } from "./expert-campaign-quotes.js";
import { expertCardMainAcceptances } from "./expert-card-payments.js";
import {
  expertResidencyOrders,
  expertResidencyTariffVersions,
} from "./expert-residency.js";

const time = (name: string) => timestamp(name, { withTimezone: true });
const created = () => time("created_at").notNull().defaultNow();

// Canonical order intervals retain paid-time authority. Pausing changes only
// access/publication projections; it never extends or rewrites a settled period.
export const expertResidencyLifecycle = pgTable(
  "expert_residency_lifecycle",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id")
      .notNull()
      .unique()
      .references(() => experts.id),
    status: text("status")
      .$type<"active" | "paused" | "payment_required">()
      .notNull()
      .default("active"),
    pausedUntil: date("paused_until"),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "expert_residency_lifecycle_owner_fk",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    check(
      "expert_residency_lifecycle_status_check",
      sql`${t.status} IN ('active','paused','payment_required')`,
    ),
    check(
      "expert_residency_lifecycle_pause",
      sql`coalesce((${t.status}='paused' AND ${t.pausedUntil} IS NOT NULL AND isfinite(${t.pausedUntil})) OR (${t.status}<>'paused' AND ${t.pausedUntil} IS NULL),false)`,
    ),
  ],
);

export const expertResidencyRenewalBills = pgTable(
  "expert_residency_renewal_bills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ownerAuditId: uuid("owner_audit_id").notNull(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    cycleEnd: time("cycle_end").notNull(),
    sourceOrderId: uuid("source_order_id")
      .notNull()
      .references(() => expertResidencyOrders.id),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => expertResidencyTariffVersions.id),
    termMonths: integer("term_months").$type<1 | 3>().notNull(),
    quoteId: uuid("quote_id").references(() => expertCampaignQuotes.id),
    acceptanceId: uuid("acceptance_id").references(
      () => expertCardMainAcceptances.id,
    ),
    orderId: uuid("order_id").references(() => expertResidencyOrders.id),
    createdAt: created(),
  },
  (t) => [
    unique("expert_residency_renewal_cycle_unique").on(t.expertId, t.cycleEnd),
    check(
      "expert_residency_renewal_bills_cycle_end_check",
      sql`isfinite(${t.cycleEnd})`,
    ),
    check(
      "expert_residency_renewal_bills_term_months_check",
      sql`${t.termMonths} IN (1,3)`,
    ),
  ],
);

export const expertResidencyLifecycleAudits = pgTable(
  "expert_residency_lifecycle_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    action: text("action")
      .$type<"pause" | "resume" | "automatic_return" | "suspend" | "restore">()
      .notNull(),
    cycleEnd: time("cycle_end"),
    returnDate: date("return_date"),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_residency_lifecycle_audit_owner",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    check(
      "expert_residency_lifecycle_audit_pause",
      sql`(${t.action}='pause')=(${t.returnDate} IS NOT NULL)`,
    ),
    check(
      "expert_residency_lifecycle_audits_action_check",
      sql`${t.action} IN ('pause','resume','automatic_return','suspend','restore')`,
    ),
    check(
      "expert_residency_lifecycle_audits_cycle_end_check",
      sql`${t.cycleEnd} IS NULL OR isfinite(${t.cycleEnd})`,
    ),
    check(
      "expert_residency_lifecycle_audits_return_date_check",
      sql`${t.returnDate} IS NULL OR isfinite(${t.returnDate})`,
    ),
  ],
);

export const expertResidencyLifecycleNotices = pgTable(
  "expert_residency_lifecycle_notices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id),
    cycleEnd: time("cycle_end").notNull(),
    stage: text("stage")
      .$type<"seven_days" | "one_day" | "overdue" | "archive_offer">()
      .notNull(),
    status: text("status")
      .$type<
        | "waiting_content"
        | "pending"
        | "unknown_outcome"
        | "delivered"
        | "cancelled"
      >()
      .notNull()
      .default("waiting_content"),
    targetBotId: text("target_bot_id"),
    targetChatId: text("target_chat_id"),
    templateVersion: text("template_version"),
    payloadDigest: text("payload_digest"),
    attemptId: uuid("attempt_id"),
    attemptedAt: time("attempted_at"),
    receipt: jsonb("receipt"),
    deliveredAt: time("delivered_at"),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_residency_notice_owner",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    unique("expert_residency_notice_unique").on(
      t.expertId,
      t.cycleEnd,
      t.stage,
    ),
    index("expert_residency_notice_due")
      .on(t.status, t.createdAt)
      .where(sql`${t.attemptId} IS NULL`),
    check(
      "expert_residency_lifecycle_notices_cycle_end_check",
      sql`isfinite(${t.cycleEnd})`,
    ),
    check(
      "expert_residency_lifecycle_notices_stage_check",
      sql`${t.stage} IN ('seven_days','one_day','overdue','archive_offer')`,
    ),
    check(
      "expert_residency_lifecycle_notices_status_check",
      sql`${t.status} IN ('waiting_content','pending','unknown_outcome','delivered','cancelled')`,
    ),
    check(
      "expert_residency_notice_content",
      sql`coalesce((${t.templateVersion} IS NULL AND ${t.payloadDigest} IS NULL) OR (${t.templateVersion} IS NOT NULL AND ${t.templateVersion}=('lifecycle.'||${t.stage}||'.v1') AND ${t.payloadDigest} IS NOT NULL AND ${t.payloadDigest} ~ '^sha256:[0-9a-f]{64}$'),false)`,
    ),
    check(
      "expert_residency_notice_attempt",
      sql`coalesce((${t.attemptId} IS NULL)=(${t.attemptedAt} IS NULL) AND (${t.attemptedAt} IS NULL OR isfinite(${t.attemptedAt})),false)`,
    ),
    check(
      "expert_residency_notice_receipt",
      sql`coalesce((${t.status}='delivered' AND ${t.attemptId} IS NOT NULL AND ${t.templateVersion} IS NOT NULL AND ${t.receipt} IS NOT NULL AND ${t.deliveredAt} IS NOT NULL AND isfinite(${t.deliveredAt}) AND expert_card_delivery_receipt_valid(${t.receipt},${t.targetBotId},${t.targetChatId},${t.templateVersion},${t.payloadDigest},1) AND ${t.receipt}->>'contentVersion'=${t.templateVersion} AND ${t.receipt}->>'payloadDigest'=${t.payloadDigest}) OR (${t.status}<>'delivered' AND ${t.receipt} IS NULL AND ${t.deliveredAt} IS NULL),false)`,
    ),
  ],
);

// Immutable attempt history preserves old order/quote identity across explicit
// expired-order recovery. SQL triggers enforce sequence and source ownership.
export const expertResidencyRenewalAttempts = pgTable(
  "expert_residency_renewal_attempts",
  {
    billId: uuid("bill_id")
      .notNull()
      .references(() => expertResidencyRenewalBills.id),
    sequence: integer("sequence").notNull(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => expertCampaignQuotes.id),
    acceptanceId: uuid("acceptance_id")
      .notNull()
      .references(() => expertCardMainAcceptances.id),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => expertResidencyOrders.id),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.sequence] }),
    check(
      "expert_residency_renewal_attempts_sequence_check",
      sql`${t.sequence}>0`,
    ),
  ],
);
