import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
  type ConstraintState,
  type IndexState,
} from "../../packages/db/src/testkit/migration-state.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";

const folder = "packages/db/migrations";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
let database: TestDatabase | undefined;
let output: string | undefined;
const legacyStates = [
  "completed",
  "no_show",
  "cancelled_by_client",
  "cancelled_by_expert",
  "expired",
] as const;
const legacyFixtures = new Map<
  (typeof legacyStates)[number],
  {
    reservationId: string;
    userId: string;
    expertId: string;
    handle: `bk1.${string}`;
  }
>();

async function seedLegacyBookings() {
  for (const status of legacyStates) {
    const userId = await database!.createUser();
    const slotId = await database!.createSlot({
      capacity: 1,
      startsAt: new Date(Date.now() + 172_800_000).toISOString(),
    });
    // Genuine pre0043 history, not approval with validation bypassed or a fake UID.
    const reservation = (
      await database!.db.execute<{ id: string; expertId: string }>(sql`
        insert into reservations (user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until)
        select ${userId}::uuid,s.id,es.expert_id,es.id,'booked',${randomUUID()},clock_timestamp()+interval '1 day'
        from slots s join expert_services es on es.id=s.expert_service_id
        where s.id=${slotId}::uuid
        returning id,expert_id as "expertId"
      `)
    ).rows[0]!;
    const handle =
      `bk1.${randomUUID().replaceAll("-", "").padEnd(43, "A")}` as const;
    await database!.db.execute(sql`
      insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id)
      values(${userId}::uuid,${`sha256:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`},${handle},${reservation.id}::uuid)
    `);
    legacyFixtures.set(status, {
      reservationId: reservation.id,
      userId,
      expertId: reservation.expertId,
      handle,
    });
  }
}

beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  const journal = read(`${folder}/meta/_journal.json`);
  for (const entry of journal.entries.filter(
    (e: { idx: number }) => e.idx <= 43,
  )) {
    if (entry.idx === 43) await seedLegacyBookings();
    await database.db.execute(
      sql.raw(readFileSync(`${folder}/${entry.tag}.sql`, "utf8")),
    );
  }
}, 120_000);

afterAll(async () => {
  try {
    await database?.stop();
  } finally {
    if (output) rmSync(output, { recursive: true, force: true });
  }
}, 120_000);

it("reproduces Planerka operation snapshot0043 from PostgreSQL with correct predecessor", async () => {
  const expected = read(`${folder}/meta/0043_snapshot.json`);
  expect(expected.prevId).toBe(read(`${folder}/meta/0042_snapshot.json`).id);
  output = mkdtempSync(join(tmpdir(), "ii-tonya-planerka-state-check-"));
  const connection = database!.db.$client.options.connectionString;
  if (!connection) throw new Error("test_connection_missing");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "introspect",
        "--dialect=postgresql",
        `--url=${connection}`,
        `--out=${output}`,
      ],
      { stdio: "ignore", timeout: 60_000 },
    );
    child.on("error", () => reject(new Error("introspection_failed")));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("introspection_failed")),
    );
  });
  const constraints = await database!.db.execute<
    ConstraintState & Record<string, unknown>
  >(sql.raw(constraintStateSql));
  const indexes = await database!.db.execute<
    IndexState & Record<string, unknown>
  >(sql.raw(indexStateSql));
  const actual = normalizeMigrationSnapshot(
    read(join(output, "meta/0000_snapshot.json")),
    { constraints: constraints.rows, indexes: indexes.rows },
  );
  actual.id = expected.id;
  actual.prevId = expected.prevId;
  expect(actual).toEqual(expected);
}, 90_000);

it("preserves Planerka operation constraints and append-only triggers in SQL-only evidence", async () => {
  const functions = await database!.db.execute(
    sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
  );
  const triggers = await database!.db.execute(
    sql`select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
  );
  const exclusionConstraints = await database!.db.execute(
    sql`select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='x' order by table_name,name`,
  );
  const extensions = await database!.db.execute(
    sql`select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`,
  );
  const constraints = await database!.db.execute(sql.raw(constraintStateSql));
  const indexes = await database!.db.execute(sql.raw(indexStateSql));
  expect({
    functions: functions.rows,
    triggers: triggers.rows,
    exclusionConstraints: exclusionConstraints.rows,
    extensions: extensions.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }).toEqual(read(`${folder}/state/0043_sql_objects.json`));
});

let currentRepositorySchemaApplied = false;

it.each(legacyStates)(
  "preserves legacy %s semantics in the active client list after migration0043",
  async (status) => {
    // Snapshot assertions above intentionally stop at0043. Current producer code
    // needs0044; apply it only for the subsequent repository behavior cases.
    if (!currentRepositorySchemaApplied) {
      await database!.db.execute(
        sql.raw(
          readFileSync(
            `${folder}/0044_booking_notification_delivery.sql`,
            "utf8",
          ),
        ),
      );
      currentRepositorySchemaApplied = true;
    }
    const fixture = legacyFixtures.get(status)!;
    const repository = new PostgresBookingRepository(database!.db);
    expect(
      await repository.listOwnedActive({ userId: fixture.userId }),
    ).toMatchObject({
      kind: "found",
      bookings: [
        { bookingHandle: fixture.handle, state: "confirmation_unverified" },
      ],
    });

    if (status === "expired") {
      // Model a legacy local expiry with unresolved external facts, not a new
      // booked -> expire domain action (which the booking state machine forbids).
      await database!.db.execute(sql`
        update reservations set status='expired',version=version+1
        where id=${fixture.reservationId}::uuid
      `);
    } else {
      const action = {
        completed: "complete",
        no_show: "mark_no_show",
        cancelled_by_client: "client_cancel",
        cancelled_by_expert: "expert_cancel",
      } as const;
      await repository.transition({
        reservationId: fixture.reservationId,
        expectedVersion: 1,
        action: action[status],
        actor:
          status === "completed"
            ? { type: "system", id: fixture.expertId }
            : status === "cancelled_by_client"
              ? { type: "client", id: fixture.userId }
              : { type: "expert", id: fixture.expertId },
        now: new Date(),
        correlationId: randomUUID(),
      });
    }

    const active = await repository.listOwnedActive({ userId: fixture.userId });
    if (status === "completed" || status === "no_show") {
      expect(active).toEqual({ kind: "found", bookings: [] });
    } else {
      expect(active).toMatchObject({
        kind: "found",
        bookings: [
          { bookingHandle: fixture.handle, state: "cancellation_pending" },
        ],
      });
    }
    // A hidden terminal receipt remains a valid pagination anchor, and its
    // legacy investigation stays unresolved rather than being silently closed.
    expect(
      await repository.listOwnedActive({
        userId: fixture.userId,
        after: fixture.handle,
      }),
    ).toEqual({ kind: "found", bookings: [] });
    expect(
      (
        await database!.db.execute(sql`
      select r.status,l.resolved_at,o.provider_uid
      from reservations r
      join planerka_legacy_booking_reviews l on l.reservation_id=r.id
      left join planerka_booking_operations o on o.reservation_id=r.id
      where r.id=${fixture.reservationId}::uuid
    `)
      ).rows,
    ).toEqual([{ status, resolved_at: null, provider_uid: null }]);
  },
);
