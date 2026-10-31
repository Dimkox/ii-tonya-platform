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
it("erases a deleted subject while permanently preventing grant identity reuse", async () => {
  const first = await fixture.createUser(),
    second = await fixture.createUser(),
    admin = await fixture.createUser();
  await fixture.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${admin}::uuid,'security_admin')`,
  );
  await fixture.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values('owner-pricing-erasure-test',${admin}::uuid,clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour')`,
  );
  const approval = await ownerPricingApproval(fixture, {
    action: "grant",
    target: first,
    adminId: admin,
    sessionIdHash: "owner-pricing-erasure-test",
  });
  const result = await fixture.db.execute<{ id: string }>(
    sql`insert into owner_test_pricing_grants(user_id,granted_by,grant_session_hash,grant_approval_id) values(${first}::uuid,${admin}::uuid,'owner-pricing-erasure-test',${approval}::uuid) returning id`,
  );
  const id = result.rows[0]!.id;
  await fixture.db.execute(sql`delete from users where id=${first}::uuid`);
  expect(
    (
      await fixture.db.execute(
        sql`select 1 from owner_test_pricing_grants where id=${id}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
  const secondApproval = await ownerPricingApproval(fixture, {
    action: "grant",
    target: second,
    adminId: admin,
    sessionIdHash: "owner-pricing-erasure-test",
  });
  await expect(
    fixture.db.execute(
      sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${id}::uuid,${second}::uuid,${admin}::uuid,'owner-pricing-erasure-test',${secondApproval}::uuid)`,
    ),
  ).rejects.toThrow();
}, 120_000);
