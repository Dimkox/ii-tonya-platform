import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type ClientReferralAttribution =
  | { outcome: "self" }
  | { outcome: "created"; inviterUserId: string }
  | { outcome: "kept"; inviterUserId: string };

/**
 * First inviter wins for the client coupon program.
 * A repeated code inserts nothing and does not write client_coupon_grants.
 */
export class PostgresClientReferralRepository {
  constructor(private readonly db: DrizzleDb) {}

  async attribute(input: {
    referredUserId: string;
    inviterUserId: string;
  }): Promise<ClientReferralAttribution> {
    if (input.referredUserId === input.inviterUserId) {
      return { outcome: "self" };
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      const inserted = await tx.execute<{ inviterUserId: string }>(sql`
        insert into client_referral_attributions(referred_user_id, inviter_user_id)
        values (${input.referredUserId}::uuid, ${input.inviterUserId}::uuid)
        on conflict (referred_user_id) do nothing
        returning inviter_user_id as "inviterUserId"
      `);
      const created = inserted.rows[0];
      if (created) {
        return { outcome: "created", inviterUserId: created.inviterUserId };
      }
      const existing = (
        await tx.execute<{ inviterUserId: string }>(sql`
          select inviter_user_id as "inviterUserId"
          from client_referral_attributions
          where referred_user_id = ${input.referredUserId}::uuid
        `)
      ).rows[0];
      if (!existing) throw new Error("client_referral_attribution_missing");
      return { outcome: "kept", inviterUserId: existing.inviterUserId };
    });
  }
}
