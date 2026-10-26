import { expertPromoReadyLogs } from "./expert-offer-corrections.js";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  uniqueIndex,
  primaryKey,
  text,
  timestamp,
  uuid,
  unique,
} from "drizzle-orm/pg-core";
import { users, channelIdentities } from "./identity.js";
import { consentPresentations } from "./identity.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const owner = () =>
  uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" });
export const expertPromoCodes = pgTable(
  "expert_promo_codes",
  {
    userId: owner(),
    refCode: text("ref_code").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "expert_promo_code_namespace",
      sql`${t.refCode} ~ '^promo_[0-9a-f]{32}$'`,
    ),
  ],
);
export const expertPromoRegistrations = pgTable(
  "expert_promo_registrations",
  {
    userId: owner(),
    identityDigest: text("identity_digest").unique(),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    referrerUserId: uuid("referrer_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("expert_promo_registration_owner_unique").on(
      t.userId,
      t.referrerUserId,
    ),
    check(
      "expert_promo_identity_digest",
      sql`${t.identityDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "expert_promo_no_self",
      sql`${t.userId} IS DISTINCT FROM ${t.referrerUserId}`,
    ),
    index("expert_promo_referrer_idx").on(t.referrerUserId),
  ],
);
export const expertPromoRequests = pgTable(
  "expert_promo_requests",
  {
    botId: text("bot_id").notNull(),
    requestKey: text("request_key").notNull(),
    userId: uuid("user_id").references(() => users.id),
    requestDigest: text("request_digest"),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    operation: text("operation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.requestKey] }),
    check(
      "expert_promo_bot_id",
      sql.raw("bot_id ~ '^[1-9][0-9]{0,19}$'::text"),
    ),
    check(
      "expert_promo_request_digest",
      sql.raw("request_digest ~ '^[0-9a-f]{64}$'::text"),
    ),
    check(
      "expert_promo_request_key",
      sql.raw("length(request_key) >= 1 AND length(request_key) <= 200"),
    ),
    check(
      "expert_promo_request_erasure",
      sql.raw(
        "user_id IS NOT NULL AND request_digest IS NOT NULL AND erased_at IS NULL OR user_id IS NULL AND request_digest IS NULL AND erased_at IS NOT NULL",
      ),
    ),
    check(
      "expert_promo_request_operation",
      sql.raw(
        "operation = ANY (ARRAY['register'::text, 'application'::text, 'quote'::text, 'enroll'::text, 'consent'::text, 'tariffs'::text, 'profile'::text])",
      ),
    ),
  ],
);
export const expertPromoGuideWork = pgTable(
  "expert_promo_guide_work",
  {
    readyLogEventId: uuid("ready_log_event_id")
      .unique()
      .references(() => expertPromoReadyLogs.id),
    userId: owner(),
    status: text("status")
      .$type<"waiting_content" | "pending" | "delivered" | "cancelled">()
      .notNull()
      .default("waiting_content"),
    contentSlot: text("content_slot").notNull().default("TODO: Wait for PDF"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryReceipt: text("delivery_receipt"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "expert_promo_guide_status",
      sql`${t.status} IN ('waiting_content','pending','delivered','cancelled')`,
    ),
    check(
      "expert_promo_guide_delivery",
      sql`(${t.status}='delivered' AND ${t.deliveredAt} IS NOT NULL AND isfinite(${t.deliveredAt}) AND ${t.deliveryReceipt} IS NOT NULL AND length(${t.deliveryReceipt}) BETWEEN 1 AND 200) OR (${t.status}<>'delivered' AND ${t.deliveredAt} IS NULL AND ${t.deliveryReceipt} IS NULL)`,
    ),
  ],
);
export const expertPromoBonusIndications = pgTable(
  "expert_promo_bonus_indications",
  {
    userId: owner(),
    bonusPoints: integer("bonus_points").notNull().default(100),
    status: text("status").notNull().default("frozen"),
    policyVersion: text("policy_version")
      .notNull()
      .default("promo_advance_within_qualified_1000_v1"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "expert_promo_indication_nonfinancial",
      sql`${t.bonusPoints}=100 AND ${t.status}='frozen' AND ${t.policyVersion}='promo_advance_within_qualified_1000_v1'`,
    ),
  ],
);
export const expertPromoManagerWork = pgTable(
  "expert_promo_manager_work",
  {
    applicationId: uuid("application_id")
      .primaryKey()
      .references(() => expertOnboardingApplications.id, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    contentSlot: text("content_slot")
      .notNull()
      .default("TODO: Wait for Content Spec"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("expert_promo_manager_current_owner")
      .on(t.userId)
      .where(sql`${t.status}='pending'`),
    check(
      "expert_promo_manager_status",
      sql`${t.status} IN ('pending','completed','cancelled')`,
    ),
  ],
);
export const expertPromoEnrollments = pgTable(
  "expert_promo_enrollments",
  {
    userId: owner(),
    channelIdentityId: uuid("channel_identity_id")
      .notNull()
      .unique()
      .references(() => channelIdentities.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull(),
    refCode: text("ref_code"),
    presentationId: uuid("presentation_id").references(
      () => consentPresentations.id,
    ),
    policyVersion: text("policy_version"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now()+interval '24 hours')`),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "expert_promo_enrollment_status",
      sql`${t.status} IN ('pending','granted','denied')`,
    ),
    check(
      "expert_promo_enrollment_bot",
      sql`${t.botId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check(
      "expert_promo_enrollment_ref",
      sql`${t.refCode} IS NULL OR ${t.refCode} ~ '^promo_[0-9a-f]{32}$'`,
    ),
    check(
      "expert_promo_enrollment_expiry",
      sql`isfinite(${t.expiresAt}) AND ${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '24 hours'`,
    ),
  ],
);
