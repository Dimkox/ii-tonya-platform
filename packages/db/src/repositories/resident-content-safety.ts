import { sql } from "drizzle-orm";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
export interface ResidentSafetyIssue {
  field: string;
  ruleId: string | null;
  severity: "BLOCKER" | "WARNING";
  reason: string;
}
export interface ResidentSafetyAssessment {
  policyId: string;
  publicationId: string;
  generation: string;
  revision: number;
  digest: string;
  issues: ResidentSafetyIssue[];
  blocked: boolean;
}
export async function residentSafetyFields(
  tx: ExpertCardTransaction,
  draftId: string,
) {
  return (
    await tx.execute<{ fields: Record<string, string> }>(
      sql`select resident_card_effective_fields(${draftId}::uuid) as fields`,
    )
  ).rows[0]!.fields;
}
export async function assessResidentContent(
  tx: ExpertCardTransaction,
  fields: Record<string, string>,
  revision: number,
) {
  return (
    await tx.execute<{ assessment: ResidentSafetyAssessment }>(
      sql`select resident_safety_assess(${JSON.stringify(fields)}::jsonb,${revision}::integer) as assessment`,
    )
  ).rows[0]!.assessment;
}
export async function recordResidentSafety(
  tx: ExpertCardTransaction,
  draft: { id: string; userId: string },
  requestKey: string,
  assessment: ResidentSafetyAssessment,
) {
  if (!assessment.issues.length) return;
  const row = (
    await tx.execute<{ id: string }>(
      sql`insert into resident_safety_outcomes(user_id,draft_id,request_key,blocked,policy_id,revision,issues) values(${draft.userId}::uuid,${draft.id}::uuid,${requestKey},${assessment.blocked},${assessment.policyId}::uuid,${assessment.revision},${JSON.stringify(assessment.issues)}::jsonb) on conflict(user_id,request_key) do nothing returning id`,
    )
  ).rows[0];
  if (!row) return;
  for (const issue of assessment.issues)
    await tx.execute(
      sql`insert into security_logs(user_id,draft_id,outcome_id,field_name,matched_pattern_id,policy_id,revision,action_taken) values(${draft.userId}::uuid,${draft.id}::uuid,${row.id}::uuid,${issue.field},${issue.ruleId}::uuid,${assessment.policyId}::uuid,${assessment.revision},${assessment.blocked ? "Blocked" : "Warned"})`,
    );
}
export async function residentSafetyOutcome(
  tx: ExpertCardTransaction,
  userId: string,
  requestKey: string,
) {
  const row = (
    await tx.execute<{ blocked: boolean; issues: ResidentSafetyIssue[] }>(
      sql`select blocked,issues from resident_safety_outcomes where user_id=${userId}::uuid and request_key=${requestKey}`,
    )
  ).rows[0];
  return row ? { safetyBlocked: row.blocked, safetyIssues: row.issues } : {};
}
