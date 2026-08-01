import { randomUUID } from "node:crypto";
import { createAdminService } from "../../packages/application/src/index.js";
import {
  PostgresAdminApprovalRepository,
  PostgresAdminRepository,
  type AdminRole,
} from "../../packages/db/src/index.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAdminApi, hashAdminSessionToken } from "../../apps/api/src/routes/admin.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

async function seedAdmin(role: AdminRole, token: string) {
  const adminId = randomUUID();
  const sessionIdHash = hashAdminSessionToken(token);
  await testDb!.db.execute(sql`insert into users (id) values (${adminId}::uuid)`);
  await testDb!.db.execute(sql`
    insert into admin_sessions (session_id_hash, admin_id, mfa_verified_at, expires_at)
    values (${sessionIdHash}, ${adminId}::uuid, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour')
  `);
  await testDb!.db.execute(sql`
    insert into admin_role_assignments (admin_id, role) values (${adminId}::uuid, ${role})
  `);
  return { adminId, token };
}

describe("PostgreSQL-backed admin API", () => {
  it("binds request, distinct approval, execution, and safe replay to authenticated sessions", async () => {
    const requester = await seedAdmin("entitlement_admin", `requester-${randomUUID()}`);
    const approver = await seedAdmin("entitlement_admin", `approver-${randomUUID()}`);
    const userId = await testDb!.createUser();
    const approvals = new PostgresAdminApprovalRepository(testDb!.db);
    const admin = createAdminService({ workflows: new PostgresAdminRepository(testDb!.db) });
    const app = await buildAdminApi({ approvals, admin });
    const nonce = `nonce:${randomUUID()}`;
    const command = { units: 500, idempotencyKey: `grant:${randomUUID()}` };
    try {
      const requested = await app.inject({
        method: "POST",
        url: `/v1/admin/actions/package.grant/${userId}/approvals`,
        headers: { authorization: `Bearer ${requester.token}` },
        payload: { nonce, command },
      });
      expect(requested.statusCode).toBe(201);
      const approvalId = requested.json<{ approvalId: string }>().approvalId;

      const sameActor = await app.inject({
        method: "POST",
        url: `/v1/admin/approvals/${approvalId}/approve`,
        headers: { authorization: `Bearer ${requester.token}` },
      });
      expect(sameActor.statusCode).toBe(403);

      const approved = await app.inject({
        method: "POST",
        url: `/v1/admin/approvals/${approvalId}/approve`,
        headers: { authorization: `Bearer ${approver.token}` },
      });
      expect(approved.statusCode).toBe(204);

      const execution = {
        method: "POST" as const,
        url: `/v1/admin/actions/package.grant/${userId}/execute`,
        headers: { authorization: `Bearer ${requester.token}` },
        payload: {
          approvalId,
          nonce,
          correlationId: `admin:${randomUUID()}`,
          command,
        },
      };
      const first = await app.inject(execution);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ allowed: true, replayed: false });
      const replay = await app.inject(execution);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ allowed: true, replayed: true });

      const persisted = await testDb!.db.execute<{
        consumed: string;
        packages: string;
        grants: string;
        allowedAudits: string;
      }>(sql`
        select
          (select count(*)::text from admin_approvals where id = ${approvalId}::uuid and consumed_at is not null) as consumed,
          (select count(*)::text from message_packages where grant_idempotency_key = ${command.idempotencyKey}) as packages,
          (select count(*)::text from message_ledger_entries where idempotency_key = ${`admin:${command.idempotencyKey}:grant`}) as grants,
          (select count(*)::text from audit_events where action = 'package.grant.allowed' and object_id = ${userId}::uuid) as "allowedAudits"
      `);
      expect(persisted.rows[0]).toEqual({ consumed: "1", packages: "1", grants: "1", allowedAudits: "1" });
    } finally {
      await app.close();
    }
  });
});
