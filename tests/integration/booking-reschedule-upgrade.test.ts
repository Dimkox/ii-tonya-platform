import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defaultMigrationsFolder,
  migrateDb,
} from "../../packages/db/src/client.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";

describe("booking reschedule replay migration upgrade", () => {
  let database: TestDatabase;
  let oldMigrationsFolder: string;

  beforeAll(async () => {
    database = await startTestPostgres();
    oldMigrationsFolder = await mkdtemp(
      join(tmpdir(), "ii-tonya-migrations-through-0072-"),
    );
    await cp(defaultMigrationsFolder, oldMigrationsFolder, {
      recursive: true,
    });
    await unlink(
      join(oldMigrationsFolder, "0073_booking_reschedule_replay.sql"),
    );
    const journalPath = join(oldMigrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 72);
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    await migrateDb(database.db, oldMigrationsFolder);
  }, 120_000);

  afterAll(async () => {
    if (database !== undefined) await database.stop();
    if (oldMigrationsFolder !== undefined)
      await rm(oldMigrationsFolder, { recursive: true, force: true });
  }, 120_000);

  it("marks multiple historical facts unrecoverable and preserves their immutable trigger", async () => {
    const fixture = await seedLifecycleFixture(database);
    const targetSlotId = (
      await database.db.execute<{ id: string }>(sql`
        insert into slots(
          expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
        )
        select expert_service_id,'local','upgrade-target',
          starts_at+interval '1 day',ends_at+interval '1 day',observed_at,capacity
        from slots where id=${fixture.slotId}::uuid
        returning id
      `)
    ).rows[0]!.id;
    const secondTargetSlotId = (
      await database.db.execute<{ id: string }>(sql`
        insert into slots(
          expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity
        )
        select expert_service_id,'local','upgrade-second-target',
          starts_at+interval '2 days',ends_at+interval '2 days',observed_at,capacity
        from slots where id=${fixture.slotId}::uuid
        returning id
      `)
    ).rows[0]!.id;
    await database.db.execute(sql`
      insert into booking_reschedule_facts(
        reservation_id,user_id,old_slot_id,new_slot_id,old_version,new_version,
        idempotency_key,correlation_id
      ) values(
        ${fixture.reservationId}::uuid,${fixture.userId}::uuid,
        ${fixture.slotId}::uuid,${targetSlotId}::uuid,1,2,
        ${"9".repeat(64)},'upgrade-existing-fact'
      )
    `);
    await database.db.execute(sql`
      insert into booking_reschedule_facts(
        reservation_id,user_id,old_slot_id,new_slot_id,old_version,new_version,
        idempotency_key,correlation_id
      ) values(
        ${fixture.reservationId}::uuid,${fixture.userId}::uuid,
        ${targetSlotId}::uuid,${secondTargetSlotId}::uuid,2,3,
        ${"8".repeat(64)},'upgrade-second-existing-fact'
      )
    `);

    await migrateDb(database.db, defaultMigrationsFolder);

    const result = await database.db.execute<{
      replayRecoverable: boolean;
      resultStatus: string | null;
      resultReservedUntil: Date | string | null;
    }>(sql`
      select f.result_status as "resultStatus",
        f.result_reserved_until as "resultReservedUntil",
        f.replay_recoverable as "replayRecoverable"
      from booking_reschedule_facts f
      where f.reservation_id=${fixture.reservationId}::uuid
      order by f.old_version
    `);
    expect(result.rows).toEqual([
      {
        replayRecoverable: false,
        resultStatus: null,
        resultReservedUntil: null,
      },
      {
        replayRecoverable: false,
        resultStatus: null,
        resultReservedUntil: null,
      },
    ]);
    await expect(
      new PostgresBookingRepository(database.db).rescheduleOwnedByHandle({
        userId: fixture.userId,
        bookingHandle: `bk1.${"A".repeat(43)}`,
        choiceDigest: `sha256:${"1".repeat(64)}`,
        idempotencyKey: "9".repeat(64),
        correlationId: "safe-unrecoverable-replay",
        confirmationBufferMs: 3_600_000,
      }),
    ).resolves.toEqual({ kind: "conflict" });
    const trigger = await database.db.execute<{ enabled: string }>(sql`
      select tgenabled as enabled from pg_trigger
      where tgname='booking_reschedule_facts_immutable_guard'
        and tgrelid='booking_reschedule_facts'::regclass
    `);
    expect(trigger.rows).toEqual([{ enabled: "O" }]);
  });
});
