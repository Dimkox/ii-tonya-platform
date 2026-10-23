import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { experts } from "./catalog.js";
import { expertCampaignQuotes } from "./expert-campaign-quotes.js";
import { expertOnboardingApplications } from "./expert-onboarding.js";
import {
  expertResidencyOrders,
  expertResidencyProviderEventInbox,
} from "./expert-residency.js";
import { expertPromoRegistrations } from "./expert-promo.js";
import { expertCardDrafts, expertCardReviews } from "./expert-cards.js";
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const expertCardMainAcceptances = pgTable(
  "expert_card_main_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").references(
      () => expertOnboardingApplications.id,
      { onDelete: "set null" },
    ),
    applicationAuditId: uuid("application_audit_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expertId: uuid("expert_id").notNull(),
    reviewId: uuid("review_id").references(() => expertCardReviews.id, {
      onDelete: "set null",
    }),
    reviewAuditId: uuid("review_audit_id").notNull(),
    revision: integer("revision").notNull(),
    publicDigest: text("public_digest").notNull(),
    quoteId: uuid("quote_id").notNull(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_acceptance_owner_fk",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    foreignKey({
      name: "expert_card_acceptance_quote_fk",
      columns: [t.quoteId, t.userId],
      foreignColumns: [expertCampaignQuotes.id, expertCampaignQuotes.userId],
    }),
    unique("expert_card_acceptance_once").on(
      t.userId,
      t.reviewAuditId,
      t.quoteId,
    ),
    unique("expert_card_acceptance_identity").on(
      t.id,
      t.userId,
      t.expertId,
      t.quoteId,
    ),
    check("expert_card_main_acceptances_revision_check", sql`revision>0`),
    check(
      "expert_card_main_acceptances_public_digest_check",
      sql`public_digest ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_card_acceptance_live",
      sql`(application_id IS NULL OR application_id=application_audit_id) AND (review_id IS NULL OR review_id=review_audit_id)`,
    ),
  ],
);
export const expertCardMainOrders = pgTable(
  "expert_card_main_orders",
  {
    orderId: uuid("order_id").primaryKey(),
    acceptanceId: uuid("acceptance_id").notNull().unique(),
    applicationId: uuid("application_id").references(
      () => expertOnboardingApplications.id,
      { onDelete: "set null" },
    ),
    applicationAuditId: uuid("application_audit_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expertId: uuid("expert_id").notNull(),
    quoteId: uuid("quote_id").notNull(),
    reviewId: uuid("review_id").references(() => expertCardReviews.id, {
      onDelete: "set null",
    }),
    reviewAuditId: uuid("review_audit_id").notNull(),
    revision: integer("revision").notNull(),
    publicDigest: text("public_digest").notNull(),
    purpose: text("purpose").notNull().default("main_residency"),
    providerMode: text("provider_mode").$type<"test" | "live">().notNull(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      name: "expert_card_main_order_owner_fk",
      columns: [t.orderId, t.expertId],
      foreignColumns: [
        expertResidencyOrders.id,
        expertResidencyOrders.expertId,
      ],
    }),
    foreignKey({
      name: "expert_card_main_order_acceptance_fk",
      columns: [t.acceptanceId, t.userId, t.expertId, t.quoteId],
      foreignColumns: [
        expertCardMainAcceptances.id,
        expertCardMainAcceptances.userId,
        expertCardMainAcceptances.expertId,
        expertCardMainAcceptances.quoteId,
      ],
    }),
    unique("expert_card_main_order_identity").on(
      t.orderId,
      t.userId,
      t.expertId,
    ),
    check("expert_card_main_orders_revision_check", sql`revision>0`),
    check(
      "expert_card_main_orders_public_digest_check",
      sql`public_digest ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "expert_card_main_orders_purpose_check",
      sql`purpose='main_residency'`,
    ),
    check(
      "expert_card_main_orders_provider_mode_check",
      sql`provider_mode IN ('test','live')`,
    ),
    check(
      "expert_card_main_order_live",
      sql`(application_id IS NULL OR application_id=application_audit_id) AND (review_id IS NULL OR review_id=review_audit_id)`,
    ),
  ],
);
export const expertPromoQualificationAudits = pgTable(
  "expert_promo_qualification_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mainOrderId: uuid("main_order_id").notNull().unique(),
    inviteeUserId: uuid("invitee_user_id").notNull(),
    inviterUserId: uuid("inviter_user_id").notNull(),
    inviteeExpertId: uuid("invitee_expert_id").notNull(),
    inviterExpertId: uuid("inviter_expert_id").notNull(),
    providerEventId: uuid("provider_event_id")
      .notNull()
      .unique()
      .references(() => expertResidencyProviderEventInbox.id),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "expert_promo_qualification_registration_fk",
      columns: [t.inviteeUserId, t.inviterUserId],
      foreignColumns: [
        expertPromoRegistrations.userId,
        expertPromoRegistrations.referrerUserId,
      ],
    }),
    foreignKey({
      name: "expert_promo_qualification_order_fk",
      columns: [t.mainOrderId, t.inviteeUserId, t.inviteeExpertId],
      foreignColumns: [
        expertCardMainOrders.orderId,
        expertCardMainOrders.userId,
        expertCardMainOrders.expertId,
      ],
    }),
    foreignKey({
      name: "expert_promo_qualification_inviter_fk",
      columns: [t.inviterExpertId, t.inviterUserId],
      foreignColumns: [experts.id, experts.userId],
    }),
    unique("expert_promo_qualification_identity").on(
      t.id,
      t.inviteeExpertId,
      t.inviterExpertId,
    ),
    check(
      "expert_promo_qualification_distinct",
      sql`invitee_user_id<>inviter_user_id AND invitee_expert_id<>inviter_expert_id`,
    ),
  ],
);
export const expertsPublished = pgTable(
  "experts_published",
  {
    expertId: uuid("expert_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    applicationAuditId: uuid("application_audit_id").notNull(),
    draftId: uuid("draft_id").references(() => expertCardDrafts.id, {
      onDelete: "cascade",
    }),
    reviewId: uuid("review_id").references(() => expertCardReviews.id, {
      onDelete: "cascade",
    }),
    revision: integer("revision").notNull(),
    publicPayload: jsonb("public_payload")
      .$type<{
        displayName: string;
        profession: string;
        city: string;
        summary: string;
      }>()
      .notNull(),
    publicDigest: text("public_digest").notNull(),
    paidOrderId: uuid("paid_order_id").notNull(),
    nextBillingDate: timestamp("next_billing_date", {
      withTimezone: true,
    }).notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "experts_published_owner_fk",
      columns: [t.expertId, t.userId],
      foreignColumns: [experts.id, experts.userId],
    }),
    foreignKey({
      name: "experts_published_paid_order_fk",
      columns: [t.paidOrderId, t.expertId],
      foreignColumns: [
        expertResidencyOrders.id,
        expertResidencyOrders.expertId,
      ],
    }),
    check("experts_published_revision_check", sql`revision>0`),
    check(
      "experts_published_public_digest_check",
      sql`public_digest ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "experts_published_next_billing_date_check",
      sql`isfinite(next_billing_date)`,
    ),
  ],
);
