import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresClientCatalogRepository } from "../../packages/db/src/index.js";
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

describe("client catalog final review closure", () => {
  it("bounds cleanup of a due tombstone whose outbox is already missing", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientCatalogRepository(testDb.db);
    const receipt = await repository.createOrReplay({
      userId,
      requestDigest: createHash("sha256")
        .update(`final-closure:${userId}`)
        .digest("hex"),
      correlationId: randomUUID(),
    });
    await testDb.db.execute(sql`
      delete from integration_outbox
      where idempotency_key=${`client-catalog:${receipt.catalogRequestId}`}
    `);
    await testDb.db.execute(sql`
      update client_catalog_requests
      set created_at=clock_timestamp()-interval '2 days',
        updated_at=clock_timestamp(),expires_at=clock_timestamp()-interval '1 second'
      where id=${receipt.catalogRequestId}::uuid
    `);

    await expect(
      repository.expireDue({ now: new Date(), limit: 1 }),
    ).resolves.toEqual({ examined: 2, expired: 1, removed: 1 });
    const facts = await testDb.db.execute<{
      tombstones: number;
      associations: number;
    }>(sql`
      select
        (select count(*)::integer from client_catalog_tombstones
          where request_id=${receipt.catalogRequestId}::uuid) as tombstones,
        (select count(*)::integer from client_catalog_erasure_index
          where request_id=${receipt.catalogRequestId}::uuid) as associations
    `);
    expect(facts.rows[0]).toEqual({ tombstones: 0, associations: 0 });
  });
});
