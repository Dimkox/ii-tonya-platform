import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type Executor = Pick<DrizzleDb, "execute">;

export async function hasCurrentTestExpertConsent(
  executor: Executor,
  input: {
    userId: string;
    messagingPolicyVersion: string;
    selartiPolicyVersion?: string;
  },
): Promise<boolean> {
  const rows = await executor.execute<{
    purpose: string;
    decision: string;
    policyVersion: string;
  }>(sql`
    select distinct on (consent_type)
      consent_type as purpose,decision,policy_version as "policyVersion"
    from consents
    where user_id=${input.userId}::uuid
      and consent_type in ('client_messaging','selarti_ai_processing')
    order by consent_type,created_at desc,id desc`);
  const latest = new Map(rows.rows.map((row) => [row.purpose, row]));
  const messaging = latest.get("client_messaging");
  if (
    messaging?.decision !== "granted" ||
    messaging.policyVersion !== input.messagingPolicyVersion
  )
    return false;
  if (input.selartiPolicyVersion !== undefined) {
    const ai = latest.get("selarti_ai_processing");
    if (
      ai?.decision !== "granted" ||
      ai.policyVersion !== input.selartiPolicyVersion
    )
      return false;
  }
  return true;
}
