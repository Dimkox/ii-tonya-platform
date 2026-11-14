import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

/**
 * Client coupon referral lock. One referred client, one first inviter.
 * Does not grant spendable coupons and does not touch payment providers.
 */
export const clientReferralAttributions = pgTable(
  "client_referral_attributions",
  {
    referredUserId: uuid("referred_user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    inviterUserId: uuid("inviter_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "client_referral_no_self",
      sql`${table.referredUserId} <> ${table.inviterUserId}`,
    ),
    index("client_referral_inviter_idx").on(table.inviterUserId),
  ],
);
