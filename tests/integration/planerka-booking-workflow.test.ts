import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  PostgresPlanerkaBookingRepository,
  type PlanerkaOperation,
} from "../../packages/db/src/repositories/planerka-booking-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { runPlanerkaBookingOnce } from "../../packages/worker/src/planerka-booking-dispatcher.js";
import {
  PlanerkaClientError,
  PlanerkaUnknownOutcomeError,
  type PlanerkaClient,
  type PlanerkaBooking,
} from "@ii-tonya/integrations";

let database: TestDatabase;
let account = 100;
beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);

async function fixture(mapped = true) {
  const now = new Date();
  const accountId = ++account;
  const slotId = await database.createSlot({
    capacity: 1,
    startsAt: new Date(now.getTime() + 172800000).toISOString(),
    observedAt: now.toISOString(),
  });
  await database.db.execute(
    sql`update slots set provider='planerka' where id=${slotId}::uuid`,
  );
  const identity = (
    await database.db.execute<{ expertId: string; serviceId: string }>(
      sql`select es.expert_id as "expertId",es.id as "serviceId" from slots s join expert_services es on es.id=s.expert_service_id where s.id=${slotId}::uuid`,
    )
  ).rows[0]!;
  if (mapped)
    await database.db.execute(
      sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) values(${identity.serviceId}::uuid,${accountId},1,60,'UTC',true,clock_timestamp())`,
    );
  const userId = await database.createUser();
  const bookings = new PostgresBookingRepository(database.db);
  const result = await bookings.reserve({
    userId,
    slotId,
    now,
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    minimumLeadMs: 86400000,
    confirmationBufferMs: 3600000,
  });
  if (result.kind === "unavailable") throw new Error("fixture_unavailable");
  const id = result.reservationId;
  const handle =
    `bk1.${randomUUID().replaceAll("-", "").padEnd(43, "A")}` as const;
  await database.db.execute(
    sql`insert into client_booking_receipts(user_id,choice_digest,booking_handle,reservation_id) values(${userId}::uuid,${`sha256:${randomUUID().replaceAll("-", "").padEnd(64, "0")}`},${handle},${id}::uuid)`,
  );
  const approval = {
    reservationId: id,
    expectedVersion: 1,
    action: "expert_confirm" as const,
    actor: { type: "expert" as const, id: identity.expertId },
    now,
    correlationId: randomUUID(),
  };
  const repository = new PostgresPlanerkaBookingRepository(database.db);
  return {
    id,
    accountId,
    userId,
    bookings,
    repository,
    approval,
    handle,
    approve: () => bookings.transition(approval),
    cancel: () =>
      bookings.cancelOwnedByHandle({
        userId,
        bookingHandle: handle,
        correlationId: randomUUID(),
      }),
    row: async () =>
      (
        await database.db.execute(
          sql`select o.state,o.provider_uid,o.cancel_requested,r.status from planerka_booking_operations o join reservations r on r.id=o.reservation_id where r.id=${id}::uuid`,
        )
      ).rows[0],
    confirmations: async () =>
      (
        await database.db.execute(
          sql`select id from integration_outbox where topic='client.booking_confirmed' and payload->>'reservationId'=${id}`,
        )
      ).rows.length,
  };
}
function booking(op: PlanerkaOperation): PlanerkaBooking {
  return {
    id: 1,
    uid: `uid_${op.id}`,
    eventTypeId: op.eventTypeId,
    eventType: { id: op.eventTypeId, slug: "fixture" },
    start: op.request.start,
    end: new Date(Date.parse(op.request.start) + 3600000).toISOString(),
    duration: 60,
    status: "accepted",
    hosts: [
      {
        id: op.accountId,
        name: "Host",
        email: "",
        displayEmail: "",
        username: "fixture",
        timeZone: "UTC",
      },
    ],
    attendees: [
      {
        name: "Клиент",
        email: "",
        displayEmail: "",
        timeZone: "UTC",
        absent: false,
      },
    ],
    title: "",
    description: "",
    location: "",
    meetingUrl: "",
    absentHost: false,
    createdAt: op.request.start,
    updatedAt: op.request.start,
    bookingFieldsResponses: {},
  };
}
async function admitted(f: Awaited<ReturnType<typeof fixture>>) {
  await f.approve();
  const op = (await f.repository.claim(f.accountId, true))!;
  expect(await f.repository.admitSend(op)).toBe(true);
  return op;
}
function provider(create: PlanerkaClient["createBooking"]): PlanerkaClient {
  return {
    createBooking: create,
    getProfile: async () => {
      throw new Error("unexpected_read");
    },
    listEventTypes: async () => [],
    listSlots: async () => ({}),
    listBookings: async () => {
      throw new Error("unexpected_read");
    },
    getBooking: async () => ({ kind: "missing" }),
    cancelBooking: async () => {
      throw new Error("unexpected_cancel");
    },
  };
}

it("approval keeps occupancy, exposes calendar_pending, rejects stale/foreign/duplicate decisions and publishes no confirmation", async () => {
  const f = await fixture();
  await expect(
    f.bookings.transition({
      ...f.approval,
      actor: { type: "expert", id: randomUUID() },
    }),
  ).rejects.toThrow("own");
  expect(await f.approve()).toMatchObject({ status: "reserved", version: 2 });
  await expect(f.approve()).rejects.toThrow("Stale");
  await expect(
    f.bookings.transition({ ...f.approval, expectedVersion: 2 }),
  ).rejects.toThrow();
  expect(await f.row()).toMatchObject({
    state: "pending",
    status: "reserved",
    provider_uid: null,
  });
  expect(await f.confirmations()).toBe(0);
  expect(await f.bookings.listOwnedActive({ userId: f.userId })).toMatchObject({
    bookings: [{ state: "calendar_pending" }],
  });
  expect(
    (
      await database.db.execute(
        sql`select topic from integration_outbox where payload->>'reservationId'=${f.id}`,
      )
    ).rows,
  ).toEqual([{ topic: "telegram.reservation_request" }]);
});
it("rejects absent mappings and never fabricates availability", async () => {
  const f = await fixture(false);
  await expect(f.approve()).rejects.toThrow("mapping_unavailable");
  expect(await f.repository.claim(f.accountId, true)).toBeUndefined();
  expect(
    await f.bookings.listOwnedActive({ userId: await database.createUser() }),
  ).toEqual({ kind: "found", bookings: [] });
});
it("dispatches one create and atomically commits a bound UID and exactly one confirmation", async () => {
  const f = await fixture();
  await f.approve();
  let posts = 0;
  const client = provider(async (request) => {
    posts++;
    expect(Object.keys(request).sort()).toEqual([
      "attendee",
      "eventTypeId",
      "lengthInMinutes",
      "start",
    ]);
    const raw = (
      await database.db.execute<{ id: string }>(
        sql`select id from planerka_booking_operations where reservation_id=${f.id}::uuid`,
      )
    ).rows[0]!;
    return booking({
      id: raw.id,
      request,
      accountId: f.accountId,
      eventTypeId: 1,
    } as PlanerkaOperation);
  });
  const deps = {
    repository: f.repository,
    client,
    accountId: f.accountId,
    createEnabled: true,
  };
  await runPlanerkaBookingOnce(deps);
  expect(await f.row()).toMatchObject({ state: "booked", status: "booked" });
  expect(await f.confirmations()).toBe(1);
  await runPlanerkaBookingOnce(deps);
  expect(posts).toBe(1);
  expect(await f.confirmations()).toBe(1);
});
it("rolls back UID, booked status and confirmation together if publication fails, then completes once", async () => {
  const f = await fixture();
  const op = await admitted(f);
  await database.db.execute(
    sql.raw(
      `create function workflow_fail_confirmation() returns trigger language plpgsql as $$ begin if NEW.topic='client.booking_confirmed' then raise exception 'fixture_rollback'; end if; return NEW; end $$; create trigger workflow_fail_confirmation before insert on integration_outbox for each row execute function workflow_fail_confirmation();`,
    ),
  );
  try {
    await expect(f.repository.complete(op, booking(op))).rejects.toThrow();
  } finally {
    await database.db.execute(
      sql.raw(
        "drop trigger workflow_fail_confirmation on integration_outbox; drop function workflow_fail_confirmation();",
      ),
    );
  }
  expect(await f.row()).toMatchObject({
    state: "sending",
    provider_uid: null,
    status: "reserved",
  });
  expect(await f.confirmations()).toBe(0);
  expect(await f.repository.complete(op, booking(op))).toBe(true);
  expect(await f.repository.complete(op, booking(op))).toBe(false);
  expect(await f.confirmations()).toBe(1);
});
it("rejects mismatched provider host, event, attendee and start without booking", async () => {
  const f = await fixture();
  const op = await admitted(f);
  const b = booking(op);
  for (const invalid of [
    { ...b, eventTypeId: 2 },
    { ...b, hosts: [] },
    { ...b, attendees: [] },
    { ...b, start: new Date().toISOString() },
  ])
    await expect(f.repository.complete(op, invalid)).rejects.toThrow(
      "binding_mismatch",
    );
  expect(await f.confirmations()).toBe(0);
  expect(await f.row()).toMatchObject({
    provider_uid: null,
    status: "reserved",
  });
});
it("records cancellation during POST, persists its UID, then compensates even with new creation disabled", async () => {
  const f = await fixture();
  await f.approve();
  let created: PlanerkaBooking | undefined;
  const client = provider(async (request) => {
    expect(await f.cancel()).toMatchObject({
      kind: "cancelled",
      providerCancellationPending: true,
    });
    const raw = (
      await database.db.execute<{ id: string }>(
        sql`select id from planerka_booking_operations where reservation_id=${f.id}::uuid`,
      )
    ).rows[0]!;
    created = booking({
      id: raw.id,
      request,
      accountId: f.accountId,
      eventTypeId: 1,
    } as PlanerkaOperation);
    return created;
  });
  await runPlanerkaBookingOnce({
    repository: f.repository,
    client,
    accountId: f.accountId,
    createEnabled: true,
  });
  expect(await f.row()).toMatchObject({
    state: "cancel_pending",
    status: "cancelled_by_client",
    provider_uid: created!.uid,
  });
  expect(await f.confirmations()).toBe(0);
  expect(await f.bookings.listOwnedActive({ userId: f.userId })).toMatchObject({
    bookings: [{ state: "cancellation_pending" }],
  });
  await database.db.execute(
    sql`update planerka_account_requests set next_request_at=clock_timestamp() where account_id=${f.accountId}`,
  );
  client.cancelBooking = async (uid) => {
    expect(uid).toBe(created!.uid);
    return { ...created!, status: "cancelled" };
  };
  await runPlanerkaBookingOnce({
    repository: f.repository,
    client,
    accountId: f.accountId,
    createEnabled: false,
  });
  expect(await f.row()).toMatchObject({ state: "cancelled" });
});
it("does not send after pre-admission cancellation or when creation is disabled", async () => {
  const f = await fixture();
  await f.approve();
  expect(await f.repository.claim(f.accountId, false)).toBeUndefined();
  const op = (await f.repository.claim(f.accountId, true))!;
  await f.cancel();
  expect(await f.repository.admitSend(op)).toBe(false);
  expect(await f.row()).toMatchObject({
    state: "cancelled",
    provider_uid: null,
  });
});
it("definite conflict releases the local claim without emitting confirmation or external cancellation", async () => {
  const f = await fixture();
  await f.approve();
  await runPlanerkaBookingOnce({
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: true,
    client: provider(async () => {
      throw new PlanerkaClientError("conflict");
    }),
  });
  expect(await f.row()).toMatchObject({
    state: "rejected",
    status: "expired",
    provider_uid: null,
  });
  expect(await f.confirmations()).toBe(0);
});
it("unknown POST is never repeated and recovers to an explicit operator case with admission disabled", async () => {
  const f = await fixture();
  await f.approve();
  let posts = 0;
  const client = provider(async () => {
    posts++;
    throw new PlanerkaUnknownOutcomeError();
  });
  await runPlanerkaBookingOnce({
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: true,
    client,
  });
  expect(await f.row()).toMatchObject({ state: "unknown", provider_uid: null });
  await database.db.execute(
    sql`update planerka_booking_operations set next_attempt_at=clock_timestamp() where reservation_id=${f.id}::uuid`,
  );
  await runPlanerkaBookingOnce({
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: false,
    client,
  });
  expect(posts).toBe(1);
  expect(await f.row()).toMatchObject({ state: "manual" });
  expect(await f.confirmations()).toBe(0);
});
it("fences expired leases, retains a late verified UID and recovers completion through authenticated lookup", async () => {
  const f = await fixture();
  const op = await admitted(f);
  await database.db.execute(
    sql`update planerka_booking_operations set lease_until=clock_timestamp()-interval '1 second' where id=${op.id}::uuid`,
  );
  const recovery = (await f.repository.claim(f.accountId, false))!;
  expect(recovery.state).toBe("unknown");
  expect(await f.repository.complete(op, booking(op))).toBe(false);
  expect(await f.row()).toMatchObject({
    state: "unknown",
    provider_uid: booking(op).uid,
    status: "reserved",
  });
  expect(await f.confirmations()).toBe(0);
  // Recovery claimed before the late response must not strand that UID in manual.
  await f.repository.needsOperator(recovery);
  expect(await f.row()).toMatchObject({ state: "unknown" });
  await database.db.execute(
    sql`update planerka_booking_operations set next_attempt_at=clock_timestamp() where id=${op.id}::uuid`,
  );
  const client = provider(async () => {
    throw new Error("duplicate_create");
  });
  client.getBooking = async (uid) => {
    expect(uid).toBe(booking(op).uid);
    return { kind: "found", booking: booking(op) };
  };
  await runPlanerkaBookingOnce({
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: false,
    client,
  });
  expect(await f.row()).toMatchObject({ state: "booked", status: "booked" });
  expect(await f.confirmations()).toBe(1);
});
it("expiry during creation retains compensation and forbids deleting unresolved operation ownership", async () => {
  const f = await fixture();
  const op = await admitted(f);
  await database.db.execute(
    sql`update reservations set created_at=clock_timestamp()-interval '2 days',reserved_until=clock_timestamp()-interval '1 second' where id=${f.id}::uuid`,
  );
  await new PostgresWorkerJobsRepository(database.db).expireDueBatch({
    now: new Date(),
    batchSize: 100,
  });
  await f.repository.complete(op, booking(op));
  expect(await f.row()).toMatchObject({
    state: "cancel_pending",
    status: "expired",
  });
  expect(await f.confirmations()).toBe(0);
  await expect(
    database.db.execute(sql`delete from reservations where id=${f.id}::uuid`),
  ).rejects.toThrow();
});
it("bounds account request admission across concurrent repositories", async () => {
  const id = ++account;
  const a = new PostgresPlanerkaBookingRepository(database.db),
    b = new PostgresPlanerkaBookingRepository(database.db);
  expect(
    (await Promise.all([a.admitRequest(id), b.admitRequest(id)])).filter(
      Boolean,
    ),
  ).toHaveLength(1);
});
it("reconciles uncertain cancellation by UID and bounds repeated accepted results", async () => {
  const f = await fixture();
  const op = await admitted(f);
  const b = booking(op);
  await f.repository.complete(op, b);
  await f.cancel();
  const client = provider(async () => {
    throw new Error("duplicate_create");
  });
  client.cancelBooking = async () => {
    throw new PlanerkaUnknownOutcomeError();
  };
  const deps = {
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: false,
    client,
  };
  await runPlanerkaBookingOnce(deps);
  expect(await f.row()).toMatchObject({
    state: "cancel_unknown",
    provider_uid: b.uid,
  });
  await database.db.execute(
    sql`update planerka_booking_operations set next_attempt_at=clock_timestamp() where id=${op.id}::uuid`,
  );
  await database.db.execute(
    sql`update planerka_account_requests set next_request_at=clock_timestamp() where account_id=${f.accountId}`,
  );
  client.getBooking = async () => ({
    kind: "found",
    booking: { ...b, status: "cancelled" },
  });
  await runPlanerkaBookingOnce(deps);
  expect(await f.row()).toMatchObject({ state: "cancelled" });
});
it("blocks erasure completion and operation deletion while provider work is unresolved", async () => {
  const f = await fixture();
  await admitted(f);
  await f.cancel();
  const job = randomUUID();
  await database.db.execute(
    sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values(${job}::uuid,${f.userId}::uuid,${job},'pending')`,
  );
  await expect(
    database.db.execute(
      sql`update privacy_deletion_jobs set status='processor_complete' where id=${job}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`delete from planerka_booking_operations where reservation_id=${f.id}::uuid`,
    ),
  ).rejects.toThrow();
  expect(await f.row()).toMatchObject({
    state: "sending",
    cancel_requested: true,
  });
});
it("retains a returned UID when worker completion rolls back, then authenticates recovery without a second POST", async () => {
  const f = await fixture();
  await f.approve();
  let posts = 0;
  let created: PlanerkaBooking | undefined;
  const client = provider(async (request) => {
    posts++;
    const row = (
      await database.db.execute<{ id: string }>(
        sql`select id from planerka_booking_operations where reservation_id=${f.id}::uuid`,
      )
    ).rows[0]!;
    created = booking({
      id: row.id,
      request,
      accountId: f.accountId,
      eventTypeId: 1,
    } as PlanerkaOperation);
    return created;
  });
  await database.db.execute(
    sql.raw(
      `create function workflow_fail_completion() returns trigger language plpgsql as $$ begin if NEW.topic='client.booking_confirmed' then raise exception 'fixture_rollback'; end if; return NEW; end $$; create trigger workflow_fail_completion before insert on integration_outbox for each row execute function workflow_fail_completion();`,
    ),
  );
  const deps = {
    repository: f.repository,
    accountId: f.accountId,
    createEnabled: true,
    client,
  };
  try {
    await runPlanerkaBookingOnce(deps);
  } finally {
    await database.db.execute(
      sql.raw(
        "drop trigger workflow_fail_completion on integration_outbox; drop function workflow_fail_completion();",
      ),
    );
  }
  expect(await f.row()).toMatchObject({
    state: "unknown",
    provider_uid: created!.uid,
    status: "reserved",
  });
  expect(await f.confirmations()).toBe(0);
  await database.db.execute(
    sql`update planerka_account_requests set next_request_at=clock_timestamp() where account_id=${f.accountId}`,
  );
  client.getBooking = async () => ({ kind: "found", booking: created! });
  await runPlanerkaBookingOnce({ ...deps, createEnabled: false });
  expect(posts).toBe(1);
  expect(await f.confirmations()).toBe(1);
});
it("completed provider bookings do not permanently block erasure", async () => {
  const f = await fixture();
  const op = await admitted(f);
  await f.repository.complete(op, booking(op));
  await f.bookings.transition({
    reservationId: f.id,
    expectedVersion: 3,
    action: "complete",
    actor: { type: "system", id: f.userId },
    now: new Date(),
    correlationId: randomUUID(),
  });
  expect(await f.row()).toMatchObject({
    state: "finished",
    status: "completed",
  });
  const job = randomUUID();
  await database.db.execute(
    sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values(${job}::uuid,${f.userId}::uuid,${job},'pending')`,
  );
  await database.db.execute(
    sql`update privacy_deletion_jobs set status='processor_complete' where id=${job}::uuid`,
  );
});
