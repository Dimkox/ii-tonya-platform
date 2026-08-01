import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createPrivacyService } from "../../packages/application/src/privacy-service.js";
import {
  assertPrivacyWorkflowContract,
  PostgresPrivacyRepository,
} from "../../packages/db/src/repositories/privacy-repository.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

describe("PRIV-01 through PRIV-05 privacy workflow contract", () => {
  it("requires PostgreSQL atomicity, pseudonymous conservation, skip-locked retention, and backup expiry evidence", () => {
    expect(assertPrivacyWorkflowContract()).toEqual({
      postgresAuthoritative: true,
      immutableFactsRewritten: false,
      retentionClaim: "for_update_skip_locked",
      backupDeletionClaim: "expiry_evidence_only",
    });
  });

  it("rolls back a consent denial, profile cleanup, follow-up cancellation, audit, and outbox together", async () => {
    const userId = await testDb!.createUser();
    await testDb!.db.execute(sql`
      insert into client_profiles (user_id, display_name, timezone) values (${userId}::uuid, 'Private', 'Europe/Moscow')
    `);
    const repository = new PostgresPrivacyRepository(testDb!.db, {
      beforeWithdrawalAudit: () => { throw new Error("injected rollback"); },
      privacyMutationCapability: { enabled: true },
    });
    await expect(repository.withdrawConsentAtomically({
      targetUserId: userId, purpose: "client_profile", policyVersion: "privacy-v1", correlationId: "privacy-atomic",
    })).rejects.toThrow("injected rollback");
    const state = await testDb!.db.execute<{ consentCount: number; displayName: string | null; outboxCount: number }>(sql`
      select
        (select count(*)::integer from consents where user_id = ${userId}::uuid) as "consentCount",
        (select display_name from client_profiles where user_id = ${userId}::uuid) as "displayName",
        (select count(*)::integer from integration_outbox where correlation_id = 'privacy-atomic') as "outboxCount"
    `);
    expect(state.rows[0]).toEqual({ consentCount: 0, displayName: "Private", outboxCount: 0 });
  });

  it("erases identity mappings and optional content while conserving append-only ledger and audit facts under the internal UUID", async () => {
    const userId = await testDb!.createUser();
    await testDb!.db.execute(sql`
      insert into channel_identities (user_id, provider, external_id) values (${userId}::uuid, 'telegram', '12345')
    `);
    await testDb!.db.execute(sql`
      insert into client_profiles (user_id, display_name, timezone) values (${userId}::uuid, 'Private', 'Europe/Moscow')
    `);
    await testDb!.db.execute(sql`
      insert into conversations (id, user_id) values ('00000000-0000-4000-8000-000000000301'::uuid, ${userId}::uuid)
    `);
    await testDb!.db.execute(sql`
      insert into conversation_messages (conversation_id, author_type, content_ref) values ('00000000-0000-4000-8000-000000000301'::uuid, 'client', 'object://private')
    `);
    await testDb!.db.execute(sql`
      insert into message_packages (id, user_id, granted_messages, grant_idempotency_key) values ('00000000-0000-4000-8000-000000000302'::uuid, ${userId}::uuid, 1, ${`privacy-grant-${userId}`})
    `);
    await testDb!.db.execute(sql`
      insert into message_ledger_entries (package_id, entry_kind, delta, idempotency_key) values ('00000000-0000-4000-8000-000000000302'::uuid, 'grant', 1, ${`privacy-ledger-${userId}`})
    `);
    await testDb!.db.execute(sql`
      insert into audit_events (actor_type, actor_id, authenticated_session_id_hash, action, object_type, object_id, decision, reason_code, correlation_id, occurred_at, metadata_hash)
      values ('client', ${userId}::uuid, 'hash', 'privacy.seed', 'user', ${userId}::uuid, 'accepted', 'seed', 'privacy-seed', now(), 'hash')
    `);
    const processors = ["object_store", "selarti", "planerka", "make_projection"] as const;
    const repository = new PostgresPrivacyRepository(testDb!.db, {
      privacyMutationCapability: {
        enabled: true,
        captureManifests: async () => processors.map((processor) => ({
          processor,
          ciphertext: `ciphertext:${processor}`,
          keyReference: `test-key:${processor}`,
          algorithm: "test-envelope-v1",
          version: "1",
          subjectDeletionKeyHash: `sha256:${processor}`,
        })),
        verifyEnvelope: () => true,
      },
    });
    const service = createPrivacyService({
      repository,
      audit: { append: () => undefined },
      pseudonymize: () => "hmac:pseudonym",
      capability: { enabled: true },
    });
    const job = await service.eraseSubject({ principalUserId: userId, targetUserId: userId, correlationId: `erase:${userId}` });
    expect(job).toMatchObject({ contentRefsDeleted: 1, profileFieldsDeleted: 2, ledgerFactsPreserved: 1, auditFactsPreserved: 1 });
    const state = await testDb!.db.execute<{ identityCount: number; profileCount: number; contentRef: string | null; ledgerCount: number; auditCount: number; pseudonym: string | null }>(sql`
      select
        (select count(*)::integer from channel_identities where user_id = ${userId}::uuid) as "identityCount",
        (select count(*)::integer from client_profiles where user_id = ${userId}::uuid) as "profileCount",
        (select content_ref from conversation_messages where conversation_id = '00000000-0000-4000-8000-000000000301'::uuid) as "contentRef",
        (select count(*)::integer from message_ledger_entries where idempotency_key = ${`privacy-ledger-${userId}`}) as "ledgerCount",
        (select count(*)::integer from audit_events where actor_id = ${userId}::uuid) as "auditCount",
        (select evidence_pseudonym from privacy_deletion_jobs where id = ${job.jobId}::uuid) as pseudonym
    `);
    expect(state.rows[0]).toEqual({ identityCount: 0, profileCount: 0, contentRef: null, ledgerCount: 1, auditCount: 2, pseudonym: "hmac:pseudonym" });
  });
});
