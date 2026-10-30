import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("rejects a consumed approval if requester MFA has been replaced", async () => {
  const target = await fixture.createUser(),
    requestor = await fixture.createUser(),
    approver = await fixture.createUser();
  for (const [user, session] of [
    [requestor, "reauth-requester"],
    [approver, "reauth-approver"],
  ]) {
    await fixture.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${user}::uuid,'security_admin')`,
    );
    await fixture.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${user}::uuid,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    );
  }
  const a = new PostgresAdminApprovalRepository(fixture.db);
  const command = {
    action: "owner_test_pricing.grant" as const,
    objectType: "user",
    objectId: target,
    payload: { userId: target },
    nonce: "reauth-nonce-001",
    sessionIdHash: "reauth-requester",
  };
  const record = await a.requestApproval(command);
  expect(
    await a.approveApproval({
      approvalId: record!.approvalId,
      sessionIdHash: "reauth-approver",
    }),
  ).toBe(true);
  expect(
    await a.consumeApproval({ ...command, approvalId: record!.approvalId }),
  ).not.toBeNull();
  await fixture.db.execute(
    sql`update admin_sessions set mfa_verified_at=clock_timestamp() where session_id_hash='reauth-requester'`,
  );
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${target}::uuid,${requestor}::uuid,'reauth-requester',${record!.approvalId}::uuid)`,
    ),
  ).rejects.toThrow();
}, 120_000);
