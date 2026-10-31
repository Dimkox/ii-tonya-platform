import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";
let f: TestDatabase;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.migrate();
}, 120_000);
afterAll(async () => {
  await f?.stop();
}, 120_000);
it("prevents reusing consumed grant approval after its grant is revoked", async () => {
  const user = await f.createUser(),
    actor = await f.createUser(),
    other = await f.createUser();
  for (const [id, session] of [
    [actor, "once-requester"],
    [other, "once-approver"],
  ]) {
    await f.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,'security_admin')`,
    );
    await f.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${id}::uuid,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    );
  }
  const approvals = new PostgresAdminApprovalRepository(f.db);
  const consume = async (
    action: "owner_test_pricing.grant" | "owner_test_pricing.revoke",
    objectId: string,
    nonce: string,
  ) => {
    const grant = action === "owner_test_pricing.grant";
    const cmd = {
      action,
      objectType: grant ? "user" : "owner_test_pricing_grant",
      objectId,
      payload: grant ? { userId: objectId } : { grantId: objectId },
      nonce,
      sessionIdHash: "once-requester",
    };
    const item = await approvals.requestApproval(cmd);
    expect(item).not.toBeNull();
    expect(
      await approvals.approveApproval({
        approvalId: item!.approvalId,
        sessionIdHash: "once-approver",
      }),
    ).toBe(true);
    expect(
      await approvals.consumeApproval({ ...cmd, approvalId: item!.approvalId }),
    ).not.toBeNull();
    return item!.approvalId;
  };
  const first = await consume(
    "owner_test_pricing.grant",
    user,
    "once-grant-001",
  );
  const row = await f.db.execute<{ id: string }>(
    sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${actor}::uuid,'once-requester',${first}::uuid) returning id`,
  );
  const id = row.rows[0]!.id;
  const revoke = await consume(
    "owner_test_pricing.revoke",
    id,
    "once-revoke-001",
  );
  await f.db.execute(
    sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${actor}::uuid,revoke_session_hash='once-requester',revoke_approval_id=${revoke}::uuid where id=${id}::uuid`,
  );
  const duplicate = await f.db
    .execute(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${actor}::uuid,'once-requester',${first}::uuid)`,
    )
    .then(
      () => null,
      (error: unknown) => error as { cause?: { constraint?: string } },
    );
  expect(duplicate?.cause?.constraint).toBe(
    "owner_test_pricing_approval_audit_identity",
  );
  const fresh = await consume(
    "owner_test_pricing.grant",
    user,
    "once-grant-002",
  );
  await expect(
    f.db.execute(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${actor}::uuid,'once-requester',${fresh}::uuid)`,
    ),
  ).resolves.toBeDefined();
}, 120_000);
