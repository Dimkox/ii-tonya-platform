import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PostgresPlanerkaAvailabilityRepository } from "../../packages/db/src/index.js";
import { PostgresCatalogRepository } from "../../packages/db/src/repositories/catalog-repository.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  PostgresPlanerkaBookingRepository,
  planerkaRequestFingerprint,
} from "../../packages/db/src/repositories/planerka-booking-repository.js";
import { createDb, closeDb } from "../../packages/db/src/client.js";
import { createPlanerkaClient } from "@ii-tonya/integrations";
import { runPlanerkaAvailabilityOnce } from "../../packages/worker/src/planerka-availability.js";
import { runPlanerkaBookingOnce } from "../../packages/worker/src/planerka-booking-dispatcher.js";
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

let database: TestDatabase;
let account = 1000;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);
async function fixture(refreshLegacyObservation = true) {
  const slotId = await database.createSlot({
    capacity: 1,
    startsAt: new Date(Date.now() + 172800000).toISOString(),
    observedAt: new Date().toISOString(),
  });
  const row = (
    await database.db.execute<{
      serviceId: string;
      expertId: string;
      startsAt: Date;
      endsAt: Date;
    }>(sql`
    update slots set provider='planerka' where id=${slotId}::uuid returning expert_service_id as "serviceId",starts_at as "startsAt",ends_at as "endsAt"
  `)
  ).rows[0]!;
  await database.db.execute(
    sql`update expert_services set code='consultation',language='ru' where id=${row.serviceId}::uuid`,
  );
  const accountId = ++account;
  await database.db.execute(
    sql`insert into planerka_service_mappings values(${row.serviceId}::uuid,${accountId},7,60,'UTC',true,clock_timestamp())`,
  );
  // Most fixtures represent an already observed calendar. The INSERT regression
  // below deliberately omits this independent synthetic observation.
  if (refreshLegacyObservation)
    await database.db.execute(
      sql`update slots set observed_at=clock_timestamp() where id=${slotId}::uuid`,
    );
  const repository = new PostgresPlanerkaAvailabilityRepository(database.db);
  const catalog = new PostgresCatalogRepository(database.db);
  const times = [
    {
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
    },
  ];
  const due = () =>
    database.db.execute(
      sql`update planerka_availability_refreshes set next_attempt_at=clock_timestamp()-interval '1 second',lease_until=case when lease_token is null then null else clock_timestamp()-interval '1 second' end where expert_service_id=${row.serviceId}::uuid`,
    );
  return {
    ...row,
    slotId,
    accountId,
    repository,
    catalog,
    times,
    due,
    read: () =>
      catalog.read({ sourceKey: row.serviceId, databaseNow: new Date() }),
    claim: async () => {
      const c = await repository.claim(accountId);
      expect(c).toBeDefined();
      return c!;
    },
  };
}
it("reuses legacy UUIDs, keeps reservations and retires only the covered window", async () => {
  const f = await fixture();
  const first = await f.claim();
  expect(await f.repository.publish(first, f.times)).toBe(true);
  expect(await f.read()).toMatchObject({
    kind: "complete",
    slots: [
      { localSlotId: f.slotId, startsAt: new Date(f.times[0]!.startsAt) },
    ],
  });
  const userId = await database.createUser();
  const reservation = await new PostgresBookingRepository(database.db).reserve({
    userId,
    slotId: f.slotId,
    now: new Date(),
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 3600000,
  });
  expect(reservation.kind).not.toBe("unavailable");
  await f.due();
  expect(await f.repository.publish(await f.claim(), f.times)).toBe(true);
  expect(await f.read()).toEqual({ kind: "complete", slots: [] });
  await database.db.execute(
    sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at) values(${f.serviceId}::uuid,'planerka',${randomUUID()},clock_timestamp()+interval '10 days',clock_timestamp()+interval '10 days 1 hour',1,clock_timestamp())`,
  );
  await f.due();
  expect(await f.repository.publish(await f.claim(), [])).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select id,observed_at,capacity from slots where id=${f.slotId}::uuid`,
      )
    ).rows,
  ).toEqual([{ id: f.slotId, observed_at: null, capacity: 1 }]);
  expect(
    (
      await database.db.execute(
        sql`select status from reservations where slot_id=${f.slotId}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "reserved" }]);
  expect(
    (
      await database.db.execute(
        sql`select id from slots where expert_service_id=${f.serviceId}::uuid and observed_at is not null`,
      )
    ).rows,
  ).toHaveLength(1);
});
it("fences an expired older response and defer after a newer empty watermark", async () => {
  const f = await fixture();
  const old = await f.claim();
  expect(await f.repository.claim(f.accountId)).toBeUndefined();
  await f.due();
  const current = await f.claim();
  expect(await f.repository.publish(current, [])).toBe(true);
  expect(await f.repository.publish(old, f.times)).toBe(false);
  expect(await f.repository.defer(old, "provider_unavailable")).toBe(false);
  expect(await f.read()).toEqual({ kind: "complete", slots: [] });
});
it.each(["remap", "disable", "delete", "duration", "timezone", "verification"])(
  "invalidates observations and leases on mapping %s",
  async (change) => {
    const f = await fixture();
    const c = await f.claim();
    if (change === "delete")
      await database.db.execute(
        sql`delete from planerka_service_mappings where expert_service_id=${f.serviceId}::uuid`,
      );
    else {
      const set = {
        remap: "event_type_id=8",
        disable: "enabled=false",
        duration: "duration_minutes=30",
        timezone: "time_zone='Europe/Moscow'",
        verification: "verified_at=clock_timestamp()+interval '1 hour'",
      }[change]!;
      await database.db.execute(
        sql`update planerka_service_mappings set ${sql.raw(set)} where expert_service_id=${f.serviceId}::uuid`,
      );
    }
    expect(await f.repository.publish(c, f.times)).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select observed_at from slots where id=${f.slotId}::uuid`,
        )
      ).rows,
    ).toEqual([{ observed_at: null }]);
  },
);
it.each(["service", "expert", "verified"])(
  "rechecks %s eligibility after network work",
  async (change) => {
    const f = await fixture();
    const c = await f.claim();
    if (change === "service")
      await database.db.execute(
        sql`update expert_services set active=false where id=${f.serviceId}::uuid`,
      );
    else
      await database.db.execute(
        sql`update experts set ${sql.raw(change === "expert" ? "active=false" : "verified=false")} where id=(select expert_id from expert_services where id=${f.serviceId}::uuid)`,
      );
    expect(await f.repository.publish(c, f.times)).toBe(false);
    expect(await f.read()).toEqual({ kind: "complete", slots: [] });
  },
);
it("rejects altered claim fields and rolls back conflicting intervals atomically", async () => {
  const f = await fixture();
  const c = await f.claim();
  expect(await f.repository.publish({ ...c, eventTypeId: 88 }, [])).toBe(false);
  await expect(
    f.repository.publish(c, [
      {
        ...f.times[0]!,
        endsAt: new Date(Date.parse(f.times[0]!.endsAt) + 60000).toISOString(),
      },
    ]),
  ).rejects.toThrow();
  expect(await f.repository.publish(c, f.times)).toBe(true);
});
it.each(["duplicate", "capacity", "end"])(
  "rejects legacy %s conflicts without freshening rows",
  async (mode) => {
    const f = await fixture();
    const c = await f.claim();
    if (mode === "capacity")
      await database.db.execute(
        sql`update slots set capacity=2 where id=${f.slotId}::uuid`,
      );
    else if (mode === "end")
      await database.db.execute(
        sql`update slots set ends_at=ends_at+interval '30 minutes' where id=${f.slotId}::uuid`,
      );
    else
      await database.db.execute(
        sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity) select expert_service_id,provider,${randomUUID()},starts_at,ends_at,1 from slots where id=${f.slotId}::uuid`,
      );
    await expect(f.repository.publish(c, f.times)).rejects.toThrow(
      "planerka_availability_slot_conflict",
    );
  },
);
it("filters 501 stale rows and near/past rows before the limit, preserving a fresh choice", async () => {
  const f = await fixture();
  await database.db
    .execute(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at)
    select ${f.serviceId}::uuid,'planerka','stale-'||${f.serviceId}||g,clock_timestamp()+interval '25 hours'+g*interval '1 second',clock_timestamp()+interval '26 hours'+g*interval '1 second',1,clock_timestamp()-interval '16 minutes' from generate_series(1,501) g`);
  await database.db
    .execute(sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at)
    select ${f.serviceId}::uuid,'planerka','near-'||${f.serviceId}||g,clock_timestamp()+g*interval '1 hour',clock_timestamp()+(g+1)*interval '1 hour',1,clock_timestamp() from generate_series(-1,23) g`);
  const result = await f.read();
  expect(result).toMatchObject({
    kind: "complete",
    slots: [{ localSlotId: f.slotId }],
  });
  if (result.kind === "complete") expect(result.slots).toHaveLength(1);
  const now = new Date();
  expect(
    (
      await f.catalog.findEligible({
        from: now,
        to: new Date(now.getTime() + 604800000),
        now,
        minimumLeadMs: 86400000,
        requireExpertActive: true,
        requireExpertVerified: true,
        requireServiceActive: true,
      })
    ).filter((r) => r.slotId === f.slotId),
  ).toHaveLength(1);
  await database.db.execute(
    sql`update planerka_service_mappings set enabled=false where expert_service_id=${f.serviceId}::uuid`,
  );
  expect(
    (
      await f.catalog.findEligible({
        from: now,
        to: new Date(now.getTime() + 604800000),
        now,
        minimumLeadMs: 86400000,
        requireExpertActive: true,
        requireExpertVerified: true,
        requireServiceActive: true,
      })
    ).filter((r) => r.slotId === f.slotId),
  ).toHaveLength(0);
});
it("serializes competing claims and preserves generated slot identities across snapshots", async () => {
  const f = await fixture();
  const claims = await Promise.all([
    f.repository.claim(f.accountId),
    f.repository.claim(f.accountId),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const c = claims.find(Boolean)!;
  const times = [
    {
      startsAt: new Date(
        Date.parse(c.windowStart) + 3 * 86400000,
      ).toISOString(),
      endsAt: new Date(
        Date.parse(c.windowStart) + 3 * 86400000 + 3600000,
      ).toISOString(),
    },
  ];
  expect(await f.repository.publish(c, times)).toBe(true);
  const first = await f.read();
  await f.due();
  expect(await f.repository.publish(await f.claim(), times)).toBe(true);
  const second = await f.read();
  if (first.kind !== "complete" || second.kind !== "complete")
    throw new Error("catalog_unavailable");
  expect(first.slots).toHaveLength(1);
  expect(second.slots[0]!.localSlotId).toBe(first.slots[0]!.localSlotId);
});
it("rolls back availability immediately when a current slot is held by booking", async () => {
  const f = await fixture();
  const c = await f.claim();
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const transaction = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from slots where id=${f.slotId}::uuid for update`,
    );
    locked();
    await held;
  });
  await ready;
  try {
    await expect(f.repository.publish(c, [])).rejects.toThrow(
      "planerka_availability_busy",
    );
    // While booking still owns the slot, its later mapping lock must be free.
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from planerka_service_mappings where expert_service_id=${f.serviceId}::uuid for share nowait`,
      );
    });
  } finally {
    release();
    await transaction;
  }
  expect(
    (
      await database.db.execute(
        sql`select observed_at from slots where id=${f.slotId}::uuid`,
      )
    ).rows[0]!.observed_at,
  ).not.toBeNull();
}, 2000);
it("preserves successful freshness when deferring a failed refresh", async () => {
  const f = await fixture();
  expect(await f.repository.publish(await f.claim(), f.times)).toBe(true);
  const before = (
    await database.db.execute(
      sql`select observed_at from slots where id=${f.slotId}::uuid`,
    )
  ).rows;
  await f.due();
  expect(
    await f.repository.defer(await f.claim(), "provider_unavailable"),
  ).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select observed_at from slots where id=${f.slotId}::uuid`,
      )
    ).rows,
  ).toEqual(before);
  expect(await f.repository.claim(f.accountId)).toBeUndefined();
});
it("omits an occupied row while preserving another fresh choice in the same service", async () => {
  const f = await fixture();
  const userId = await database.createUser();
  await new PostgresBookingRepository(database.db).reserve({
    userId,
    slotId: f.slotId,
    now: new Date(),
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 3600000,
  });
  const row = (
    await database.db.execute<{ id: string }>(
      sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at) select expert_service_id,provider,${randomUUID()},starts_at+interval '2 hours',ends_at+interval '2 hours',1,clock_timestamp() from slots where id=${f.slotId}::uuid returning id`,
    )
  ).rows[0]!;
  expect(await f.read()).toMatchObject({
    kind: "complete",
    slots: [{ localSlotId: row.id }],
  });
});
it("invalidates both services when a mapping is moved to a different service", async () => {
  const f = await fixture();
  const claim = await f.claim();
  const destination = await database.createSlot({
    capacity: 1,
    startsAt: new Date(Date.now() + 172800000).toISOString(),
    observedAt: new Date().toISOString(),
  });
  const row = (
    await database.db.execute<{ id: string }>(
      sql`update slots set provider='planerka' where id=${destination}::uuid returning expert_service_id as id`,
    )
  ).rows[0]!;
  await database.db.execute(
    sql`update planerka_service_mappings set expert_service_id=${row.id}::uuid where expert_service_id=${f.serviceId}::uuid`,
  );
  expect(await f.repository.publish(claim, f.times)).toBe(false);
  expect(
    (
      await database.db.execute(
        sql`select observed_at from slots where id in (${f.slotId}::uuid,${destination}::uuid)`,
      )
    ).rows,
  ).toEqual([{ observed_at: null }, { observed_at: null }]);
});
it.each(["service", "expert"])(
  "claim and mapping invalidation never wait on booking-held %s resources",
  async (resource) => {
    const f = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    const booking = database.db.transaction(async (tx) => {
      await tx.execute(
        resource === "service"
          ? sql`select 1 from expert_services where id=${f.serviceId}::uuid for update`
          : sql`select 1 from experts where id=(select expert_id from expert_services where id=${f.serviceId}::uuid) for update`,
      );
      locked();
      await held;
      await tx.execute(
        sql`select 1 from planerka_service_mappings where expert_service_id=${f.serviceId}::uuid for share nowait`,
      );
    });
    await ready;
    try {
      await expect(f.repository.claim(f.accountId)).rejects.toThrow(
        "planerka_availability_busy",
      );
      await expect(
        database.db.execute(
          sql`update planerka_service_mappings set enabled=false where expert_service_id=${f.serviceId}::uuid`,
        ),
      ).rejects.toThrow();
      expect(
        (
          await database.db.execute(
            sql`select enabled from planerka_service_mappings where expert_service_id=${f.serviceId}::uuid`,
          )
        ).rows,
      ).toEqual([{ enabled: true }]);
    } finally {
      release();
      await booking;
    }
  },
  2000,
);
it("conditional upsert cannot overwrite a newly delayed/live durable refresh", async () => {
  const f = await fixture();
  await f.claim();
  await f.due();
  const competingLease = randomUUID();
  const dialect = new PgDialect();
  let injected = false;
  // Inject a separate SQL statement after the locked-state read, before upsert.
  // Every repository query still executes on PostgreSQL. Unlike a self-changing
  // INSERT trigger, this does not cause PostgreSQL's same-command conflict error.
  // It probes the final WHERE fence, not a concurrent writer bypassing row locks.
  const racedDb = new Proxy(database.db, {
    get(target, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(target, property, receiver);
      const transaction: typeof target.transaction = (callback, config) =>
        target.transaction(async (tx) => {
          const racedTx = new Proxy(tx, {
            get(executor, key, executorReceiver) {
              if (key !== "execute")
                return Reflect.get(executor, key, executorReceiver);
              return async (query: Parameters<typeof executor.execute>[0]) => {
                const statement =
                  typeof query === "string"
                    ? query
                    : dialect.sqlToQuery(query.getSQL()).sql;
                if (
                  !injected &&
                  statement.includes(
                    "insert into planerka_availability_refreshes(",
                  )
                ) {
                  injected = true;
                  await executor.execute(sql`update planerka_availability_refreshes
                    set lease_token=${competingLease}::uuid,
                      lease_until=clock_timestamp()+interval '90 seconds',
                      next_attempt_at=clock_timestamp()+interval '120 seconds'
                    where expert_service_id=${f.serviceId}::uuid`);
                }
                return executor.execute(query);
              };
            },
          });
          return callback(racedTx);
        }, config);
      return transaction;
    },
  });
  expect(
    await new PostgresPlanerkaAvailabilityRepository(racedDb).claim(
      f.accountId,
    ),
  ).toBeUndefined();
  expect(injected).toBe(true);
  const row = (
    await database.db.execute(
      sql`select lease_token,next_attempt_at>clock_timestamp() as delayed from planerka_availability_refreshes where expert_service_id=${f.serviceId}::uuid`,
    )
  ).rows[0]!;
  expect(row.delayed).toBe(true);
  expect(row.lease_token).toBe(competingLease);
  expect(await f.repository.claim(f.accountId)).toBeUndefined();
});
it("keeps UTC windows at168 absolute hours in a non-UTC session across DST", async () => {
  const f = await fixture();
  const zoned = createDb(database.db.$client.options.connectionString!, {
    options: "-c timezone=America/New_York",
  });
  try {
    const c = (await new PostgresPlanerkaAvailabilityRepository(zoned).claim(
      f.accountId,
    ))!;
    expect(Date.parse(c.windowEnd) - Date.parse(c.windowStart)).toBe(604800000);
    await zoned.execute(
      sql`update planerka_availability_refreshes set window_start='2026-10-30T00:00:00Z',window_end='2026-11-06T00:00:00Z' where expert_service_id=${f.serviceId}::uuid`,
    );
    expect(
      (
        await zoned.execute(
          sql`select extract(epoch from(window_end-window_start))::int as seconds from planerka_availability_refreshes where expert_service_id=${f.serviceId}::uuid`,
        )
      ).rows,
    ).toEqual([{ seconds: 604800 }]);
    await expect(
      zoned.execute(
        sql`update planerka_availability_refreshes set window_end=window_start+interval '7 days' where expert_service_id=${f.serviceId}::uuid`,
      ),
    ).rejects.toThrow();
  } finally {
    await closeDb(zoned);
  }
});
it("does not lock unrelated historical slots while publishing a current window", async () => {
  const f = await fixture();
  const c = await f.claim();
  const row = (
    await database.db.execute<{ id: string }>(
      sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at) values(${f.serviceId}::uuid,'planerka',${randomUUID()},clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days'+interval '1 hour',1,clock_timestamp()) returning id`,
    )
  ).rows[0]!;
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const history = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from slots where id=${row.id}::uuid for update`,
    );
    locked();
    await held;
  });
  await ready;
  try {
    expect(await f.repository.publish(c, f.times)).toBe(true);
  } finally {
    release();
    await history;
  }
}, 2000);
it("mapping insertion hides unrefreshed legacy observations", async () => {
  const f = await fixture(false);
  expect(await f.read()).toEqual({ kind: "complete", slots: [] });
  expect(
    (
      await database.db.execute(
        sql`select observed_at from slots where id=${f.slotId}::uuid`,
      )
    ).rows,
  ).toEqual([{ observed_at: null }]);
});
it("disable then restore of the same mapping permanently fences the original lease", async () => {
  const f = await fixture();
  const c = await f.claim();
  await database.db.execute(
    sql`update planerka_service_mappings set enabled=false where expert_service_id=${f.serviceId}::uuid`,
  );
  await database.db.execute(
    sql`update planerka_service_mappings set enabled=true where expert_service_id=${f.serviceId}::uuid`,
  );
  expect(await f.repository.publish(c, f.times)).toBe(false);
  expect(await f.repository.defer(c, "provider_unavailable")).toBe(false);
});
async function bothCatalogues(f: Awaited<ReturnType<typeof fixture>>) {
  const now = new Date();
  const read = await f.catalog.read({
    sourceKey: f.serviceId,
    databaseNow: now,
  });
  if (read.kind !== "complete") throw new Error("catalog_unavailable");
  const found = await f.catalog.findEligible({
    from: now,
    to: new Date(now.getTime() + 604800000),
    now,
    minimumLeadMs: 86400000,
    requireExpertActive: true,
    requireExpertVerified: true,
    requireServiceActive: true,
  });
  return [
    read.slots.map((s) => s.localSlotId),
    found.filter((s) => s.slotId === f.slotId).map((s) => s.slotId),
  ];
}
it.each(["absent", "disabled", "future", "duration"])(
  "both catalogue readers reject fresh rows with %s mappings independently of invalidation",
  async (mode) => {
    const f = await fixture();
    if (mode === "absent")
      await database.db.execute(
        sql`delete from planerka_service_mappings where expert_service_id=${f.serviceId}::uuid`,
      );
    else
      await database.db.execute(
        sql`update planerka_service_mappings set ${sql.raw({ disabled: "enabled=false", future: "verified_at=clock_timestamp()+interval '1 day'", duration: "duration_minutes=30" }[mode]!)} where expert_service_id=${f.serviceId}::uuid`,
      );
    await database.db.execute(
      sql`update slots set observed_at=clock_timestamp() where id=${f.slotId}::uuid`,
    );
    expect(await bothCatalogues(f)).toEqual([[], []]);
  },
);
it.each(["reserved", "booked", "expired", "cancelled"])(
  "both readers account for %s overlapping reservations on another service",
  async (status) => {
    const f = await fixture();
    const userId = await database.createUser();
    const service = (
      await database.db.execute<{ id: string }>(
        sql`insert into expert_services(expert_id,name,code,language,duration_minutes) select expert_id,'Other consultation','other','ru',60 from expert_services where id=${f.serviceId}::uuid returning id`,
      )
    ).rows[0]!.id;
    const slot = (
      await database.db.execute<{ id: string }>(
        sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at) select ${service}::uuid,'test',${randomUUID()},starts_at+interval '30 minutes',ends_at+interval '30 minutes',1,clock_timestamp() from slots where id=${f.slotId}::uuid returning id`,
      )
    ).rows[0]!.id;
    await database.db.execute(
      sql`insert into reservations(user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until,created_at) select ${userId}::uuid,${slot}::uuid,expert_id,${service}::uuid,${status === "cancelled" ? "cancelled_by_client" : status === "booked" ? "booked" : "reserved"}::reservation_status,${randomUUID()},clock_timestamp()+${status === "expired" ? "-1 minute" : "1 hour"}::interval,clock_timestamp()-interval '1 day' from expert_services where id=${service}::uuid`,
    );
    const expected =
      status === "reserved" || status === "booked" ? [] : [f.slotId];
    expect(await bothCatalogues(f)).toEqual([expected, expected]);
  },
);
it("keeps non-Planerka same-slot remaining capacity visible", async () => {
  const f = await fixture();
  const userId = await database.createUser();
  await database.db.execute(
    sql`update slots set provider='test',capacity=2 where id=${f.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into reservations(user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until) select ${userId}::uuid,${f.slotId}::uuid,expert_id,id,'reserved',${randomUUID()},clock_timestamp()+interval '1 hour' from expert_services where id=${f.serviceId}::uuid`,
  );
  expect(await bothCatalogues(f)).toEqual([[f.slotId], [f.slotId]]);
});
it("both readers omit an overlapping hold on another slot of the same service", async () => {
  const f = await fixture();
  const userId = await database.createUser();
  const slot = (
    await database.db.execute<{ id: string }>(
      sql`insert into slots(expert_service_id,provider,external_slot_id,starts_at,ends_at,capacity,observed_at) select expert_service_id,provider,${randomUUID()},starts_at+interval '30 minutes',ends_at+interval '30 minutes',1,clock_timestamp() from slots where id=${f.slotId}::uuid returning id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into reservations(user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until) select ${userId}::uuid,${slot}::uuid,expert_id,id,'reserved',${randomUUID()},clock_timestamp()+interval '1 hour' from expert_services where id=${f.serviceId}::uuid`,
  );
  expect(await bothCatalogues(f)).toEqual([[], []]);
});
it("rolls back late lease expiry after slot writes and preserves the publication watermark", async () => {
  const f = await fixture();
  await f.repository.publish(await f.claim(), f.times);
  await f.due();
  const c = await f.claim();
  const before = (
    await database.db.execute(
      sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid order by id`,
    )
  ).rows;
  const watermark = (
    await database.db.execute(
      sql`select published_at from planerka_availability_refreshes where expert_service_id=${f.serviceId}::uuid`,
    )
  ).rows;
  await database.db.execute(
    sql.raw(`CREATE SEQUENCE availability_test_late_path;
    CREATE FUNCTION availability_test_late_path() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.expert_service_id='${f.serviceId}'::uuid THEN PERFORM nextval('availability_test_late_path'); PERFORM pg_sleep(2.1); END IF; RETURN NEW; END $$;
    CREATE TRIGGER availability_test_late_path BEFORE INSERT ON slots FOR EACH ROW EXECUTE FUNCTION availability_test_late_path();`),
  );
  try {
    await database.db.execute(
      sql`update planerka_availability_refreshes set lease_until=clock_timestamp()+interval '2 seconds' where expert_service_id=${f.serviceId}::uuid`,
    );
    const added = {
      startsAt: new Date(
        Date.parse(f.times[0]!.startsAt) + 86400000,
      ).toISOString(),
      endsAt: new Date(Date.parse(f.times[0]!.endsAt) + 86400000).toISOString(),
    };
    expect(await f.repository.publish(c, [...f.times, added])).toBe(false);
    expect(
      (
        await database.db.execute(
          sql.raw("select is_called from availability_test_late_path"),
        )
      ).rows,
    ).toEqual([{ is_called: true }]);
    expect(
      (
        await database.db.execute(
          sql`select id,observed_at from slots where expert_service_id=${f.serviceId}::uuid order by id`,
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await database.db.execute(
          sql`select published_at from planerka_availability_refreshes where expert_service_id=${f.serviceId}::uuid`,
        )
      ).rows,
    ).toEqual(watermark);
  } finally {
    await database.db.execute(
      sql.raw(
        "DROP TRIGGER availability_test_late_path ON slots; DROP FUNCTION availability_test_late_path(); DROP SEQUENCE availability_test_late_path;",
      ),
    );
  }
}, 10000);
async function operation(
  f: Awaited<ReturnType<typeof fixture>>,
  state: string,
) {
  const userId = await database.createUser();
  const reservation = (
    await database.db.execute<{ id: string }>(
      sql`insert into reservations(user_id,slot_id,expert_id,expert_service_id,status,idempotency_key,reserved_until) select ${userId}::uuid,${f.slotId}::uuid,expert_id,id,'reserved',${randomUUID()},clock_timestamp()+interval '1 hour' from expert_services where id=${f.serviceId}::uuid returning id`,
    )
  ).rows[0]!.id;
  const request = {
    eventTypeId: 7,
    start: f.times[0]!.startsAt,
    lengthInMinutes: 60,
    attendee: { name: "Synthetic", timeZone: "UTC" },
  };
  const uid = [
    "cancel_pending",
    "cancelling",
    "cancel_unknown",
    "booked",
    "finished",
    "cancelled",
  ].includes(state)
    ? `synthetic_${randomUUID()}`
    : null;
  const sent = ["sending", "unknown", "cancelling"].includes(state)
    ? new Date()
    : null;
  return (
    await database.db.execute<{
      id: string;
    }>(sql`insert into planerka_booking_operations(reservation_id,account_id,event_type_id,request,request_fingerprint,starts_at,ends_at,state,provider_uid,send_admitted_at,next_attempt_at)
    values(${reservation}::uuid,${f.accountId},7,${JSON.stringify(request)}::jsonb,${planerkaRequestFingerprint(request)},${f.times[0]!.startsAt}::timestamptz,${f.times[0]!.endsAt}::timestamptz,${state},${uid},${sent},clock_timestamp()+interval '5 seconds') returning id`)
  ).rows[0]!.id;
}
it.each([
  "unknown",
  "sending",
  "cancel_pending",
  "cancelling",
  "cancel_unknown",
  "pending",
])(
  "availability yields account admission to delayed/in-flight %s booking work",
  async (state) => {
    const f = await fixture();
    await operation(f, state);
    const bookings = new PostgresPlanerkaBookingRepository(database.db);
    expect(
      await bookings.admitRequest(f.accountId, {
        availability: true,
        createEnabled: true,
      }),
    ).toBe(false);
    // Existing booking admission retains its ordinary behavior.
    expect(await bookings.admitRequest(f.accountId)).toBe(true);
  },
);
it.each(["pending", "manual", "cancelled", "rejected", "finished", "booked"])(
  "creation-disabled or terminal %s operations do not starve availability",
  async (state) => {
    const f = await fixture();
    await operation(f, state);
    expect(
      await new PostgresPlanerkaBookingRepository(database.db).admitRequest(
        f.accountId,
        { availability: true, createEnabled: false },
      ),
    ).toBe(true);
  },
);
it("recovery retains admission under a multi-service refresh backlog and allows imports once resolved", async () => {
  const f = await fixture();
  const id = await operation(f, "unknown");
  const bookings = new PostgresPlanerkaBookingRepository(database.db);
  const other = await fixture();
  await database.db.execute(
    sql`update planerka_service_mappings set account_id=${f.accountId},event_type_id=8 where expert_service_id=${other.serviceId}::uuid`,
  );
  let http = 0;
  const client = createPlanerkaClient({ apiKey: "cal_synthetic" }, async () => {
    http++;
    return Response.json({
      status: "success",
      data: { id: f.accountId, timeZone: "UTC", weekStart: "Monday" },
    });
  });
  for (let i = 0; i < 2; i++) {
    const result = await runPlanerkaAvailabilityOnce({
      repository: f.repository,
      client,
      accountId: f.accountId,
      admitRequest: (accountId) =>
        bookings.admitRequest(accountId, {
          availability: true,
          createEnabled: false,
        }),
      sleep: async () => {},
    });
    expect(result.reason).toBe("account_rate_limit");
  }
  expect(http).toBe(0);
  expect(await bookings.admitRequest(f.accountId)).toBe(true);
  await database.db.execute(
    sql`update planerka_booking_operations set next_attempt_at=clock_timestamp()-interval '1 second' where id=${id}::uuid`,
  );
  expect(
    await runPlanerkaBookingOnce({
      repository: bookings,
      client,
      accountId: f.accountId,
      createEnabled: false,
    }),
  ).toEqual({ processed: 1 });
  expect(
    (
      await database.db.execute(
        sql`select state from planerka_booking_operations where id=${id}::uuid`,
      )
    ).rows,
  ).toEqual([{ state: "manual" }]);
  await database.db.execute(
    sql`update planerka_account_requests set next_request_at=clock_timestamp()-interval '1 second' where account_id=${f.accountId}`,
  );
  expect(
    await bookings.admitRequest(f.accountId, {
      availability: true,
      createEnabled: false,
    }),
  ).toBe(true);
});
it("availability performs no HTTP and returns a fixed result while the durable account row is held", async () => {
  const f = await fixture();
  const bookings = new PostgresPlanerkaBookingRepository(database.db);
  await bookings.admitRequest(f.accountId);
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const transaction = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select 1 from planerka_account_requests where account_id=${f.accountId} for update`,
    );
    locked();
    await held;
  });
  await ready;
  let http = 0;
  const before = await f.read();
  try {
    const result = await runPlanerkaAvailabilityOnce({
      repository: f.repository,
      accountId: f.accountId,
      client: createPlanerkaClient({ apiKey: "cal_synthetic" }, async () => {
        http++;
        throw new Error("unexpected");
      }),
      admitRequest: (accountId) =>
        bookings.admitRequest(accountId, {
          availability: true,
          createEnabled: false,
        }),
      sleep: async () => {},
    });
    expect(result).toEqual({
      processed: 1,
      published: 0,
      reason: "account_rate_limit",
    });
    expect(http).toBe(0);
    expect(await f.read()).toEqual(before);
  } finally {
    release();
    await transaction;
  }
}, 2000);
it("pins canonical0073 metadata including Planerka availability, SQL objects, predecessor and all input hashes", async () => {
  const read = (p: string) =>
    JSON.parse(readFileSync(`packages/db/migrations/${p}`, "utf8"));
  const snapshot = read("meta/0073_snapshot.json");
  expect(Object.keys(snapshot.tables)).toHaveLength(218);
  expect(
    snapshot.tables["public.slots"].indexes.slots_planerka_service_start_idx,
  ).toBeDefined();
  expect(snapshot.prevId).toBe(read("meta/0072_snapshot.json").id);
  expect(
    snapshot.tables["public.planerka_availability_refreshes"],
  ).toBeDefined();
  const manifest = read("state/0073_manifest.json");
  expect(manifest.databaseVersion).toBe("170005");
  for (const [path, hash] of [
    ["meta/0073_snapshot.json", manifest.snapshotSha256],
    ["state/0073_sql_objects.json", manifest.sqlObjectsSha256],
  ])
    expect(
      createHash("sha256")
        .update(readFileSync(`packages/db/migrations/${path}`))
        .digest("hex"),
    ).toBe(hash);
  for (const m of manifest.migrations)
    expect(
      createHash("sha256")
        .update(readFileSync(`packages/db/migrations/${m.tag}.sql`))
        .digest("hex"),
    ).toBe(m.sha256);
  const state = read("state/0073_sql_objects.json");
  expect(state.functions).toHaveLength(158);
  expect(state.triggers).toHaveLength(196);
  expect((await database.db.execute(sql.raw(constraintStateSql))).rows).toEqual(
    state.constraints,
  );
  expect((await database.db.execute(sql.raw(indexStateSql))).rows).toEqual(
    state.indexes,
  );
  expect(
    (
      await database.db.execute(
        sql`select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
      )
    ).rows,
  ).toEqual(state.triggers);
  expect(
    (
      await database.db.execute(
        sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
      )
    ).rows,
  ).toEqual(state.functions);
  const output = mkdtempSync(join(tmpdir(), "planerka-availability-verify-"));
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "node_modules/drizzle-kit/bin.cjs",
          "introspect",
          "--dialect=postgresql",
          `--url=${database.db.$client.options.connectionString}`,
          `--out=${output}`,
        ],
        { stdio: "ignore", timeout: 60000 },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("introspection_failed")),
      );
    });
    const constraints = await database.db.execute<
      ConstraintState & Record<string, unknown>
    >(sql.raw(constraintStateSql));
    const indexes = await database.db.execute<
      IndexState & Record<string, unknown>
    >(sql.raw(indexStateSql));
    const actual = normalizeMigrationSnapshot(
      JSON.parse(readFileSync(join(output, "meta/0000_snapshot.json"), "utf8")),
      { constraints: constraints.rows, indexes: indexes.rows },
    );
    actual.id = snapshot.id;
    actual.prevId = snapshot.prevId;
    expect(actual).toEqual(snapshot);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 90000);
