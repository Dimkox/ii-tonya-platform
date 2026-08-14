import { createHash } from "node:crypto";

import {
  createClientCatalogService,
  createClientSessionService,
  type IdentityProofVerifier,
} from "../../packages/application/src/index.js";
import {
  PostgresClientCatalogRepository,
  PostgresClientSessionRepository,
} from "../../packages/db/src/index.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const proof = (label: string) => `proof-${label}-${"P".repeat(32)}`;
const replayDigest = (label: string): `hmac-sha256:v1:${string}` =>
  `hmac-sha256:v1:${createHash("sha256").update(label).digest("hex")}`;

describe("client session to owned catalog acceptance", () => {
  it("binds catalog ownership, supports safe lost-response recovery, and creates no unrelated facts", async () => {
    const firstUserId = await testDb.createUser();
    const secondUserId = await testDb.createUser();
    const proofOwners = new Map([
      [proof("first"), firstUserId],
      [proof("second"), secondUserId],
      [proof("lost"), firstUserId],
      [proof("recovery"), firstUserId],
    ]);
    const verifier: IdentityProofVerifier = {
      async verify(input) {
        const userId = proofOwners.get(input.identityProof);
        return userId === undefined
          ? null
          : {
              userId,
              audience: input.expectedAudience,
              scope: input.expectedScope,
              expiresAt: new Date(Date.now() + 30 * 60_000),
              replayDigest: replayDigest(input.identityProof),
            };
      },
    };
    const sessions = new PostgresClientSessionRepository(testDb.db);
    const sessionService = createClientSessionService({
      verifier,
      sessions,
      generateToken: createClientSessionToken,
      digestToken: clientSessionTokenHash,
    });
    const catalogRepository = new PostgresClientCatalogRepository(testDb.db);
    const app = await buildTestApp({
      features: {
        workerOutboxDelivery: false,
        clientSession: true,
        clientCatalog: true,
        expertReferral: false,
        expertResidencyBilling: false,
      },
      clientSessionService: sessionService,
      clientSessionRepository: sessions,
      clientPrincipal: createClientPrincipalResolver(sessions),
      clientCatalogService: createClientCatalogService({
        repository: catalogRepository,
      }),
    });

    const firstIssue = await app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof("first") }),
    });
    expect(firstIssue.statusCode).toBe(201);
    const firstToken = firstIssue.json<{ accessToken: string }>().accessToken;
    const requested = await app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      headers: { authorization: `Bearer ${firstToken}` },
      payload: { serviceCode: "career", language: "ru" },
    });
    expect(requested.statusCode).toBe(202);
    const catalogRequestId = requested.json<{ catalogRequestId: string }>()
      .catalogRequestId;
    await catalogRepository.materialize({
      catalogRequestId,
      cards: [{
        displayName: "Public Expert",
        serviceCode: "career",
        language: "ru",
        availability: "catalog_only",
        slots: [],
      }],
    });
    const ownRead = await app.inject({
      method: "GET",
      url: `/v1/client/catalog-requests/${catalogRequestId}`,
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(ownRead.statusCode).toBe(200);

    const secondIssue = await app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof("second") }),
    });
    const secondToken = secondIssue.json<{ accessToken: string }>().accessToken;
    expect((await app.inject({
      method: "GET",
      url: `/v1/client/catalog-requests/${catalogRequestId}`,
      headers: { authorization: `Bearer ${secondToken}` },
    })).statusCode).toBe(404);

    expect((await app.inject({
      method: "DELETE",
      url: "/v1/client/sessions/current",
      headers: { authorization: `Bearer ${firstToken}` },
    })).statusCode).toBe(204);
    expect((await app.inject({
      method: "GET",
      url: `/v1/client/catalog-requests/${catalogRequestId}`,
      headers: { authorization: `Bearer ${firstToken}` },
    })).statusCode).toBe(401);
    await testDb.db.execute(sql`
      update users set active=false where id=${secondUserId}::uuid
    `);
    expect((await app.inject({
      method: "GET",
      url: `/v1/client/catalog-requests/${catalogRequestId}`,
      headers: { authorization: `Bearer ${secondToken}` },
    })).statusCode).toBe(401);

    expect((await app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof("lost") }),
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof("lost") }),
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "POST",
      url: "/v1/client/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ identityProof: proof("recovery") }),
    })).statusCode).toBe(201);

    const counts = await testDb.db.execute<{
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
    expect(counts.rows[0]).toEqual({
      catalogRequests: 1,
      catalogShowOutbox: 1,
      providerAttempts: 0,
      ledgerFacts: 0,
      reservations: 0,
      providerOperations: 0,
      payments: 0,
    });
    await app.close();
  });
});
