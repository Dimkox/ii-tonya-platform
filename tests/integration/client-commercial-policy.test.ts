import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresClientCommercialPolicyRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("client commercial policy assignment", () => {
  let database: TestDatabase;
  const admin = "00000000-0000-4000-8000-000000000071";
  const user = "00000000-0000-4000-8000-000000000072";
  const approval = "00000000-0000-4000-8000-000000000073";
  const objectId = "00000000-0000-0000-0000-000000000041";
  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    await database.db.execute(
      sql`insert into users (id) values (${admin}::uuid), (${user}::uuid)`,
    );
    await database.db.execute(
      sql`insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at) values ('policy-test-session', ${admin}::uuid, now(), now() + interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_approvals (id, action, object_type, object_id, requester_id, expires_at, nonce) values (${approval}::uuid, 'client_commercial_policy.control_v2', 'client_commercial_policy_control', ${objectId}::uuid, ${admin}::uuid, now() + interval '1 hour', 'policy-test-nonce')`,
    );
    await database.db.execute(
      sql`insert into expert_referral_admin_execution_results (approval_id, action, object_id, payload_hash, nonce_hash, requester_session_id_hash, expected_version, safe_result) values (${approval}::uuid, 'client_commercial_policy.control_v2', ${objectId}::uuid, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'policy-test-session', 0, '{"version":1,"admissionPolicy":"free_client_v2"}'::jsonb)`,
    );
    await database.db.execute(
      sql`insert into client_commercial_policy_controls (control_key, admission_policy, version, approval_id, admin_session_id_hash) values ('client_access', 'free_client_v2', 1, ${approval}::uuid, 'policy-test-session')`,
    );
  }, 120_000);
  afterAll(async () => database.stop());
  it("assigns one authoritative V2 result concurrently", async () => {
    const repository = new PostgresClientCommercialPolicyRepository(
      database.db,
    );
    const results = await Promise.all([
      repository.resolveOrAssign({ userId: user, allowV2Admission: true }),
      repository.resolveOrAssign({ userId: user, allowV2Admission: true }),
    ]);
    expect(results).toEqual(["free_client_v2", "free_client_v2"]);
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from client_commercial_policy_assignments where user_id=${user}::uuid`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });
  it("rejects a non-positive audit version", async () => {
    await expect(
      database.db.execute(
        sql`insert into expert_referral_admin_execution_results (approval_id, action, object_id, payload_hash, nonce_hash, requester_session_id_hash, expected_version, safe_result) values ('00000000-0000-4000-8000-000000000074'::uuid, 'client_commercial_policy.control_v2', ${objectId}::uuid, 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'policy-test-session', 0, '{"version":0,"admissionPolicy":"free_client_v2"}'::jsonb)`,
      ),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23514",
    );
  });
});
