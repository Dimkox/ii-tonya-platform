import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresAdminRepository } from "../../packages/db/src/index.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
beforeAll(async () => { testDb = await startTestPostgres(); await testDb.migrate(); }, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

describe("admin ledger transaction", () => {
  it("atomically consumes one bound approval with the grant fact and allow audit", async () => {
    const requesterId = await testDb.createUser();
    const approverId = await testDb.createUser();
    const targetId = await testDb.createUser();
    const now = new Date();
    const payloadHash = "grant-payload-hash";
    const approval = await testDb.db.execute<{ id: string }>(sql`
      insert into admin_approvals (action, object_type, object_id, requester_id, approver_id, requester_session_id_hash, approver_session_id_hash, payload_hash, required_role, requester_mfa_verified_at, approver_mfa_verified_at, expires_at, nonce)
      values ('package.grant', 'user', ${targetId}::uuid, ${requesterId}::uuid, ${approverId}::uuid, 'requester-session', 'approver-session', ${payloadHash}, 'entitlement_admin', ${now}, ${now}, ${new Date(now.getTime() + 60_000)}, 'approval-nonce') returning id
    `);
    const approvalId = approval.rows[0]?.id;
    if (approvalId === undefined) throw new Error("Expected approval id");
    const repository = new PostgresAdminRepository(testDb.db);
    const command = { approvalId, requesterId, requesterSessionIdHash: "requester-session", payloadHash, action: "package.grant" as const, correlationId: "approved-grant", occurredAt: now, userId: targetId, units: 500 as const, kind: "admin" as const, expiresAt: new Date(now.getTime() + 60 * 24 * 60 * 60_000), idempotencyKey: "approved-grant-once" };
    const results = await Promise.all([repository.executeApprovedGrant(command), repository.executeApprovedGrant(command)]);
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(await testDb.packageBalance(targetId)).toBe(500);
    const facts = await testDb.db.execute<{ grants: string; allowed: string; denied: string }>(sql`
      select
        (select count(*)::text from message_ledger_entries where idempotency_key = 'grant:approved-grant-once') as grants,
        (select count(*)::text from audit_events where correlation_id = 'approved-grant' and decision = 'allowed') as allowed,
        (select count(*)::text from audit_events where correlation_id = 'approved-grant' and decision = 'denied') as denied
    `);
    expect(facts.rows[0]).toEqual({ grants: "1", allowed: "1", denied: "1" });
  });

  it("replays and concurrently consumes one idempotent admin grant without changing immutable facts", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresAdminRepository(testDb.db);
    const command = { userId, units: 500 as const, kind: "admin" as const, expiresAt: new Date("2026-09-26T10:00:00.000Z"), idempotencyKey: "admin-grant-replay" };
    const grants = await Promise.all([repository.grantPackage(command), repository.grantPackage(command)]);
    expect(grants[0]?.packageId).toBe(grants[1]?.packageId);
    expect(await testDb.packageBalance(userId)).toBe(500);
    const facts = await testDb.db.execute<{ count: string }>(sql`select count(*)::text as count from message_ledger_entries where idempotency_key = 'grant:admin-grant-replay'`);
    expect(facts.rows[0]?.count).toBe("1");
    await expect(testDb.db.execute(sql`update message_ledger_entries set delta = 999 where idempotency_key = 'grant:admin-grant-replay'`)).rejects.toThrow();
  });

  it("appends one non-positive revocation fact derived from current balance and preserves conservation", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresAdminRepository(testDb.db);
    const { packageId } = await repository.grantPackage({ userId, units: 1000, kind: "admin", expiresAt: new Date("2026-09-26T10:00:00.000Z"), idempotencyKey: "admin-grant-revoke" });
    const [first, second] = await Promise.all([repository.revokePackage({ packageId, idempotencyKey: "admin-revoke-once" }), repository.revokePackage({ packageId, idempotencyKey: "admin-revoke-once" })]);
    expect(first.delta).toBeLessThanOrEqual(0);
    expect(second.delta).toBeLessThanOrEqual(0);
    expect(await testDb.packageBalance(userId)).toBe(0);
    const revoke = await testDb.db.execute<{ count: string; original: string | null }>(sql`select count(*)::text as count, min(original_entry_id::text) as original from message_ledger_entries where idempotency_key = 'admin-revoke-once'`);
    expect(revoke.rows[0]).toMatchObject({ count: "1", original: expect.any(String) });
  });
});
