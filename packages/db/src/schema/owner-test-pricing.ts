import { sql } from "drizzle-orm";
import {
  bigint,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { adminApprovals } from "./audit.js";

/** Restrictive grant and transition guards are in hand-authored migration 0076. */
export const ownerTestPricingGrants = pgTable(
  "owner_test_pricing_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    policyVersion: text("policy_version")
      .notNull()
      .default("owner_test_10_20_v1"),
    providerMode: text("provider_mode").notNull().default("live"),
    grantedBy: uuid("granted_by").notNull(),
    grantSessionHash: text("grant_session_hash").notNull(),
    grantApprovalId: uuid("grant_approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    revokedBy: uuid("revoked_by"),
    revokeSessionHash: text("revoke_session_hash"),
    revokeApprovalId: uuid("revoke_approval_id").references(
      () => adminApprovals.id,
    ),
    onboardingMinor: bigint("onboarding_minor", { mode: "number" })
      .notNull()
      .default(1000),
    subscriptionMinor: bigint("subscription_minor", { mode: "number" })
      .notNull()
      .default(2000),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.id, t.userId)],
);
