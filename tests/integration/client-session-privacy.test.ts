import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresClientSessionRepository,
  PostgresPrivacyRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const tokenDigest = (label: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(label).digest("hex")}`;
const replayDigest = (label: string): `hmac-sha256:v1:${string}` =>
  `hmac-sha256:v1:${createHash("sha256").update(label).digest("hex")}`;

const privacyRepository = () => {
  const processors = [
    "object_store",
    "selarti",
    "planerka",
    "make_projection",
  ] as const;
  return new PostgresPrivacyRepository(testDb.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        processors.map((processor) => ({
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
};

describe("PostgreSQL client session privacy lifecycle", () => {
  it("removes subject sessions, retains a non-linkable replay tombstone, then cleans it idempotently", async () => {
    const userId = await testDb.createUser();
    const otherUserId = await testDb.createUser();
    const sessions = new PostgresClientSessionRepository(testDb.db);
    const replay = replayDigest("erasure-replay");
    await expect(
      sessions.issue({
        userId,
        replayDigest: replay,
        proofExpiresAt: new Date(Date.now() + 30 * 60_000),
        tokenDigest: tokenDigest("erased-session"),
        scope: "client_catalog:read",
        maximumTtlMs: 3_600_000,
      }),
    ).resolves.toMatchObject({ kind: "issued" });

    await privacyRepository().startErasureAtomically({
      targetUserId: userId,
      correlationId: `erase:${userId}`,
      idempotencyKey: `erase:${userId}`,
      pseudonym: "hmac:client-session-erased",
    });

    const state = await testDb.db.execute<{
      active: boolean;
      sessions: number;
      receipts: number;
      linked: number;
    }>(sql`
      select u.active,
        (select count(*)::integer from client_sessions where user_id=${userId}::uuid) sessions,
        (select count(*)::integer from client_identity_proof_receipts
          where replay_digest=${replay}) receipts,
        (select count(*)::integer from client_identity_proof_receipts
          where replay_digest=${replay} and session_token_digest is not null) linked
      from users u where u.id=${userId}::uuid
    `);
    expect(state.rows[0]).toEqual({
      active: false,
      sessions: 0,
      receipts: 1,
      linked: 0,
    });
    await expect(
      sessions.issue({
        userId: otherUserId,
        replayDigest: replay,
        proofExpiresAt: new Date(Date.now() + 20 * 60_000),
        tokenDigest: tokenDigest("recreated-account"),
        scope: "client_catalog:read",
        maximumTtlMs: 3_600_000,
      }),
    ).resolves.toEqual({ kind: "denied" });

    await testDb.db.execute(sql`
      update client_identity_proof_receipts
      set created_at=clock_timestamp()-interval '2 hours',
        expires_at=clock_timestamp()-interval '1 hour'
      where replay_digest=${replay}
    `);
    await expect(sessions.cleanupExpired(10)).resolves.toEqual({
      receiptsRemoved: 1,
      sessionsRemoved: 0,
    });
    await expect(sessions.cleanupExpired(10)).resolves.toEqual({
      receiptsRemoved: 0,
      sessionsRemoved: 0,
    });
  });
});
