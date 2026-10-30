import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";
import { PostgresOwnerTestPricingWorkflow } from "./owner-test-pricing-workflow.js";
let f: TestDatabase;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.migrate();
}, 120_000);
afterAll(async () => {
  await f?.stop();
}, 120_000);
it("reports a controlled conflict for simultaneous separately approved grants", async () => {
  const first = await f.createUser(),
    second = await f.createUser(),
    requester = await f.createUser(),
    approver = await f.createUser();
  for (const [id, session] of [
    [requester, "conflict-requester"],
    [approver, "conflict-approver"],
  ]) {
    await f.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,'security_admin')`,
    );
    await f.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${id}::uuid,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    );
  }
  const approvals = new PostgresAdminApprovalRepository(f.db);
  const make = async (userId: string, nonce: string) => {
    const cmd = {
      action: "owner_test_pricing.grant" as const,
      objectType: "user",
      objectId: userId,
      payload: { userId },
      nonce,
      sessionIdHash: "conflict-requester",
    };
    const item = await approvals.requestApproval(cmd);
    expect(item).not.toBeNull();
    expect(
      await approvals.approveApproval({
        approvalId: item!.approvalId,
        sessionIdHash: "conflict-approver",
      }),
    ).toBe(true);
    return {
      userId,
      nonce,
      actorId: requester,
      sessionIdHash: "conflict-requester",
      approvalId: item!.approvalId,
    };
  };
  const commands = await Promise.all([
    make(first, "conflict-first"),
    make(second, "conflict-second"),
  ]);
  const workflow = new PostgresOwnerTestPricingWorkflow(f.db, approvals);
  const result = await Promise.allSettled(
    commands.map((cmd) => workflow.grant(cmd)),
  );
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  const failure = result.find((item) => item.status === "rejected");
  expect(failure?.status === "rejected" && failure.reason.message).toBe(
    "owner_test_pricing_conflict",
  );
}, 120_000);
