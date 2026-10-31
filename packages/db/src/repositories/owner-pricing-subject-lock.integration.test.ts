import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
let f: ExpertReferralTestDatabase;
beforeAll(async () => {
  f = await startExpertReferralTestDatabase();
}, 120_000);
afterAll(async () => {
  await f?.stop();
}, 120_000);
it("serializes grant creation and revocation against the same user's sales choice lock", async () => {
  const user = await f.createUser(),
    admin = await f.createUser(),
    session = randomUUID();
  await f.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  await f.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  const grantApproval = await ownerPricingApproval(f, {
    action: "grant",
    target: user,
    adminId: admin,
    sessionIdHash: session,
  });
  const a = await f.db.$client.connect(),
    b = await f.db.$client.connect();
  try {
    await a.query("begin");
    await a.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [user],
    );
    await b.query("set lock_timeout='250ms'");
    const insert =
      "insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values($1,$2,$3,$4) returning id";
    await expect(
      b.query(insert, [user, admin, session, grantApproval]),
    ).rejects.toMatchObject({ code: "55P03" });
    await a.query("commit");
    const row = await b.query<{ id: string }>(insert, [
      user,
      admin,
      session,
      grantApproval,
    ]);
    const id = row.rows[0]!.id;
    const revokeApproval = await ownerPricingApproval(f, {
      action: "revoke",
      target: id,
      adminId: admin,
      sessionIdHash: session,
    });
    await a.query("begin");
    await a.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text,0))",
      [user],
    );
    const update =
      "update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=$1,revoke_session_hash=$2,revoke_approval_id=$3 where id=$4";
    await expect(
      b.query(update, [admin, session, revokeApproval, id]),
    ).rejects.toMatchObject({ code: "55P03" });
    await a.query("commit");
    expect(
      (await b.query(update, [admin, session, revokeApproval, id])).rowCount,
    ).toBe(1);
  } finally {
    await a.query("rollback");
    a.release();
    b.release();
  }
}, 120_000);
