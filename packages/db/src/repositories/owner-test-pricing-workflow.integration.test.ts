import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";
import { PostgresOwnerTestPricingWorkflow } from "./owner-test-pricing-workflow.js";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await startTestPostgres();
  await fixture.migrate();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("atomically consumes two-person approval and replays the original grant on concurrent retries", async () => {
  const userId = await fixture.createUser(),
    requester = await fixture.createUser(),
    approver = await fixture.createUser();
  for (const [user, session] of [
    [requester, "pricing-workflow-requester"],
    [approver, "pricing-workflow-approver"],
  ]) {
    await fixture.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${user}::uuid,'security_admin')`,
    );
    await fixture.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${user}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
  }
  const approvals = new PostgresAdminApprovalRepository(fixture.db);
  const input = {
    userId,
    sessionIdHash: "pricing-workflow-requester",
    nonce: "request-identity-001",
  };
  const requested = await approvals.requestApproval({
    action: "owner_test_pricing.grant",
    objectType: "user",
    objectId: userId,
    payload: { userId },
    ...input,
  });
  expect(requested).not.toBeNull();
  expect(
    await approvals.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: "pricing-workflow-approver",
    }),
  ).toBe(true);
  const service = new PostgresOwnerTestPricingWorkflow(fixture.db, approvals);
  const command = {
    ...input,
    actorId: requester,
    approvalId: requested!.approvalId,
  };
  const [one, two] = await Promise.all([
    service.grant(command),
    service.grant(command),
  ]);
  expect(one).toEqual(two);
  expect(one?.grantId).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(
    service.grant({ ...command, userId: await fixture.createUser() }),
  ).resolves.toBeNull();
  const rows = await fixture.db.execute<{ count: string }>(
    sql`select count(*)::text as count from owner_test_pricing_grants`,
  );
  expect(rows.rows[0]?.count).toBe("1");
  const grantId = one!.grantId;
  const revokeNonce = "revoke-identity-001";
  const revokeRequest = await approvals.requestApproval({
    action: "owner_test_pricing.revoke",
    objectType: "owner_test_pricing_grant",
    objectId: grantId,
    payload: { grantId },
    nonce: revokeNonce,
    sessionIdHash: input.sessionIdHash,
  });
  expect(revokeRequest).not.toBeNull();
  expect(
    await approvals.approveApproval({
      approvalId: revokeRequest!.approvalId,
      sessionIdHash: "pricing-workflow-approver",
    }),
  ).toBe(true);
  const revokeCommand = {
    grantId,
    actorId: requester,
    sessionIdHash: input.sessionIdHash,
    nonce: revokeNonce,
    approvalId: revokeRequest!.approvalId,
  };
  expect(await service.revoke(revokeCommand)).toEqual({ grantId });
  expect(await service.revoke(revokeCommand)).toEqual({ grantId });
}, 120_000);
