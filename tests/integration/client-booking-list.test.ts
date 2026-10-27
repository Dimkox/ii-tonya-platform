import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  migrateDb,
  type DrizzleDb,
} from "../../packages/db/src/client.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startExternalPostgresDatabase,
  type ExternalPostgresDatabase,
} from "../../packages/db/src/testkit/external-postgres.js";

const owner = randomUUID();
const foreign = randomUUID();
const empty = randomUUID();
const handle = (i: number): `bk1.${string}` =>
  `bk1.${String(i).padStart(43, "0")}`;
let db: DrizzleDb;
let external: ExternalPostgresDatabase;

describe("active booking owner keyset pages", () => {
  beforeAll(async () => {
    const url = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
    if (!url) throw new Error("explicit PG17.5 required");
    external = await startExternalPostgresDatabase(url);
    db = createDb(external.getConnectionUri());
    const version = (
      await db.execute<{ version: string }>(sql`show server_version`)
    ).rows[0];
    expect(version?.version ?? Object.values(version ?? {})[0]).toMatch(
      /^17\.5/,
    );
    await migrateDb(db, "packages/db/migrations");
    await db.execute(
      sql`insert into users(id) values (${owner}::uuid), (${foreign}::uuid), (${empty}::uuid)`,
    );
    const expert = randomUUID();
    const service = randomUUID();
    await db.execute(
      sql`insert into experts(id,user_id,public_display_name,active,verified) values (${expert}::uuid,${empty}::uuid,'Fixture',true,true)`,
    );
    await db.execute(
      sql`insert into expert_services(id,expert_id,name,code,language,active,duration_minutes) values (${service}::uuid,${expert}::uuid,'Career','career','ru',true,60)`,
    );
    for (let i = 0; i < 23; i++) {
      const slot = randomUUID();
      const reservation = randomUUID();
      const user = i === 22 ? foreign : owner;
      await db.execute(sql`insert into slots(id,expert_service_id,provider,external_slot_id,starts_at,ends_at,observed_at,capacity)
        values (${slot}::uuid,${service}::uuid,'local',${`page-${i}`},now()+(${i}+48)*interval '1 hour',now()+(${i}+49)*interval '1 hour',now(),1)`);
      await db.execute(sql`insert into reservations(id,user_id,slot_id,expert_id,expert_service_id,status,reserved_until,idempotency_key)
        values (${reservation}::uuid,${user}::uuid,${slot}::uuid,${expert}::uuid,${service}::uuid,${i === 21 ? "cancelled_by_client" : "reserved"},now()+interval '24 hours',${`page-${i}`})`);
      await db.execute(sql`insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id,created_at)
        values (${user}::uuid,${`sha256:${String(i).padStart(64, "0")}`},${handle(i)},${reservation}::uuid,'2026-10-06T00:00:00.000001Z')`);
    }
  }, 120_000);
  afterAll(async () => {
    if (db) await closeDb(db);
    if (external) await external.stop();
  }, 120_000);

  it("returns no rows for an unrelated owner and at most 21 for page lookahead", async () => {
    const repo = new PostgresBookingRepository(db);
    expect(await repo.listOwnedActive({ userId: empty })).toEqual({
      kind: "found",
      bookings: [],
    });
    const result = await repo.listOwnedActive({ userId: owner });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("missing page");
    expect(result.bookings.map((b) => b.bookingHandle)).toEqual(
      Array.from({ length: 21 }, (_, i) => handle(i)),
    );
    expect(Object.keys(result.bookings[0]!).sort()).toEqual([
      "bookingHandle",
      "reservedUntil",
      "startsAt",
      "state",
    ]);
  });
  it("makes missing and foreign cursors indistinguishable", async () => {
    const repo = new PostgresBookingRepository(db);
    expect(
      await repo.listOwnedActive({ userId: owner, after: handle(22) }),
    ).toEqual({ kind: "not_found" });
    expect(
      await repo.listOwnedActive({ userId: owner, after: handle(999) }),
    ).toEqual({ kind: "not_found" });
  });
  it("continues after a cancelled anchor without losing timestamp precision", async () => {
    await db.execute(
      sql`update reservations set status='cancelled_by_client' where id=(select reservation_id from client_booking_receipts where booking_handle=${handle(19)})`,
    );
    const result = await new PostgresBookingRepository(db).listOwnedActive({
      userId: owner,
      after: handle(19),
    });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("missing page");
    expect(result.bookings.map((b) => b.bookingHandle)).toEqual([handle(20)]);
  });
});
