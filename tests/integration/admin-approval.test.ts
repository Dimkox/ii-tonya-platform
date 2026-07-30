import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresAdminApprovalRepository,
  type AdminRole,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

const payload = { userId: "00000000-0000-4000-8000-000000000099", units: 500 };

async function seedAdmin(
  role: AdminRole,
  mfaOffset: string = "- 1 minute",
): Promise<{ adminId: string; sessionIdHash: string }> {
  const adminId = randomUUID();
  const sessionIdHash = `session:${randomUUID()}`;
  await testDb!.db.execute(sql`
    insert into users (id) values (${adminId}::uuid)
  `);
  await testDb!.db.execute(sql`
    insert into admin_sessions (
      session_id_hash, admin_id, mfa_verified_at, expires_at
    ) values (
      ${sessionIdHash}, ${adminId}::uuid,
      clock_timestamp() ${sql.raw(mfaOffset)},
      clock_timestamp() + interval '1 hour'
    )
  `);
  await testDb!.db.execute(sql`
    insert into admin_role_assignments (admin_id, role)
    values (${adminId}::uuid, ${role})
  `);
  return { adminId, sessionIdHash };
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("PostgreSQL admin approval lifecycle", () => {
  it("resolves a principal only from a valid platform session and DB-clock MFA", async () => {
    const valid = await seedAdmin("entitlement_admin");
    const stale = await seedAdmin("entitlement_admin", "- 16 minutes");
    const future = await seedAdmin("entitlement_admin", "+ 1 hour");
    const repository = new PostgresAdminApprovalRepository(testDb!.db);

    await expect(repository.resolvePrincipal(valid.sessionIdHash)).resolves.toMatchObject({
      id: valid.adminId,
      sessionIdHash: valid.sessionIdHash,
      roles: ["entitlement_admin"],
    });
    await expect(repository.resolvePrincipal(stale.sessionIdHash)).resolves.toBeNull();
    await expect(repository.resolvePrincipal(future.sessionIdHash)).resolves.toBeNull();
    await expect(repository.resolvePrincipal("not-a-session")).resolves.toBeNull();
  });

  it("persists a role-bound request and permits one distinct authenticated approval", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const approver = await seedAdmin("entitlement_admin");
    const repository = new PostgresAdminApprovalRepository(testDb!.db);
    const nonce = `nonce:${randomUUID()}`;

    const requested = await repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    });
    expect(requested).not.toBeNull();
    const timing = await testDb!.db.execute<{ seconds: string }>(sql`
      select extract(epoch from (expires_at - created_at))::text as seconds
      from admin_approvals where id = ${requested!.approvalId}::uuid
    `);
    expect(Number(timing.rows[0]?.seconds)).toBe(300);
    await expect(repository.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: requester.sessionIdHash,
    })).resolves.toBe(false);
    await expect(repository.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: approver.sessionIdHash,
    })).resolves.toBe(true);
    await expect(repository.consumeApproval({
      approvalId: randomUUID(),
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    })).resolves.toBeNull();

    const consume = () => repository.consumeApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    });
    const results = await Promise.all([consume(), consume()]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    await expect(repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    })).resolves.toBeNull();
  });

  it("binds role, action, object, canonical payload, nonce, and five-minute expiry", async () => {
    const requester = await seedAdmin("entitlement_admin");
    const wrongRole = await seedAdmin("support");
    const approver = await seedAdmin("entitlement_admin");
    const repository = new PostgresAdminApprovalRepository(testDb!.db);

    await expect(repository.requestApproval({
      sessionIdHash: wrongRole.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce: `nonce:${randomUUID()}`,
    })).resolves.toBeNull();

    const nonce = `nonce:${randomUUID()}`;
    const requested = await repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    });
    expect(requested).not.toBeNull();
    await expect(repository.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: wrongRole.sessionIdHash,
    })).resolves.toBe(false);
    await expect(repository.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: approver.sessionIdHash,
    })).resolves.toBe(true);

    for (const change of [
      { action: "package.revoke" as const },
      { objectId: randomUUID() },
      { payload: { ...payload, units: 1000 } },
      { nonce: `${nonce}:changed` },
    ]) {
      await expect(repository.consumeApproval({
        approvalId: requested!.approvalId,
        sessionIdHash: requester.sessionIdHash,
        action: "package.grant",
        objectType: "user",
        objectId: payload.userId,
        payload,
        nonce,
        ...change,
      })).resolves.toBeNull();
    }

    await testDb!.db.execute(sql`
      update admin_approvals
      set expires_at = clock_timestamp() - interval '1 millisecond'
      where id = ${requested!.approvalId}::uuid
    `);
    await expect(repository.consumeApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: payload.userId,
      payload,
      nonce,
    })).resolves.toBeNull();
  });

  it("stores explicit safety/feedback assignments", async () => {
    const principal = await seedAdmin("security_admin");
    const repository = new PostgresAdminApprovalRepository(testDb!.db);
    const assignedId = randomUUID();
    await testDb!.db.execute(sql`
      insert into admin_object_assignments (admin_id, object_type, object_id)
      values (${principal.adminId}::uuid, 'safety_case', ${assignedId}::uuid)
    `);
    await expect(repository.hasObjectAssignment({
      sessionIdHash: principal.sessionIdHash,
      objectType: "safety_case",
      objectId: assignedId,
    })).resolves.toBe(true);
    await expect(repository.hasObjectAssignment({
      sessionIdHash: principal.sessionIdHash,
      objectType: "feedback_queue",
      objectId: assignedId,
    })).resolves.toBe(false);
  });

  it("enforces mapped read assignments at request and re-checks them at consume", async () => {
    const requester = await seedAdmin("security_admin");
    const approver = await seedAdmin("security_admin");
    const repository = new PostgresAdminApprovalRepository(testDb!.db);
    const assignedId = randomUUID();
    const otherId = randomUUID();
    const nonce = `nonce:${randomUUID()}`;
    const readPayload = { caseId: assignedId };

    await expect(repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "safety_case",
      objectId: assignedId,
      payload: readPayload,
      nonce,
    })).resolves.toBeNull();
    await testDb!.db.execute(sql`
      insert into admin_object_assignments (admin_id, object_type, object_id)
      values (${requester.adminId}::uuid, 'safety_case', ${assignedId}::uuid)
    `);
    await expect(repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "feedback_queue",
      objectId: assignedId,
      payload: readPayload,
      nonce,
    })).resolves.toBeNull();
    await expect(repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "safety_case",
      objectId: otherId,
      payload: { caseId: otherId },
      nonce,
    })).resolves.toBeNull();

    const requested = await repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "safety_case",
      objectId: assignedId,
      payload: readPayload,
      nonce,
    });
    expect(requested).not.toBeNull();
    await expect(repository.approveApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: approver.sessionIdHash,
    })).resolves.toBe(true);
    await testDb!.db.execute(sql`
      delete from admin_object_assignments
      where admin_id = ${requester.adminId}::uuid
        and object_type = 'safety_case'
        and object_id = ${assignedId}::uuid
    `);
    await expect(repository.requestApproval({
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "safety_case",
      objectId: assignedId,
      payload: readPayload,
      nonce,
    })).resolves.toBeNull();
    await expect(repository.consumeApproval({
      approvalId: requested!.approvalId,
      sessionIdHash: requester.sessionIdHash,
      action: "safety.read",
      objectType: "safety_case",
      objectId: assignedId,
      payload: readPayload,
      nonce,
    })).resolves.toBeNull();
  });
});

describe("populated 0012 upgrade", () => {
  it("upgrades existing approvals and repairs pending nonce uniqueness", async () => {
    const legacy = await startTestPostgres();
    try {
      for (let index = 0; index <= 12; index += 1) {
        const prefix = index.toString().padStart(4, "0");
        const name = readdirSync("packages/db/migrations")
          .find((file) => file.startsWith(`${prefix}_`) && file.endsWith(".sql"));
        expect(name).toBeDefined();
        const sqlText = readFileSync(
          `packages/db/migrations/${name!}`,
          "utf8",
        );
        for (const statement of sqlText.split("--> statement-breakpoint")) {
          if (statement.trim()) await legacy.db.execute(sql.raw(statement));
        }
      }
      await legacy.db.execute(sql`
        insert into users (id) values
          ('00000000-0000-4000-8000-000000000081'::uuid),
          ('00000000-0000-4000-8000-000000000082'::uuid),
          ('00000000-0000-4000-8000-000000000084'::uuid);
        insert into admin_approvals (
          id, action, object_type, object_id, requester_id, approver_id,
          expires_at, nonce
        ) values (
          '00000000-0000-4000-8000-000000000083'::uuid,
          'package.grant', 'user',
          '00000000-0000-4000-8000-000000000099'::uuid,
          '00000000-0000-4000-8000-000000000081'::uuid,
          '00000000-0000-4000-8000-000000000082'::uuid,
          clock_timestamp() + interval '1 hour', 'legacy-nonce'
        ), (
          '00000000-0000-4000-8000-000000000085'::uuid,
          'package.grant', 'user',
          '00000000-0000-4000-8000-000000000099'::uuid,
          '00000000-0000-4000-8000-000000000081'::uuid,
          '00000000-0000-4000-8000-000000000084'::uuid,
          clock_timestamp() + interval '2 hours', 'legacy-nonce'
        )
      `);
      for (const index of [13, 14, 15]) {
        const prefix = index.toString().padStart(4, "0");
        const file = GetMigrationFile(prefix);
        const sqlText = readFileSync(file, "utf8");
        for (const statement of sqlText.split("--> statement-breakpoint")) {
          if (statement.trim()) await legacy.db.execute(sql.raw(statement));
        }
      }
      const columns = await legacy.db.execute<{ name: string }>(sql`
        select column_name as name from information_schema.columns
        where table_name = 'admin_approvals'
          and column_name in ('payload_hash', 'approved_at')
        order by column_name
      `);
      expect(columns.rows).toEqual([
        { name: "approved_at" },
        { name: "payload_hash" },
      ]);
      const legacyRows = await legacy.db.execute<{
        id: string;
        nonce: string;
        approverId: string;
      }>(sql`
        select id, nonce, approver_id as "approverId"
        from admin_approvals
        where id in (
          '00000000-0000-4000-8000-000000000083'::uuid,
          '00000000-0000-4000-8000-000000000085'::uuid
        )
        order by id
      `);
      expect(legacyRows.rows).toEqual([
        {
          id: "00000000-0000-4000-8000-000000000083",
          nonce: "legacy-nonce",
          approverId: "00000000-0000-4000-8000-000000000082",
        },
        {
          id: "00000000-0000-4000-8000-000000000085",
          nonce: "legacy-nonce",
          approverId: "00000000-0000-4000-8000-000000000084",
        },
      ]);

      await legacy.db.execute(sql`
        insert into admin_sessions (
          session_id_hash, admin_id, mfa_verified_at, expires_at
        ) values (
          'bound-session',
          '00000000-0000-4000-8000-000000000081'::uuid,
          clock_timestamp() - interval '1 minute',
          clock_timestamp() + interval '1 hour'
        );
        insert into admin_role_assignments (admin_id, role)
        values (
          '00000000-0000-4000-8000-000000000081'::uuid,
          'entitlement_admin'
        )
      `);
      const boundRepository = new PostgresAdminApprovalRepository(legacy.db);
      const first = await boundRepository.requestApproval({
        sessionIdHash: "bound-session",
        action: "package.grant",
        objectType: "user",
        objectId: "00000000-0000-4000-8000-000000000099",
        payload: { units: 500 },
        nonce: "bound-nonce",
      });
      expect(first).not.toBeNull();
      await expect(boundRepository.requestApproval({
        sessionIdHash: "bound-session",
        action: "package.grant",
        objectType: "user",
        objectId: "00000000-0000-4000-8000-000000000099",
        payload: { units: 1000 },
        nonce: "bound-nonce",
      })).resolves.toBeNull();
      const boundCount = await legacy.db.execute<{ count: string }>(sql`
        select count(*)::text as count from admin_approvals
        where requester_session_id_hash = 'bound-session'
          and nonce = 'bound-nonce'
      `);
      expect(boundCount.rows).toEqual([{ count: "1" }]);
    } finally {
      await legacy.stop();
    }
  }, 120_000);
});

function GetMigrationFile(prefix: string): string {
  const file = readdirSync("packages/db/migrations")
    .find((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
  if (file === undefined) throw new Error(`Migration ${prefix} not found`);
  return `packages/db/migrations/${file}`;
}
