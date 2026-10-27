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
  it("does not schedule a reminder when an equal-time denial ties a grant", async () => {
    const tied = await seedLifecycleFixture(database);
    await database.db.execute(sql`
      with instant as materialized (select clock_timestamp() as at)
      insert into consents(id,user_id,consent_type,decision,policy_version,created_at)
      select decisions.id::uuid,${tied.userId}::uuid,'client_messaging',
        decisions.decision,'client-messaging-v1',instant.at
      from instant cross join (values
        ('ffffffff-ffff-4fff-8fff-ffffffffffff','granted'),
        ('00000001-0000-4000-8000-000000000001','denied')
      ) as decisions(id,decision)
    `);
    expect(
      await tied.repository.scheduleReservationLifecycle(tied.reservationId),
    ).toBe(0);
    expect(
      (
        await database.db.execute(sql`
      select count(*)::int n from lifecycle_jobs
      where subject_id=${tied.reservationId}::uuid
    `)
      ).rows[0]?.n,
    ).toBe(0);
  });
});
