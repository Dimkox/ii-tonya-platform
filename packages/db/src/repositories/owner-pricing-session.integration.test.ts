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

it("rejects inactive owners and unauthorised, expired, revoked or stale-MFA admin sessions", async () => {
  const admin = await fixture.createUser(),
    target = await fixture.createUser(),
    inactive = await fixture.createUser();
  await fixture.db.execute(
    sql`update users set active=false where id=${inactive}::uuid`,
  );
  const prefix = randomUUID();
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${prefix + "-valid"},${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour'),(${prefix + "-expired"},${admin}::uuid,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'),(${prefix + "-stale"},${admin}::uuid,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour'),(${prefix + "-revoked"},${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour'),(${prefix + "-infinite"},${admin}::uuid,clock_timestamp()-interval '3 minutes','infinity'::timestamptz)`,
  );
  await fixture.db.execute(
    sql`update admin_sessions set revoked_at=clock_timestamp() where session_id_hash=${prefix + "-revoked"}`,
  );
  const make = async (targetId: string, session: string) => {
    const sessionHash = prefix + "-" + session;
    const approval = await ownerPricingApproval(fixture, {
      action: "grant",
      target: targetId,
      adminId: admin,
      sessionIdHash: sessionHash,
    });
    return () =>
      fixture.db.execute(
        sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${targetId}::uuid,${admin}::uuid,${sessionHash},${approval}::uuid)`,
      );
  };
  const unauthorized = await make(target, "valid");
  await fixture.db.execute(
    sql`delete from admin_role_assignments where admin_id=${admin}::uuid and role='security_admin'`,
  );
  await expect(unauthorized()).rejects.toThrow();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  for (const session of ["expired", "stale", "revoked", "infinite"]) {
    const attempt = await make(target, session);
    await expect(attempt()).rejects.toThrow();
  }
  const inactiveAttempt = await make(inactive, "valid");
  await expect(inactiveAttempt()).rejects.toThrow();
  const valid = await make(target, "valid");
  await valid();
  const grant = (
    await fixture.db.execute<{ id: string }>(
      sql`select id from owner_test_pricing_grants where user_id=${target}::uuid`,
    )
  ).rows[0]!.id;
  const revokeApproval = await ownerPricingApproval(fixture, {
    action: "revoke",
    target: grant,
    adminId: admin,
    sessionIdHash: prefix + "-revoked",
  });
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${admin}::uuid,revoke_session_hash=${prefix + "-revoked"},revoke_approval_id=${revokeApproval}::uuid where id=${grant}::uuid`,
    ),
  ).rejects.toThrow();
}, 120_000);

it("holds the target user lock until grant creation commits", async () => {
  const admin = await fixture.createUser(),
    target = await fixture.createUser(),
    session = randomUUID();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  // Clear the prior test's grant through authorised revocation.
  const active = (
    await fixture.db.execute<{ id: string }>(
      sql`select id from owner_test_pricing_grants where revoked_at is null`,
    )
  ).rows[0];
  if (active) {
    const revokeApproval = await ownerPricingApproval(fixture, {
      action: "revoke",
      target: active.id,
      adminId: admin,
      sessionIdHash: session,
    });
    await fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${admin}::uuid,revoke_session_hash=${session},revoke_approval_id=${revokeApproval}::uuid where id=${active.id}::uuid`,
    );
  }
  const grantApproval = await ownerPricingApproval(fixture, {
    action: "grant",
    target,
    adminId: admin,
    sessionIdHash: session,
  });
  const first = await fixture.db.$client.connect(),
    second = await fixture.db.$client.connect();
  try {
    await first.query("begin");
    await first.query(
      "insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values($1,$2,$3,$4)",
      [target, admin, session, grantApproval],
    );
    await second.query("begin");
    await second.query("set local lock_timeout='200ms'");
    await expect(
      second.query("update users set active=false where id=$1", [target]),
    ).rejects.toThrow(/lock timeout/u);
  } finally {
    await first.query("rollback");
    await second.query("rollback");
    first.release();
    second.release();
  }
}, 120_000);
