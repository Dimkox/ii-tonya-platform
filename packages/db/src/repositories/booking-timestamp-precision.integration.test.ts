import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PostgresBookingRepository } from "./booking-repository.js";
import {
  startDisposableTestPostgres,
  type TestDatabase,
} from "../testkit/postgres.js";

let database: TestDatabase;
let accountId = 123;
beforeAll(async () => {
  database = await startDisposableTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0]
      ?.server_version_num,
  ).toBe("170005");
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);

async function fixture() {
  const f = await database.createReservableFixture();
  const service = (
    await database.db.execute<{ id: string }>(
      sql`select expert_service_id as id from slots where id=${f.command.slotId}::uuid`,
    )
  ).rows[0]!;
  await database.db.execute(
    sql`update slots set provider='planerka' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) values(${service.id}::uuid,${++accountId},1,60,'UTC',true,clock_timestamp())`,
  );
  await database.db.execute(
    sql`update slots set observed_at=${f.command.now} where id=${f.command.slotId}::uuid`,
  );
  const repository = new PostgresBookingRepository(database.db);
  return { ...f, repository };
}

it("rejects an observation one microsecond beyond the supplied reserve instant", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update slots set observed_at=${f.command.now}::timestamptz+interval '1 microsecond' where id=${f.command.slotId}::uuid`,
  );
  expect(
    (
      await database.db.execute(
        sql`select resident_slot_fresh(id,${f.command.now}) as fresh from slots where id=${f.command.slotId}::uuid`,
      )
    ).rows[0]?.fresh,
  ).toBe(false);
  await expect(f.repository.reserve(f.command)).resolves.toEqual({
    kind: "unavailable",
    reason: "stale_slot",
  });
  expect(await database.reservationCountForKey(f.command.idempotencyKey)).toBe(
    0,
  );
});

it.each([
  ["future by one microsecond", "0.000001 seconds", false],
  ["exact current instant", "0 seconds", true],
  ["inside freshness by one microsecond", "-899.999999 seconds", true],
  ["exact fifteen-minute boundary", "-900 seconds", true],
  ["stale by one microsecond", "-900.000001 seconds", false],
] as const)(
  "confirms using exact SQL freshness: %s",
  async (_name, delta, fresh) => {
    const f = await fixture();
    const reservation = await f.repository.reserve(f.command);
    if (reservation.kind !== "reserved")
      throw Error("precision_reservation_missing");
    await database.db.execute(
      sql`update slots set observed_at=${f.command.now}::timestamptz+${delta}::interval where id=${f.command.slotId}::uuid`,
    );
    expect(
      (
        await database.db.execute(
          sql`select resident_slot_fresh(id,${f.command.now}) as fresh from slots where id=${f.command.slotId}::uuid`,
        )
      ).rows[0]?.fresh,
    ).toBe(fresh);
    const command = {
      reservationId: reservation.reservationId,
      expectedVersion: 1,
      action: "expert_confirm" as const,
      actor: { type: "expert" as const, id: f.expertId },
      now: f.command.now,
      correlationId: randomUUID(),
    };
    if (fresh) {
      await expect(f.repository.transition(command)).resolves.toMatchObject({
        status: "reserved",
        version: 2,
      });
    } else {
      await expect(f.repository.transition(command)).rejects.toThrow(
        "Slot observation is stale",
      );
    }
    const state = (
      await database.db.execute(
        sql`select r.status,r.version,(select count(*)::integer from planerka_booking_operations o where o.reservation_id=r.id) as operations from reservations r where r.id=${reservation.reservationId}::uuid`,
      )
    ).rows[0];
    expect(state).toEqual({
      status: "reserved",
      version: fresh ? 2 : 1,
      operations: fresh ? 1 : 0,
    });
    expect(await database.auditCountForCorrelation(command.correlationId)).toBe(
      fresh ? 1 : 0,
    );
  },
);
