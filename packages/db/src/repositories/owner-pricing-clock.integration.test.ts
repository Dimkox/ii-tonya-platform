import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
let fixture: ExpertReferralTestDatabase;
beforeAll(async () => {
  fixture = await startExpertReferralTestDatabase();
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
async function waitForLock(pid: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await fixture.db.execute<{ waiting: boolean }>(
      sql`select wait_event_type='Lock' as waiting from pg_stat_activity where pid=${pid}`,
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("expected_postgres_lock_wait");
}
async function setup() {
  const admin = await fixture.createUser(),
    target = await fixture.createUser(),
    session = randomUUID();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  const approval = await ownerPricingApproval(fixture, {
    action: "grant",
    target,
    adminId: admin,
    sessionIdHash: session,
  });
  return { admin, target, session, approval };
}
it("rejects a grant when the admin session expires while waiting for the user lock", async () => {
  const { admin, target, session, approval } = await setup();
  const first = await fixture.db.$client.connect(),
    second = await fixture.db.$client.connect();
  try {
    const pid = (
      await second.query<{ pid: number }>("select pg_backend_pid() pid")
    ).rows[0]!.pid;
    await first.query("begin");
    await first.query("update users set active=active where id=$1", [target]);
    const pending = second
      .query(
        "insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values($1,$2,$3,$4)",
        [target, admin, session, approval],
      )
      .then(
        () => null,
        (error: Error) => error,
      );
    await waitForLock(pid);
    await fixture.db.execute(
      sql`update admin_sessions set expires_at=clock_timestamp()-interval '1 second' where session_id_hash=${session}`,
    );
    await first.query("commit");
    expect((await pending)?.message).toMatch(
      /owner_test_pricing_admin_required/u,
    );
  } finally {
    await first.query("rollback");
    first.release();
    second.release();
  }
}, 120_000);
it("rejects a grant when the admin session expires while its session row is locked", async () => {
  const { admin, target, session, approval } = await setup();
  const first = await fixture.db.$client.connect(),
    second = await fixture.db.$client.connect();
  try {
    const pid = (
      await second.query<{ pid: number }>("select pg_backend_pid() pid")
    ).rows[0]!.pid;
    await first.query("begin");
    await first.query(
      "update admin_sessions set expires_at=clock_timestamp()-interval '1 second' where session_id_hash=$1",
      [session],
    );
    const pending = second
      .query(
        "insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values($1,$2,$3,$4)",
        [target, admin, session, approval],
      )
      .then(
        () => null,
        (error: Error) => error,
      );
    await waitForLock(pid);
    await first.query("commit");
    expect((await pending)?.message).toMatch(
      /owner_test_pricing_admin_required/u,
    );
  } finally {
    await first.query("rollback");
    first.release();
    second.release();
  }
}, 120_000);
