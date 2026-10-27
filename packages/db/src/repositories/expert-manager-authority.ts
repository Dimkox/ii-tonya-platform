import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
export type ExpertManagerTransaction = Parameters<
  Parameters<DrizzleDb["transaction"]>[0]
>[0];
export class ExpertManagerAuthorityError extends Error {
  constructor(code = "verification_forbidden") {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new ExpertManagerAuthorityError(code);
};
/** Original row locks and full-precision finite PostgreSQL clock authority. */
export async function lockExpertManagerAuthority(
  tx: ExpertManagerTransaction,
  sessionHash: string,
): Promise<string> {
  if (
    typeof sessionHash !== "string" ||
    sessionHash.length < 1 ||
    sessionHash.length > 200
  )
    return fail("verification_forbidden");
  // Lock original session/assignment/user rows, then check actual DB time after
  // all waits. Caller-supplied principal roles never authorize this workflow.
  const rows = (
    await tx.execute<{ adminId: string }>(
      sql`select s.admin_id as "adminId" from admin_sessions s join users u on u.id=s.admin_id join admin_role_assignments r on r.admin_id=s.admin_id and r.role in ('support','security_admin') where s.session_id_hash=${sessionHash} for share of s,u,r`,
    )
  ).rows;
  const row = rows[0];
  if (!row) return fail("verification_forbidden");
  // Raw execute() returns PostgreSQL timestamps as strings. Keep temporal
  // authority inside PostgreSQL, at full precision, AFTER the original locks.
  const allowed = (
    await tx.execute<{ authorized: boolean }>(
      sql`with auth_clock as materialized (select clock_timestamp() as checked_at) select exists(select 1 from admin_sessions s join users u on u.id=s.admin_id and u.active=true join admin_role_assignments r on r.admin_id=s.admin_id and r.role in ('support','security_admin') cross join auth_clock c where s.session_id_hash=${sessionHash} and s.admin_id=${row.adminId}::uuid and s.revoked_at is null and isfinite(s.expires_at) and isfinite(s.mfa_verified_at) and s.expires_at>c.checked_at and s.mfa_verified_at<=c.checked_at and s.mfa_verified_at>=c.checked_at-interval '15 minutes') as authorized`,
    )
  ).rows[0]?.authorized;
  if (allowed !== true) return fail("verification_forbidden");
  return row.adminId;
}
