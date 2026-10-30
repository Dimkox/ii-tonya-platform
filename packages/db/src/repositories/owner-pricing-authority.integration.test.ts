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

it("allows exactly one active fixed-price grant, immutable except revocation", async () => {
  const first = await fixture.createUser();
  const second = await fixture.createUser();
  const admin = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values('owner-pricing-authority-test',${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  const insert = async (id: string) => {
    const approval = await ownerPricingApproval(fixture, {
      action: "grant",
      target: id,
      adminId: admin,
      sessionIdHash: "owner-pricing-authority-test",
    });
    return fixture.db.execute(
      sql`insert into owner_test_pricing_grants (user_id,granted_by,grant_session_hash,grant_approval_id) values (${id}::uuid,${admin}::uuid,'owner-pricing-authority-test',${approval}::uuid)`,
    );
  };
  await insert(first);
  const result = await fixture.db.execute<{
    id: string;
    onboarding_minor: string;
    subscription_minor: string;
    policy_version: string;
  }>(
    sql`select id, onboarding_minor, subscription_minor, policy_version from owner_test_pricing_grants where user_id=${first}::uuid`,
  );
  expect(result.rows[0]).toMatchObject({
    onboarding_minor: "1000",
    subscription_minor: "2000",
    policy_version: "owner_test_10_20_v1",
  });
  expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set id=gen_random_uuid() where user_id=${first}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(insert(second)).rejects.toThrow();
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set onboarding_minor=1 where user_id=${first}::uuid`,
    ),
  ).rejects.toThrow();
  const revokeApproval = await ownerPricingApproval(fixture, {
    action: "revoke",
    target: result.rows[0]!.id,
    adminId: admin,
    sessionIdHash: "owner-pricing-authority-test",
  });
  await fixture.db.execute(
    sql`update owner_test_pricing_grants set revoked_at=clock_timestamp(),revoked_by=${admin}::uuid,revoke_session_hash='owner-pricing-authority-test',revoke_approval_id=${revokeApproval}::uuid where user_id=${first}::uuid`,
  );
  await expect(
    fixture.db.execute(
      sql`update owner_test_pricing_grants set revoked_at=null where user_id=${first}::uuid`,
    ),
  ).rejects.toThrow();
  await insert(second);
});
