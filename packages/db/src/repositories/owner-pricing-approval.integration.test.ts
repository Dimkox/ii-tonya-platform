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
it("requires a different MFA security admin approval bound to the expert and consumes it once", async () => {
  const target = await fixture.createUser();
  const requester = await fixture.createUser();
  const approver = await fixture.createUser();
  const requesterSession = "pricing-approval-requester-session";
  const approverSession = "pricing-approval-approver-session";
  for (const [id, session] of [
    [requester, requesterSession],
    [approver, approverSession],
  ]) {
    await fixture.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,'security_admin')`,
    );
    await fixture.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${id}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
  }
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash) values(${target}::uuid,${requester}::uuid,${requesterSession})`,
    ),
  ).rejects.toThrow();
  const approvals = new PostgresAdminApprovalRepository(fixture.db);
  const payload = { userId: target };
  const command = {
    action: "owner_test_pricing.grant" as const,
    objectType: "user",
    objectId: target,
    payload,
    nonce: "grant-nonce-unique",
    sessionIdHash: requesterSession,
  };
  const requested = await approvals.requestApproval(command);
  expect(requested).not.toBeNull();
  expect(
    await approvals.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: requesterSession,
    }),
  ).toBe(false);
  expect(
    await approvals.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: approverSession,
    }),
  ).toBe(true);
  const result = await fixture.db.transaction(async (tx) => {
    expect(
      await approvals.consumeApprovalInTransaction(tx, {
        ...command,
        approvalId: requested!.approvalId,
      }),
    ).not.toBeNull();
    return tx.execute<{ id: string }>(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${target}::uuid,${requester}::uuid,${requesterSession},${requested!.approvalId}::uuid) returning id`,
    );
  });
  expect(result.rows).toHaveLength(1);
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${target}::uuid,${requester}::uuid,${requesterSession},${requested!.approvalId}::uuid)`,
    ),
  ).rejects.toThrow();
}, 120_000);
