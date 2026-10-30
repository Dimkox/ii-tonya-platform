import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
import { PostgresAdminApprovalRepository } from "./admin-approval-repository.js";
import { PostgresOwnerTestPricingWorkflow } from "./owner-test-pricing-workflow.js";
let f: ExpertReferralTestDatabase;
beforeAll(async () => {
  f = await startExpertReferralTestDatabase();
}, 120_000);
afterAll(async () => {
  await f?.stop();
}, 120_000);
it("takes subject lock before row lock while revoking against a sales choice", async () => {
  const user = await f.createUser(),
    admin = await f.createUser(),
    approver = await f.createUser(),
    session = randomUUID(),
    approvalSession = randomUUID();
  for (const [id, s] of [
    [admin, session],
    [approver, approvalSession],
  ]) {
    await f.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${id}::uuid,'security_admin')`,
    );
    await f.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${s},${id}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
    );
  }
  const grantApproval = await ownerPricingApproval(f, {
    action: "grant",
    target: user,
    adminId: admin,
    sessionIdHash: session,
  });
  const result = await f.db.execute<{ id: string }>(
    sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${user}::uuid,${admin}::uuid,${session},${grantApproval}::uuid) returning id`,
  );
  const grantId = result.rows[0]!.id,
    approvals = new PostgresAdminApprovalRepository(f.db);
  const req = {
    action: "owner_test_pricing.revoke" as const,
    objectType: "owner_test_pricing_grant",
    objectId: grantId,
    payload: { grantId },
    nonce: "lock-order-001",
    sessionIdHash: session,
  };
  const approved = await approvals.requestApproval(req);
  expect(approved).not.toBeNull();
  expect(
    await approvals.approveApproval({
      approvalId: approved!.approvalId,
      sessionIdHash: approvalSession,
    }),
  ).toBe(true);
  const first = await f.db.$client.connect();
  try {
    await first.query("begin");
    await first.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [user],
    );
    await first.query("set local lock_timeout='250ms'");
    const pending = new PostgresOwnerTestPricingWorkflow(
      f.db,
      approvals,
    ).revoke({
      grantId,
      actorId: admin,
      sessionIdHash: session,
      approvalId: approved!.approvalId,
      nonce: req.nonce,
    });
    const deadline = Date.now() + 10_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const check = await f.db.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_locks where locktype='advisory' and not granted) as waiting`,
      );
      if (check.rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
    await expect(
      first.query(
        "select id from owner_test_pricing_grants where id=$1 for share",
        [grantId],
      ),
    ).resolves.toBeDefined();
    await first.query("commit");
    expect(await pending).toEqual({ grantId });
  } finally {
    await first.query("rollback");
    first.release();
  }
}, 120_000);
