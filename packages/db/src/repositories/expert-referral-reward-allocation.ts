import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type Tx = Pick<DrizzleDb, "execute">;

export async function grantExpertReferralReward(
  tx: Tx,
  input: {
    readonly maturityId: string | null;
    readonly inviterExpertId: string;
    readonly referralId: string;
    readonly firstSettlementId: string;
    readonly orderId: string;
    readonly paymentAttemptId: string;
  },
): Promise<"granted" | "debt_repaid" | "already_granted"> {
  const debts = await tx.execute<{ entryId: string; grantId: string; amount: bigint | string; createdAt: Date | string; expiresAt: Date | string }>(sql`
    select e.id as "entryId", a.reward_grant_id as "grantId", a.amount_minor as amount,
           e.created_at as "createdAt", g.expires_at as "expiresAt"
    from expert_referral_ledger_entries e
    join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id
    join expert_referral_reward_grants g on g.id=a.reward_grant_id
    where e.expert_id=${input.inviterExpertId}::uuid and e.entry_kind in ('reversal','debt_repayment')
    order by g.expires_at, e.created_at, a.reward_grant_id, e.id
    for update of e,a,g
  `);
  let remaining = 100000n;
  const byGrant = new Map<string, { originalId: string; amount: bigint }>();
  for (const debt of debts.rows) {
    const current = byGrant.get(debt.grantId);
    byGrant.set(debt.grantId, { originalId: current?.originalId ?? debt.entryId, amount: (current?.amount ?? 0n) + BigInt(debt.amount) });
  }
  for (const [grantId, debt] of byGrant) {
    const outstanding = debt.amount < 0n ? -debt.amount : 0n;
    if (!outstanding || !remaining) continue;
    const amount = outstanding < remaining ? outstanding : remaining;
    const repayment = await tx.execute<{ id: string }>(sql`
      insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,original_entry_id,source_type,source_id,idempotency_key)
      values (${input.inviterExpertId}::uuid,'debt_repayment',${amount},${debt.originalId}::uuid,${input.maturityId === null ? "first_settlement" : "matured_referral"},${input.maturityId ?? input.firstSettlementId}::uuid,${`reward-debt:${input.maturityId ?? input.firstSettlementId}:${grantId}`})
      on conflict (idempotency_key) do nothing returning id
    `);
    if (repayment.rows[0]) await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${repayment.rows[0].id}::uuid,${grantId}::uuid,${input.inviterExpertId}::uuid,${amount})`);
    remaining -= amount;
  }
  if (!remaining) return "debt_repaid";
  const grant = await tx.execute<{ id: string }>(sql`
    insert into expert_referral_reward_grants (expert_id,referral_id,first_settlement_id,qualifying_order_id,qualifying_payment_attempt_id,maturity_id,amount_minor,granted_at,expires_at,idempotency_key)
    values (${input.inviterExpertId}::uuid,${input.referralId}::uuid,${input.firstSettlementId}::uuid,${input.orderId}::uuid,${input.paymentAttemptId}::uuid,${input.maturityId}::uuid,100000,transaction_timestamp(),transaction_timestamp()+interval '365 days',${`reward:${input.maturityId ?? input.firstSettlementId}`})
    on conflict (first_settlement_id) do nothing returning id
  `);
  if (!grant.rows[0]) return "already_granted";
  const ledger = await tx.execute<{ id: string }>(sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,source_type,source_id,idempotency_key) values (${input.inviterExpertId}::uuid,'reward_grant',${remaining},'reward_grant',${grant.rows[0].id}::uuid,${`reward-ledger:${input.maturityId ?? input.firstSettlementId}`}) returning id`);
  if (!ledger.rows[0]) throw new Error("expert_referral_reward_ledger_insert_failed");
  await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${ledger.rows[0].id}::uuid,${grant.rows[0].id}::uuid,${input.inviterExpertId}::uuid,${remaining})`);
  return "granted";
}
