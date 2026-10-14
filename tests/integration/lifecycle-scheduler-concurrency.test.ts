import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  seedLifecycleFixture,
  type LifecycleFixture,
} from "./lifecycle-scheduler.fixture.js";

describe("lifecycle scheduler concurrent claims", () => {
  let database: TestDatabase;
  let fixture: LifecycleFixture;

  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
    fixture = await seedLifecycleFixture(database);
    await fixture.repository.scheduleReservationLifecycle(
      fixture.reservationId,
    );
  }, 120_000);

  afterAll(async () => database.stop(), 120_000);

  it("materializes a due job exactly once across competing workers", async () => {
    const now = new Date(fixture.databaseNow.getTime() + 25 * 60 * 60 * 1_000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        fixture.repository.processDueLifecycleBatch({ now, batchSize: 1 }),
      ),
    );
    expect(
      results.reduce((total, result) => total + result.materialized, 0),
    ).toBe(1);

    const counts = await database.db.execute<{
      outbox: string;
      deliveries: string;
      sequence: string;
    }>(sql`
      select
        (select count(*)::text from integration_outbox
          where correlation_id like 'lifecycle:%') outbox,
        (select count(*)::text from dialogue_deliveries
          where source='deterministic') deliveries,
        (select next_delivery_sequence::text from dialogues
          where id=${fixture.dialogueId}::uuid) sequence
    `);
    expect(counts.rows[0]).toEqual({
      outbox: "1",
      deliveries: "1",
      sequence: "1",
    });
  });
});
