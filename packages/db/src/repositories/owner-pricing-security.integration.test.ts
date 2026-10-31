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
it("requires an authenticated security admin and rejects deletion or unauthorized revocation", async () => {
  const owner = await fixture.createUser();
  const admin = await fixture.createUser();
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants(user_id) values(${owner}::uuid)`,
    ),
  ).rejects.toThrow();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id, role) values(${admin}::uuid,'security_admin')`,
  );
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values('owner-pricing-test-session',${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  const approval = await ownerPricingApproval(fixture, {
    action: "grant",
    target: owner,
    adminId: admin,
    sessionIdHash: "owner-pricing-test-session",
  });
  const issued = await fixture.db.execute<{ id: string }>(
    sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${owner}::uuid,${admin}::uuid,'owner-pricing-test-session',${approval}::uuid) returning id`,
  );
  const id = issued.rows[0]!.id;
  await expect(
    fixture.db.execute(
      sql`delete from owner_test_pricing_grants where id=${id}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=clock_timestamp() where id=${id}::uuid`,
    ),
  ).rejects.toThrow();
  const revokeApproval = await ownerPricingApproval(fixture, {
    action: "revoke",
    target: id,
    adminId: admin,
    sessionIdHash: "owner-pricing-test-session",
  });
  await fixture.db.execute(
    sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(), revoked_by=${admin}::uuid, revoke_session_hash='owner-pricing-test-session',revoke_approval_id=${revokeApproval}::uuid where id=${id}::uuid`,
  );
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=null,revoked_by=null,revoke_session_hash=null where id=${id}::uuid`,
    ),
  ).rejects.toThrow();
  const audit = await fixture.db.execute<{ action: string }>(
    sql`select action from audit_events where object_id=${id}::uuid order by occurred_at`,
  );
  expect(audit.rows.map((row) => row.action)).toEqual([
    "OWNER_TEST_PRICE_GRANTED",
    "OWNER_TEST_PRICE_REVOKED",
  ]);
}, 120_000);
