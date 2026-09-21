import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

// DEC-PLT-004 §3: withdrawing the expert transfer consent is its own revocable fact, the note
// content withdrawal cascades to it (never the reverse), and both enqueue booking.handoff_revoked
// so receivers delete their copies in the same transaction.
let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

const repository = () =>
  new PostgresPrivacyRepository(testDb!.db, {
    privacyMutationCapability: { enabled: true },
  });

async function decisions(userId: string): Promise<Record<string, string>> {
  const rows = (
    await testDb!.db.execute<{ purpose: string; decision: string }>(sql`
      select distinct on (consent_type) consent_type as purpose, decision
      from consents where user_id = ${userId}::uuid
      order by consent_type, created_at desc, id desc
    `)
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.purpose, r.decision]));
}

async function handoffRevokeCount(correlationId: string): Promise<number> {
  const rows = (
    await testDb!.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from integration_outbox
      where correlation_id = ${correlationId} and topic = 'booking.handoff_revoked'
    `)
  ).rows;
  return rows[0]?.count ?? 0;
}

describe("expert_handoff consent withdrawal (DEC-PLT-004 §3)", () => {
  it("withdrawing expert_handoff records the denial and enqueues one revoke event", async () => {
    const userId = await testDb!.createUser();
    await repository().withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "expert_handoff",
      policyVersion: "handoff-v1",
      correlationId: "handoff-direct",
    });
    expect(await decisions(userId)).toMatchObject({ expert_handoff: "denied" });
    expect(await handoffRevokeCount("handoff-direct")).toBe(1);
  });

  it("withdrawing expert_note cascades a granted expert_handoff to revoked (never a fabricated first refusal) and enqueues one revoke event", async () => {
    const userId = await testDb!.createUser();
    await testDb!.db.execute(sql`
      insert into consents (user_id, consent_type, decision, policy_version)
      values (${userId}::uuid, 'expert_handoff', 'granted', 'handoff-v1')
    `);
    await repository().withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "expert_note",
      policyVersion: "note-v1",
      correlationId: "handoff-cascade",
    });
    const state = await decisions(userId);
    // RIGHTS-08: отзыв ранее выданного согласия отличается от первоначального отказа.
    // Заметка никому не выдавалась -> denied; передача была выдана -> revoked.
    expect(state).toMatchObject({
      expert_note: "denied",
      expert_handoff: "revoked",
    });
    const handoffState = (
      await testDb!.db.execute<{ decision: string; revision: string }>(sql`
        select decision, revision::text from consent_states
        where user_id = ${userId}::uuid and purpose = 'expert_handoff'
      `)
    ).rows[0];
    expect(handoffState?.decision).toBe("revoked");
    expect(Number(handoffState?.revision)).toBeGreaterThan(0);
    expect(await handoffRevokeCount("handoff-cascade")).toBe(1);
    // The cascaded fact records the handoff's own consent version, never the note's
    // (append-only provenance — DEC-PLT-004 §3).
    const handoffRows = (
      await testDb!.db.execute<{ decision: string; policyVersion: string }>(sql`
        select decision, policy_version as "policyVersion" from consents
        where user_id = ${userId}::uuid and consent_type = 'expert_handoff'
          and decision in ('denied', 'revoked')
      `)
    ).rows;
    expect(handoffRows.length).toBeGreaterThan(0);
    expect(handoffRows.every((row) => row.policyVersion === "handoff-v1")).toBe(
      true,
    );
    expect(handoffRows.some((row) => row.policyVersion === "note-v1")).toBe(
      false,
    );
  });

  it("withdrawing expert_handoff does NOT cascade expert_note (the reverse is forbidden)", async () => {
    const userId = await testDb!.createUser();
    await testDb!.db.execute(sql`
      insert into consents (user_id, consent_type, decision, policy_version)
      values (${userId}::uuid, 'expert_note', 'granted', 'note-v1')
    `);
    await repository().withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "expert_handoff",
      policyVersion: "handoff-v1",
      correlationId: "handoff-one-way",
    });
    expect(await decisions(userId)).toMatchObject({
      expert_note: "granted",
      expert_handoff: "denied",
    });
  });

  it("unrelated purpose withdrawals emit no handoff revoke event", async () => {
    const userId = await testDb!.createUser();
    await repository().withdrawConsentAtomically({
      targetUserId: userId,
      purpose: "client_profile",
      policyVersion: "profile-v1",
      correlationId: "handoff-none",
    });
    expect(await decisions(userId)).toEqual({ client_profile: "denied" });
    expect(await handoffRevokeCount("handoff-none")).toBe(0);
  });
});
