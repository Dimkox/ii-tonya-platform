import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresCatalogRepository,
  PostgresClientCatalogRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  createClientCatalogOutboxRegistry,
  createClientCatalogSourceReader,
} from "../../apps/worker/src/client-catalog-outbox.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const digestFor = (userId: string) =>
  createHash("sha256")
    .update(`client-catalog-v1\0${userId}\0career\0ru`)
    .digest("hex");

const seedService = async (input: {
  name: string;
  active?: boolean;
  verified?: boolean;
  serviceActive?: boolean;
}) => {
  const expertUserId = await testDb.createUser();
  const expert = await testDb.db.execute<{ id: string }>(sql`
    insert into experts (user_id,public_display_name,active,verified)
    values (${expertUserId}::uuid,${input.name},${input.active ?? true},${input.verified ?? true})
    returning id
  `);
  const expertId = expert.rows[0]!.id;
  const service = await testDb.db.execute<{ id: string }>(sql`
    insert into expert_services (expert_id,name,code,language,active,duration_minutes)
    values (${expertId}::uuid,'Career','career','ru',${input.serviceActive ?? true},60)
    returning id
  `);
  return service.rows[0]!.id;
};

describe("PostgreSQL client catalog worker", () => {
  it("materializes only active verified public services with no source identifiers", async () => {
    await seedService({ name: "Visible" });
    await seedService({ name: "Inactive", active: false });
    await seedService({ name: "Unverified", verified: false });
    await seedService({ name: "Inactive service", serviceActive: false });
    const userId = await testDb.createUser();
    const requests = new PostgresClientCatalogRepository(testDb.db);
    const receipt = await requests.createOrReplay({
      userId,
      requestDigest: digestFor(userId),
      serviceCode: "career",
      language: "ru",
      correlationId: randomUUID(),
    });
    const registry = createClientCatalogOutboxRegistry({
      local: {
        topics: [
          "safety.operator_escalation",
          "admin.negative_feedback",
        ] as const,
        dispatch: async () => ({ kind: "applied" }),
        reconcile: async () => ({ kind: "applied" }),
      },
      requests,
      source: createClientCatalogSourceReader(
        new PostgresCatalogRepository(testDb.db),
      ),
    });

    await expect(
      registry.dispatch({
        id: randomUUID(),
        topic: "catalog.show",
        payload: { v: 1, catalogRequestId: receipt.catalogRequestId },
        correlationId: "not-exported",
        attempt: 1,
        reconciliationKey: "not-exported",
        reconciliationAttempt: 0,
        dispatchClaimToken: "claim",
        reconciliationClaimToken: null,
      }),
    ).resolves.toEqual({ kind: "applied" });

    const snapshot = await requests.getOwned({
      userId,
      catalogRequestId: receipt.catalogRequestId,
    });
    expect(snapshot).toEqual({
      catalogRequestId: receipt.catalogRequestId,
      state: "ready",
      cards: [
        {
          displayName: "Visible",
          serviceCode: "career",
          language: "ru",
          availability: "catalog_only",
          slots: [],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /expertId|serviceId|slotId|provider|contact|correlation/iu,
    );
  });

  it("orders and caps the authoritative service projection at twenty", async () => {
    for (let index = 24; index >= 0; index -= 1) {
      await seedService({ name: `Expert ${String(index).padStart(2, "0")}` });
    }
    const repository = new PostgresCatalogRepository(testDb.db);
    const services = await repository.listPublicServices({
      serviceCode: "career",
      language: "ru",
      limit: 20,
    });
    expect(services).toHaveLength(20);
    expect(services.map(({ displayName }) => displayName)).toEqual(
      Array.from({ length: 20 }, (_, index) =>
        `Expert ${String(index).padStart(2, "0")}`,
      ),
    );
  });
});
