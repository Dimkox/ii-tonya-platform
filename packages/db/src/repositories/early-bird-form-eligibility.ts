import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
/** Caller holds subject/consent lock and has verified channel identity. */
export async function earlyBirdFormEligible(
  tx: Tx,
  input: { userId: string; botId: string; botKey: string; chatId: string },
): Promise<boolean> {
  const config = await tx.execute(
    sql`select id from early_bird_launch_configs where active and phase='WAVE_1_EARLY_BIRD' for share`,
  );
  if (config.rows.length !== 1) return false;
  const snap = (
    await tx.execute<{ grantId: string | null; consentVersion: string }>(
      sql`select s.grant_id as "grantId",b.consent_version as "consentVersion" from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_positive_price_snapshots s on s.positive_choice_id=c.positive_choice_id and s.user_id=c.user_id and s.base_id=b.id where b.user_id=${input.userId}::uuid and b.bot_id=${input.botId} and b.bot_key=${input.botKey} and b.chat_id=${input.chatId} and c.id=(select id from early_bird_choices where base_id=b.id order by decision_no desc limit 1) and c.positive_choice_id=(select id from expert_sales_choices where base_id=b.id order by revision desc limit 1) for share of b,c,s`,
    )
  ).rows;
  if (snap.length !== 1) return false;
  const grants = (
    await tx.execute<{ id: string }>(
      sql`select id from owner_test_pricing_grants where user_id=${input.userId}::uuid and revoked_at is null and provider_mode='live' for share`,
    )
  ).rows;
  if (grants.length > 1 || (grants[0]?.id ?? null) !== snap[0]!.grantId)
    return false;
  return (
    (
      await tx.execute<{ valid: boolean }>(
        sql`select early_bird_wave_active(early_bird_current_time()) and expert_card_current_messaging_authority(${input.userId}::uuid,${snap[0]!.consentVersion}) as valid`,
      )
    ).rows[0]?.valid === true
  );
}
