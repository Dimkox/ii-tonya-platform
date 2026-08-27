import { createHash } from "node:crypto";

import {
  createClientCatalogService,
  createClientSessionService,
  type IdentityProofVerifier,
} from "../../packages/application/src/index.js";
import {
  PostgresClientCatalogRepository,
  PostgresClientSessionRepository,
  PostgresPrivacyRepository,
} from "../../packages/db/src/index.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildTestApp } from "../../apps/api/src/app.js";
import { createClientPrincipalResolver } from "../../apps/api/src/client-principal-resolver.js";
import {
  clientSessionTokenHash,
  createClientSessionToken,
} from "../../apps/api/src/client-session-token.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
afterAll(async () => testDb?.stop(), 120_000);

const proof = (label: string) => `proof-${label}-${"P".repeat(32)}`;
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

describe("MVP-CLIENT-PRINCIPAL-001 final focused gate", () => {
  it("issues an opaque principal, enforces ownership and revocation, and erases without unrelated side effects", async () => {
    const ownerId = await testDb.createUser();
    const foreignId = await testDb.createUser();
    const sharedReplay = replayDigest("erased-proof");
    const identities = new Map([
      [proof("owner"), { userId: ownerId, replayDigest: sharedReplay }],
      [proof("foreign"), {
        userId: foreignId,
        replayDigest: replayDigest("foreign-proof"),
      }],
      [proof("replay-after-erasure"), {
        userId: foreignId,
        replayDigest: sharedReplay,
      }],
    ]);
    const verifier: IdentityProofVerifier = {
      async verify(input) {
        const identity = identities.get(input.identityProof);
        return identity === undefined
          ? null
          : {
              ...identity,
              audience: input.expectedAudience,
              scope: input.expectedScope,
              expiresAt: new Date(Date.now() + 30 * 60_000),
            };
      },
    };
    const sessions = new PostgresClientSessionRepository(testDb.db);
    const catalog = new PostgresClientCatalogRepository(testDb.db);
    const app = await buildTestApp({
      features: {
        workerOutboxDelivery: false,
        clientSession: true,
        clientCatalog: true,
        expertReferral: false,
        expertResidencyBilling: false,
      },
      clientSessionService: createClientSessionService({
        verifier,
        sessions,
        generateToken: createClientSessionToken,
        digestToken: clientSessionTokenHash,
      }),
      clientSessionRepository: sessions,
      clientPrincipal: createClientPrincipalResolver(sessions),
      clientCatalogService: createClientCatalogService({ repository: catalog }),
    });

    try {
      const ownerIssue = await app.inject({
        method: "POST",
        url: "/v1/client/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ identityProof: proof("owner") }),
      });
      expect(ownerIssue.statusCode).toBe(201);
      const ownerToken = ownerIssue.json<{ accessToken: string }>().accessToken;
      expect(ownerToken).toMatch(/^cs1\.[A-Za-z0-9_-]{43}$/u);
      const persisted = await testDb.db.execute<{ tokenDigest: string }>(sql`
        select token_digest as "tokenDigest" from client_sessions
        where user_id=${ownerId}::uuid
      `);
      expect(persisted.rows).toEqual([{
        tokenDigest: clientSessionTokenHash(ownerToken as `cs1.${string}`),
      }]);
      expect(JSON.stringify(persisted.rows)).not.toContain(ownerToken);

      expect((await app.inject({
        method: "GET",
        url: "/v1/client/catalog-requests/00000000-0000-4000-8000-000000000001",
        headers: { authorization: `Token ${ownerToken}` },
      })).statusCode).toBe(401);

      const requested = await app.inject({
        method: "POST",
        url: "/v1/client/catalog-requests",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { serviceCode: "career", language: "ru" },
      });
      expect(requested.statusCode).toBe(202);
      const catalogRequestId = requested.json<{ catalogRequestId: string }>()
        .catalogRequestId;
      await catalog.materialize({
        catalogRequestId,
        cards: [{
          displayName: "Public Expert",
          serviceCode: "career",
          language: "ru",
          availability: "catalog_only",
          slots: [],
        }],
      });
      expect((await app.inject({
        method: "GET",
        url: `/v1/client/catalog-requests/${catalogRequestId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      })).statusCode).toBe(200);

      const foreignIssue = await app.inject({
        method: "POST",
        url: "/v1/client/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ identityProof: proof("foreign") }),
      });
      expect(foreignIssue.statusCode).toBe(201);
      const foreignToken = foreignIssue.json<{ accessToken: string }>().accessToken;
      expect((await app.inject({
        method: "GET",
        url: `/v1/client/catalog-requests/${catalogRequestId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      })).statusCode).toBe(404);

      const sideEffects = await testDb.db.execute<{
        catalogRequests: number;
        catalogShowOutbox: number;
        providerAttempts: number;
        ledgerFacts: number;
        reservations: number;
        providerOperations: number;
        payments: number;
      }>(sql`
        select
          (select count(*)::integer from client_catalog_requests) "catalogRequests",
          (select count(*)::integer from integration_outbox where topic='catalog.show') "catalogShowOutbox",
          (select count(*)::integer from delivery_attempts) "providerAttempts",
          (select count(*)::integer from message_ledger_entries) "ledgerFacts",
          (select count(*)::integer from reservations) reservations,
          (select count(*)::integer from expert_residency_provider_operations) "providerOperations",
          (select count(*)::integer from expert_residency_payment_attempts) payments
      `);
      expect(sideEffects.rows[0]).toEqual({
        catalogRequests: 1,
        catalogShowOutbox: 1,
        providerAttempts: 0,
        ledgerFacts: 0,
        reservations: 0,
        providerOperations: 0,
        payments: 0,
      });

      await privacyRepository().startErasureAtomically({
        targetUserId: ownerId,
        correlationId: `erase:${ownerId}`,
        idempotencyKey: `erase:${ownerId}`,
        pseudonym: "hmac:client-principal-final-gate",
      });
      expect((await app.inject({
        method: "GET",
        url: `/v1/client/catalog-requests/${catalogRequestId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      })).statusCode).toBe(401);
      expect((await app.inject({
        method: "POST",
        url: "/v1/client/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ identityProof: proof("replay-after-erasure") }),
      })).statusCode).toBe(401);

      const erased = await testDb.db.execute<{
        active: boolean;
        sessions: number;
        receipts: number;
        linked: number;
      }>(sql`
        select u.active,
          (select count(*)::integer from client_sessions where user_id=${ownerId}::uuid) sessions,
          (select count(*)::integer from client_identity_proof_receipts
            where replay_digest=${sharedReplay}) receipts,
          (select count(*)::integer from client_identity_proof_receipts
            where replay_digest=${sharedReplay} and session_token_digest is not null) linked
        from users u where u.id=${ownerId}::uuid
      `);
      expect(erased.rows[0]).toEqual({
        active: false,
        sessions: 0,
        receipts: 1,
        linked: 0,
      });

      await testDb.db.execute(sql`
        update client_identity_proof_receipts
        set created_at=clock_timestamp()-interval '2 hours',
          expires_at=clock_timestamp()-interval '1 hour'
        where replay_digest=${sharedReplay}
      `);
      await expect(sessions.cleanupExpired(10)).resolves.toEqual({
        receiptsRemoved: 1,
        sessionsRemoved: 0,
      });
    } finally {
      await app.close();
    }
  });
});
