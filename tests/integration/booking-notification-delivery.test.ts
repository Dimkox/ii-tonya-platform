import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { resolveBookingNotificationRecipient } from "../../packages/db/src/repositories/booking-notification-authority.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await database.migrate();
}, 120_000);
afterAll(async () => {
  await database?.stop();
}, 120_000);

async function identity(
  userId: string,
  botKey: string | null,
  externalId: string,
  chatId = externalId,
) {
  return (
    await database.db.execute<{ id: string }>(sql`
    insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
    values(${userId}::uuid,'telegram',${externalId},${botKey},${chatId},'active') returning id
  `)
  ).rows[0]!.id;
}

it("resolves exactly one active private identity for the configured bot", async () => {
  const userId = await database.createUser();
  const botKey = randomUUID();
  const identityId = await identity(userId, botKey, "101");
  expect(
    await database.db.transaction((tx) =>
      resolveBookingNotificationRecipient(tx, userId, botKey),
    ),
  ).toEqual({
    userId,
    identityId,
    botKey,
    externalUserId: "101",
    externalChatId: "101",
  });
});

it.each([
  "missing",
  "ambiguous",
  "null_bot",
  "wrong_bot",
  "group",
  "inactive",
  "blocked",
])("rejects %s recipient authority", async (kind) => {
  const userId = await database.createUser();
  const botKey = randomUUID();
  if (kind !== "missing")
    await identity(
      userId,
      kind === "null_bot" ? null : kind === "wrong_bot" ? randomUUID() : botKey,
      "102",
      kind === "group" ? "-102" : "102",
    );
  if (kind === "ambiguous") await identity(userId, botKey, "103");
  if (kind === "inactive")
    await database.db.execute(
      sql`update users set active=false where id=${userId}::uuid`,
    );
  if (kind === "blocked")
    await database.db.execute(
      sql`update channel_identities set status='blocked' where user_id=${userId}::uuid`,
    );
  expect(
    await database.db.transaction((tx) =>
      resolveBookingNotificationRecipient(tx, userId, botKey),
    ),
  ).toBeUndefined();
});

// The ledger cases exercise real PostgreSQL producers and admissions, not HTTP mocks.
// Removing producer capture, frozen tuple checks or consumed-attempt fencing breaks these.
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  PostgresBookingNotificationRepository,
  captureBookingNotificationIntents,
  eraseBookingNotificationRecipients,
} from "../../packages/db/src/repositories/booking-notification-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";

async function fixture(
  consent = true,
  origin?: { botKey: string; client: string; expert: string },
) {
  const f = await database.createReservableFixture();
  f.command.now = new Date();
  await database.db.execute(
    sql`update slots set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '2 days 1 hour',observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  f.command.now = new Date();
  const botKey = origin?.botKey ?? randomUUID();
  await database.db.execute(
    sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},true) on conflict(bot_key) do nothing`,
  );
  const expertUserId = (
    await database.db.execute<{ id: string }>(
      sql`select user_id as id from experts where id=${f.expertId}::uuid`,
    )
  ).rows[0]!.id;
  const clientIdentity = await identity(
    f.command.userId,
    botKey,
    origin?.client ?? "201",
  );
  const expertIdentity = await identity(
    expertUserId,
    botKey,
    origin?.expert ?? "202",
  );
  if (consent)
    await seedClientConsent(database.db, f.command.userId, "client_messaging");
  const bookings = new PostgresBookingRepository(database.db, {
    notificationOrigin: {
      botKey,
      messagingPolicyVersion: "client-messaging-v1",
    },
  });
  const result = await bookings.reserve(f.command);
  if (result.kind === "unavailable") throw new Error("fixture_not_reserved");
  const ledger = new PostgresBookingNotificationRepository(database.db, botKey);
  return {
    ...f,
    botKey,
    expertUserId,
    clientIdentity,
    expertIdentity,
    bookings,
    ledger,
    reservationId: result.reservationId,
  };
}
async function cancel(
  f: Awaited<ReturnType<typeof fixture>>,
  role: "expert" | "client" = "expert",
) {
  await f.bookings.transition({
    reservationId: f.reservationId,
    expectedVersion: 1,
    action: role === "expert" ? "expert_cancel" : "client_cancel",
    actor: {
      type: role,
      id: role === "expert" ? f.expertId : f.command.userId,
    },
    now: new Date(),
    correlationId: randomUUID(),
  });
}
async function delivery(
  f: Awaited<ReturnType<typeof fixture>>,
  topic = "client.booking_cancelled",
) {
  return (
    await database.db.execute<{
      id: string;
      state: string;
      reason_code: string | null;
      external_chat_id: string | null;
    }>(
      sql`select id,state,reason_code,external_chat_id from booking_notification_deliveries where reservation_id=${f.reservationId}::uuid and kind=${topic}`,
    )
  ).rows[0]!;
}
async function admission(f: Awaited<ReturnType<typeof fixture>>) {
  const claims = await f.ledger.claimDeliveries(20, "worker-a");
  const claim = claims.find((c) => c.reservationId === f.reservationId);
  expect(claim).toBeDefined();
  const grant = await f.ledger.admitAndConsume(claim!, "a".repeat(64));
  expect(grant).toBeDefined();
  return { claim: claim!, grant: grant! };
}
it("captures both original tuples, consent and expert request atomically", async () => {
  const f = await fixture();
  const row = (
    await database.db.execute<{
      client_identity_id: string;
      expert_identity_id: string;
      client_consent_authority: unknown;
    }>(
      sql`select * from booking_notification_contexts where reservation_id=${f.reservationId}::uuid`,
    )
  ).rows[0]!;
  expect(row.client_identity_id).toBe(f.clientIdentity);
  expect(row.expert_identity_id).toBe(f.expertIdentity);
  expect(row.client_consent_authority).toBeTruthy();
  expect((await delivery(f, "telegram.reservation_request")).state).toBe(
    "pending",
  );
  await expect(
    database.db.execute(
      sql`update booking_notification_contexts set bot_key='other' where reservation_id=${f.reservationId}::uuid`,
    ),
  ).rejects.toThrow();
});
it.each(["client", "expert"] as const)(
  "never retargets a relinked %s for later events",
  async (role) => {
    const f = await fixture();
    const id = role === "client" ? f.clientIdentity : f.expertIdentity;
    await database.db.execute(
      sql`update channel_identities set external_id='299',external_chat_id='299' where id=${id}::uuid`,
    );
    await cancel(f, role === "client" ? "expert" : "client");
    const d = await delivery(
      f,
      role === "client"
        ? "client.booking_cancelled"
        : "telegram.booking_cancelled",
    );
    expect(d.state).toBe("suppressed");
    expect(d.external_chat_id).toBe(role === "client" ? "201" : "202");
  },
);
it("does not borrow consent granted after reserve", async () => {
  const f = await fixture(false);
  await seedClientConsent(database.db, f.command.userId, "client_messaging");
  await cancel(f);
  expect((await delivery(f)).state).toBe("suppressed");
});
it("rejects original consent after a later genuine grant", async () => {
  const f = await fixture();
  await cancel(f);
  const claims = await f.ledger.claimDeliveries(20, "worker");
  const claim = claims.find((c) => c.reservationId === f.reservationId)!;
  expect(claim).toBeDefined();
  await seedClientConsent(database.db, f.command.userId, "client_messaging");
  expect(await f.ledger.admitAndConsume(claim, "b".repeat(64))).toBeUndefined();
  expect((await delivery(f)).state).toBe("suppressed");
});
it("suppresses stale approval and allows terminal delivery", async () => {
  const f = await fixture();
  await cancel(f);
  const { grant } = await admission(f);
  expect(grant.topic).toBe("client.booking_cancelled");
  expect((await delivery(f, "telegram.reservation_request")).state).toBe(
    "suppressed",
  );
});
it("consumes a lease once under concurrent workers and never resends unknown", async () => {
  const f = await fixture();
  await cancel(f);
  const claims = await f.ledger.claimDeliveries(20, "worker");
  const claim = claims.find((c) => c.reservationId === f.reservationId)!;
  const grants = await Promise.all([
    f.ledger.admitAndConsume(claim, "c".repeat(64)),
    f.ledger.admitAndConsume(claim, "c".repeat(64)),
  ]);
  expect(grants.filter(Boolean)).toHaveLength(1);
  const grant = grants.find(Boolean)!;
  await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
  expect(
    (await f.ledger.claimDeliveries(20, "worker")).some(
      (c) => c.id === claim.id,
    ),
  ).toBe(false);
  expect((await delivery(f)).state).toBe("unknown");
});
it("reclaims unadmitted lease but admitted expiry becomes manual with late receipt recovery", async () => {
  const f = await fixture();
  await cancel(f);
  const first = (await f.ledger.claimDeliveries(20, "first")).find(
    (c) => c.reservationId === f.reservationId,
  )!;
  await database.db.execute(
    sql`update booking_notification_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=${first.id}::uuid`,
  );
  await f.ledger.recoverExpired(20);
  expect(await f.ledger.admitAndConsume(first, "d".repeat(64))).toBeUndefined();
  const { grant } = await admission(f);
  await database.db.execute(
    sql`update booking_notification_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=${first.id}::uuid`,
  );
  await f.ledger.recoverExpired(20);
  expect((await delivery(f)).state).toBe("manual");
  const receipt = { botKey: f.botKey, chatId: "201", messageId: 401 };
  expect(await f.ledger.resolveReceipt(grant.attemptId, receipt)).toBe(true);
  expect(await f.ledger.resolveReceipt(grant.attemptId, receipt)).toBe(true);
  expect((await delivery(f)).state).toBe("delivered");
  expect(
    await f.ledger.resolveReceipt(grant.attemptId, {
      ...receipt,
      chatId: "999",
    }),
  ).toBe(false);
});
it("retries only definite non-delivery and honors full retry_after", async () => {
  const f = await fixture();
  await cancel(f);
  const { grant } = await admission(f);
  await f.ledger.recordOutcome(grant.attemptId, {
    kind: "not_applied",
    retryAfterSeconds: 180,
  });
  expect((await delivery(f)).state).toBe("retry_wait");
  expect(
    (
      await database.db.execute<{ ok: boolean }>(
        sql`select next_attempt_at>=clock_timestamp()+interval '179 seconds' as ok from booking_notification_deliveries where id=${grant.deliveryId}::uuid`,
      )
    ).rows[0]!.ok,
  ).toBe(true);
});
it("quarantines strict-source mismatch without sending", async () => {
  const f = await fixture();
  const id = (
    await database.db.execute<{ id: string }>(
      sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${randomUUID()},'client.booking_confirmed',${JSON.stringify({ reservationId: f.reservationId, charge: 0 })}::jsonb,'synthetic','synthetic','synthetic') returning id`,
    )
  ).rows[0]!.id;
  await database.db.transaction((tx) =>
    captureBookingNotificationIntents(tx, id),
  );
  expect(
    (
      await database.db.execute<{ status: string }>(
        sql`select status from integration_outbox where id=${id}::uuid`,
      )
    ).rows[0]!.status,
  ).toBe("dead_letter");
});
it("rolls context and intent back with the source transaction", async () => {
  const f = await fixture();
  const before = await database.outboxCountForCorrelation(
    "rollback-notification",
  );
  await expect(
    database.db.transaction(async (tx) => {
      const id = (
        await tx.execute<{ id: string }>(
          sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${randomUUID()},'client.booking_confirmed',${JSON.stringify({ reservationId: f.reservationId, charge: 0 })}::jsonb,'rollback-notification','synthetic','synthetic') returning id`,
        )
      ).rows[0]!.id;
      await captureBookingNotificationIntents(tx, id);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    await database.outboxCountForCorrelation("rollback-notification"),
  ).toBe(before);
});
it("erases identity without FK deadlock and retains uncertain attempt evidence", async () => {
  const f = await fixture();
  await cancel(f);
  const { grant } = await admission(f);
  await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
  await database.db.transaction(async (tx) => {
    await eraseBookingNotificationRecipients(tx, f.command.userId);
    await tx.execute(
      sql`delete from channel_identities where id=${f.clientIdentity}::uuid`,
    );
  });
  expect((await delivery(f)).state).toBe("manual");
  expect(
    (
      await database.db.execute(
        sql`select id from booking_notification_attempts where id=${grant.attemptId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
});

import { PostgresPlanerkaBookingRepository } from "../../packages/db/src/repositories/planerka-booking-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import { lockBookingNotificationSubjects } from "../../packages/db/src/repositories/booking-notification-authority.js";
import { stopBookingNotificationRecipients } from "../../packages/db/src/repositories/booking-notification-repository.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  constraintStateSql,
  indexStateSql,
  normalizeMigrationSnapshot,
  type ConstraintState,
  type IndexState,
} from "../../packages/db/src/testkit/migration-state.js";
let providerAccount = 700;
async function provider(f: Awaited<ReturnType<typeof fixture>>) {
  const accountId = ++providerAccount;
  await database.db.execute(
    sql`update slots set provider='planerka',ends_at=starts_at+interval '1 hour' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) select expert_service_id,${accountId},1,60,'UTC',true,clock_timestamp() from reservations where id=${f.reservationId}::uuid`,
  );
  await f.bookings.transition({
    reservationId: f.reservationId,
    expectedVersion: 1,
    action: "expert_confirm",
    actor: { type: "expert", id: f.expertId },
    now: new Date(),
    correlationId: randomUUID(),
  });
  const repo = new PostgresPlanerkaBookingRepository(database.db);
  const op = (await repo.claim(accountId, true))!;
  expect(await repo.admitSend(op)).toBe(true);
  return {
    repo,
    op,
    booking: {
      uid: `uid_${op.id}`,
      eventTypeId: op.eventTypeId,
      start: op.request.start,
      end: new Date(Date.parse(op.request.start) + 3600000).toISOString(),
      status: "accepted",
      hosts: [{ id: accountId }],
      attendees: [op.request.attendee],
    },
  };
}
it.each(["complete", "reject"] as const)(
  "captures provider %s event atomically from the verified operation",
  async (kind) => {
    const f = await fixture();
    const p = await provider(f);
    if (kind === "complete")
      expect(await p.repo.complete(p.op, p.booking)).toBe(true);
    else await p.repo.reject(p.op);
    const topic =
      kind === "complete"
        ? "client.booking_confirmed"
        : "client.reservation_expired";
    expect((await delivery(f, topic)).state).toBe("pending");
    const row = (
      await database.db.execute<{
        source_version: number | null;
        provider_operation_id: string;
      }>(
        sql`select source_version,provider_operation_id from booking_notification_deliveries where reservation_id=${f.reservationId}::uuid and kind=${topic}`,
      )
    ).rows[0]!;
    expect(row.source_version).toBeNull();
    expect(row.provider_operation_id).toBe(p.op.id);
    const { grant } = await admission(f);
    expect(grant.topic).toBe(topic);
    if (kind === "complete") expect(grant.calendar).toBe("verified_booked");
    else {
      const expert = await delivery(f, "expert.reservation_expired");
      expect(expert.state).toBe("pending");
      expect(
        (
          await database.db.execute(
            sql`select source_version from booking_notification_deliveries where id=${expert.id}::uuid`,
          )
        ).rows,
      ).toEqual([{ source_version: 3 }]);
      await p.repo.reject(p.op);
      expect(
        (
          await database.db.execute(
            sql`select id from booking_notification_deliveries where reservation_id=${f.reservationId}::uuid and kind='expert.reservation_expired'`,
          )
        ).rows,
      ).toHaveLength(1);
    }
  },
);
it.each(["complete", "mark_no_show"] as const)(
  "captures truthful %s after provider booking without cancellation projection",
  async (action) => {
    const f = await fixture();
    const p = await provider(f);
    await p.repo.complete(p.op, p.booking);
    await f.bookings.transition({
      reservationId: f.reservationId,
      expectedVersion: 3,
      action,
      actor: {
        type: action === "complete" ? "system" : "expert",
        id: f.expertId,
      },
      now: new Date(),
      correlationId: randomUUID(),
    });
    const { grant } = await admission(f);
    expect(grant.topic).toBe(
      action === "complete"
        ? "client.booking_completed"
        : "client.booking_no_show",
    );
    expect((await delivery(f, "client.booking_confirmed")).state).toBe(
      "suppressed",
    );
  },
);
it("captures expiry batch intents for both original recipients", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update reservations set created_at=clock_timestamp()-interval '1 hour',reserved_until=clock_timestamp()-interval '1 second' where id=${f.reservationId}::uuid`,
  );
  await new PostgresWorkerJobsRepository(database.db).expireDueBatch({
    now: new Date(),
    batchSize: 20,
  });
  expect((await delivery(f, "client.reservation_expired")).state).toBe(
    "pending",
  );
  expect((await delivery(f, "expert.reservation_expired")).state).toBe(
    "pending",
  );
});
it("a producer failure rolls the reservation, context, source and intent back together", async () => {
  const f = await database.createReservableFixture();
  const botKey = randomUUID();
  await database.db.execute(
    sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},true)`,
  );
  await database.db.execute(
    sql`update slots set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '2 days 1 hour',observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  f.command.now = new Date();
  await database.db.execute(
    sql`create function notification_test_rollback() returns trigger language plpgsql as $$ begin raise exception 'synthetic_intent_failure'; end $$; create trigger notification_test_rollback before insert on booking_notification_deliveries for each row execute function notification_test_rollback()`,
  );
  try {
    await expect(
      new PostgresBookingRepository(database.db, {
        notificationOrigin: {
          botKey,
          messagingPolicyVersion: "client-messaging-v1",
        },
      }).reserve(f.command),
    ).rejects.toThrow();
  } finally {
    await database.db.execute(
      sql`drop trigger notification_test_rollback on booking_notification_deliveries;drop function notification_test_rollback()`,
    );
  }
  expect(await database.reservationCountForKey(f.command.idempotencyKey)).toBe(
    0,
  );
  expect(
    await database.outboxCountForCorrelation(f.command.correlationId),
  ).toBe(0);
});
it("suppresses an inactive reservation client even for expert operational delivery", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update users set active=false where id=${f.command.userId}::uuid`,
  );
  expect(await f.ledger.claimDeliveries(20, "worker")).toEqual([]);
  expect((await delivery(f, "telegram.reservation_request")).state).toBe(
    "suppressed",
  );
});
it("withdrawal winning before admission stops unstarted work and regrant cannot revive it", async () => {
  const f = await fixture();
  await cancel(f);
  const claim = (await f.ledger.claimDeliveries(20, "worker")).find(
    (c) => c.reservationId === f.reservationId,
  )!;
  await database.db.transaction(async (tx) => {
    await lockBookingNotificationSubjects(tx, [f.command.userId]);
    await tx.execute(
      sql`insert into consents(user_id,consent_type,decision,policy_version,basis,created_at) values(${f.command.userId}::uuid,'client_messaging','revoked','client-messaging-v1','consent',clock_timestamp())`,
    );
    await stopBookingNotificationRecipients(tx, f.command.userId);
  });
  await seedClientConsent(database.db, f.command.userId, "client_messaging");
  expect(await f.ledger.admitAndConsume(claim, "e".repeat(64))).toBeUndefined();
  expect((await delivery(f)).state).toBe("suppressed");
});
it("rechecks the lease with fresh database time after waiting for its row lock", async () => {
  const f = await fixture();
  await cancel(f);
  const claim = (await f.ledger.claimDeliveries(20, "worker")).find(
    (c) => c.reservationId === f.reservationId,
  )!;
  await database.db.execute(
    sql`update booking_notification_deliveries set lease_until=clock_timestamp()+interval '15.2 seconds' where id=${claim.id}::uuid`,
  );
  let waiting: Promise<unknown> | undefined;
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from booking_notification_deliveries where id=${claim.id}::uuid for update`,
    );
    waiting = f.ledger.admitAndConsume(claim, "f".repeat(64));
    await tx.execute(sql`select pg_sleep(0.35)`);
  });
  expect(await waiting).toBeUndefined();
  expect(
    (
      await database.db.execute(
        sql`select id from booking_notification_attempts where delivery_id=${claim.id}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
});
it("sees a concurrently committed second identity before admission", async () => {
  const f = await fixture();
  await cancel(f);
  const claim = (await f.ledger.claimDeliveries(20, "worker")).find(
    (c) => c.reservationId === f.reservationId,
  )!;
  let waiting: Promise<unknown> | undefined;
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${f.command.userId}::uuid,'telegram','205','205',${f.botKey},'active')`,
    );
    waiting = f.ledger.admitAndConsume(claim, "e".repeat(64));
    await tx.execute(sql`select pg_sleep(0.05)`);
  });
  expect(await waiting).toBeUndefined();
  expect((await delivery(f)).state).toBe("suppressed");
});
it.each([
  "partial_client",
  "partial_expert",
  "consent_extra",
  "consent_missing",
  "consent_revision",
])("rejects malformed context %s at the database boundary", async (kind) => {
  const f = await database.createReservableFixture();
  const r = await new PostgresBookingRepository(database.db).reserve(f.command);
  if (r.kind === "unavailable") throw Error("fixture");
  const expertUser = (
    await database.db.execute<{ id: string }>(
      sql`select user_id as id from experts where id=${f.expertId}::uuid`,
    )
  ).rows[0]!.id;
  const authority = {
    v: 1,
    subjectId: f.command.userId,
    purposes: {
      client_messaging: {
        decisionId: randomUUID(),
        revision: kind === "consent_revision" ? "0" : "1",
      },
    },
    ...(kind === "consent_extra" ? { extra: true } : {}),
  };
  const raw =
    kind === "consent_missing"
      ? { v: 1, subjectId: f.command.userId, purposes: {} }
      : authority;
  await expect(
    database.db.execute(
      sql`insert into booking_notification_contexts(reservation_id,bot_key,client_user_id,expert_user_id,client_original_identity_id,expert_original_identity_id,client_unavailable_reason,expert_unavailable_reason,client_consent_authority) values(${r.reservationId}::uuid,'test',${f.command.userId}::uuid,${expertUser}::uuid,${kind === "partial_client" ? randomUUID() : null}::uuid,${kind === "partial_expert" ? randomUUID() : null}::uuid,${kind === "partial_client" ? null : "recipient_unavailable"},${kind === "partial_expert" ? null : "recipient_unavailable"},${kind.startsWith("consent") ? JSON.stringify(raw) : null}::jsonb)`,
    ),
  ).rejects.toThrow();
});
it("rejects partial delivery tuple and applied receipt without message ID", async () => {
  const f = await fixture();
  await cancel(f);
  const { grant } = await admission(f);
  await expect(
    database.db.execute(
      sql`update booking_notification_deliveries set external_chat_id=null where id=${grant.deliveryId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(
    database.db.execute(
      sql`insert into booking_notification_attempt_facts(attempt_id,outcome,bot_key,response_chat_id,reason_code) values(${grant.attemptId}::uuid,'applied',${f.botKey},'201','synthetic')`,
    ),
  ).rejects.toThrow();
});
it("bounded definite retries stop after five attempts", async () => {
  const f = await fixture();
  await cancel(f);
  for (let n = 1; n <= 5; n++) {
    const { grant } = await admission(f);
    await f.ledger.recordOutcome(grant.attemptId, { kind: "not_applied" });
    await database.db.execute(
      sql`update booking_notification_deliveries set next_attempt_at=clock_timestamp() where id=${grant.deliveryId}::uuid`,
    );
  }
  expect((await delivery(f)).state).toBe("failed");
  expect(await f.ledger.claimDeliveries(20, "worker")).toEqual([]);
});
it("reconstructs snapshot0045 and exact SQL constraints on PostgreSQL17.5", async () => {
  const folder = "packages/db/migrations";
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const expected = read(`${folder}/meta/0045_snapshot.json`);
  expect(expected.prevId).toBe(read(`${folder}/meta/0044_snapshot.json`).id);
  const out = mkdtempSync(join(tmpdir(), "notification-0045-test-"));
  try {
    execFileSync(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "introspect",
        "--dialect=postgresql",
        `--url=${database.db.$client.options.connectionString}`,
        `--out=${out}`,
      ],
      { stdio: "ignore", timeout: 60000 },
    );
    const constraints = (
      await database.db.execute<ConstraintState & Record<string, unknown>>(
        sql.raw(constraintStateSql),
      )
    ).rows;
    const indexes = (
      await database.db.execute<IndexState & Record<string, unknown>>(
        sql.raw(indexStateSql),
      )
    ).rows;
    const actual = normalizeMigrationSnapshot(
      read(join(out, "meta/0000_snapshot.json")),
      { constraints, indexes },
    );
    actual.id = expected.id;
    actual.prevId = expected.prevId;
    expect(actual).toEqual(expected);
    const supplement = read(`${folder}/state/0045_sql_objects.json`);
    expect(constraints).toEqual(supplement.constraints);
    expect(indexes).toEqual(supplement.indexes);
    const functions = await database.db.execute(
      sql`select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by name,arguments`,
    );
    const triggers = await database.db.execute(
      sql`select c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by table_name,name`,
    );
    const exclusionConstraints = await database.db.execute(
      sql`select r.relname table_name,c.conname name,pg_get_constraintdef(c.oid,true) definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='x' order by table_name,name`,
    );
    const extensions = await database.db.execute(
      sql`select extname name,extversion version from pg_extension where extname<>'plpgsql' order by name`,
    );
    expect({
      functions: functions.rows,
      triggers: triggers.rows,
      exclusionConstraints: exclusionConstraints.rows,
      extensions: extensions.rows,
      constraints,
      indexes,
    }).toEqual(supplement);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 90000);
// Review regressions: each uses the real ledger/SQL; no transport invocation.
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import { PostgresTelegramCallbackRepository } from "../../packages/db/src/repositories/telegram-callback-repository.js";

async function callbackPair(f: Awaited<ReturnType<typeof fixture>>) {
  const d = await delivery(f, "telegram.reservation_request");
  const expires = Number(
    (
      await database.db.execute<{ expires: string }>(
        sql`select floor(extract(epoch from expires_at))::text as expires from booking_notification_deliveries where id=${d.id}::uuid`,
      )
    ).rows[0]!.expires,
  );
  for (const action of ["confirm", "cancel"] as const) {
    const hash = createHash("sha256").update(randomUUID()).digest("hex");
    await new PostgresTelegramCallbackRepository(database.db).put(hash, {
      reservationId: f.reservationId,
      expertId: f.expertId,
      action,
      version: 1,
      expiresAtEpochSeconds: expires,
    });
    await database.db
      .execute(sql`insert into booking_notification_callbacks(delivery_id,action,notification_id,callback_token_hash,callback_token_ciphertext,encryption_key_id,expires_at)
      select ${d.id}::uuid,${action},id,${hash},'synthetic-ciphertext','synthetic-key',callback_expires_at from notifications where callback_token_hash=${hash}`);
  }
  return d;
}
it.each([
  "valid",
  "absent",
  "missing",
  "action",
  "expert",
  "hash",
  "expiry",
  "version",
  "reservation",
  "consumed",
  "claims",
])("admits only the frozen callback pair: %s", async (kind) => {
  const f = await fixture();
  const d =
    kind === "absent"
      ? await delivery(f, "telegram.reservation_request")
      : await callbackPair(f);
  const assignments: Record<string, ReturnType<typeof sql>> = {
    action: sql`callback_action='cancel'`,
    expert: sql`callback_expert_id=null`,
    hash: sql`callback_token_hash=${"0".repeat(64)}`,
    expiry: sql`callback_expires_at=clock_timestamp()-interval '1 second'`,
    version: sql`callback_version=2`,
    reservation: sql`reservation_id=${kind === "reservation" ? (await fixture()).reservationId : f.reservationId}::uuid`,
    consumed: sql`callback_consumed_at=clock_timestamp()`,
    claims: sql`callback_claims='{}'`,
  };
  if (kind === "missing")
    await database.db.execute(
      sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${d.id}::uuid and action='confirm'`,
    );
  else if (kind !== "valid" && kind !== "absent")
    await database.db.execute(
      sql`update notifications set ${assignments[kind]!} where id=(select notification_id from booking_notification_callbacks where delivery_id=${d.id}::uuid and action='confirm')`,
    );
  const claim = (await f.ledger.claimDeliveries(1, "callback-worker"))[0]!;
  const grant = await f.ledger.admitAndConsume(claim, "b".repeat(64));
  if (kind === "valid")
    expect(grant?.topic).toBe("telegram.reservation_request");
  else expect(grant).toBeUndefined();
  expect(
    (
      await database.db.execute(
        sql`select id from booking_notification_attempts where delivery_id=${d.id}::uuid`,
      )
    ).rows,
  ).toHaveLength(kind === "valid" ? 1 : 0);
});
it("continues a bounded fair scan past an entire locked oldest page across polls", async () => {
  const botKey = randomUUID();
  const blocked: Awaited<ReturnType<typeof fixture>>[] = [];
  for (let i = 0; i < 20; i++) {
    const f = await fixture(true, {
      botKey,
      client: String(1000 + i * 2),
      expert: String(1001 + i * 2),
    });
    await cancel(f);
    blocked.push(f);
  }
  const later = await fixture(true, { botKey, client: "2000", expert: "2001" });
  await cancel(later);
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from reservations where id in (${sql.join(
        blocked.map((f) => sql`${f.reservationId}::uuid`),
        sql`,`,
      )}) for update`,
    );
    const claims = [];
    for (let poll = 0; poll < 4; poll++)
      claims.push(...(await later.ledger.claimDeliveries(1, "fair-worker")));
    expect(claims.map((c) => c.reservationId)).toContain(later.reservationId);
    expect(
      claims.filter((c) =>
        blocked.some((f) => f.reservationId === c.reservationId),
      ),
    ).toEqual([]);
  });
}, 30000);
it("quarantines int32 source overflow without aborting later backlog accounting", async () => {
  const f = await fixture();
  const overflow = (
    await database.db.execute<{ id: string }>(
      sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${`${f.reservationId}:2147483648:expert.reservation_expired`},'expert.reservation_expired',${JSON.stringify({ reservationId: f.reservationId, version: 2147483648, charge: 0 })}::jsonb,'overflow','overflow','synthetic') returning id`,
    )
  ).rows[0]!.id;
  const next = (
    await database.db.execute<{ id: string }>(
      sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${randomUUID()},'expert.reservation_expired','{}','after-overflow','after-overflow','synthetic') returning id`,
    )
  ).rows[0]!.id;
  await f.ledger.capturePending(20);
  expect(
    (
      await database.db.execute(
        sql`select status from integration_outbox where id in (${overflow}::uuid,${next}::uuid)`,
      )
    ).rows,
  ).toEqual([{ status: "dead_letter" }, { status: "dead_letter" }]);
});
it.each([
  { state: "cancelled", uid: false, want: "not_created" },
  { state: "cancelled", uid: true, want: "cancelled" },
  { state: "unknown", uid: false, want: "unknown" },
  { state: "cancel_unknown", uid: true, want: "unknown" },
])(
  "provider $state UID present=$uid projects $want",
  async ({ state, uid, want }) => {
    const f = await fixture();
    const p = await provider(f);
    await f.bookings.transition({
      reservationId: f.reservationId,
      expectedVersion: 2,
      action: "expert_cancel",
      actor: { type: "expert", id: f.expertId },
      now: new Date(),
      correlationId: randomUUID(),
    });
    await database.db.execute(
      sql`update planerka_booking_operations set state=${state},provider_uid=${uid ? p.booking.uid : null},lease_token=null,lease_until=null where id=${p.op.id}::uuid`,
    );
    expect((await admission(f)).grant.calendar).toBe(want);
  },
);
it("rejects context deletion/recapture and frozen delivery retargeting while allowing FK removal", async () => {
  const f = await fixture();
  await cancel(f);
  const d = await delivery(f);
  await expect(
    database.db.execute(
      sql`delete from booking_notification_contexts where reservation_id=${f.reservationId}::uuid`,
    ),
  ).rejects.toThrow();
  for (const set of [
    sql`source_outbox_id=gen_random_uuid()`,
    sql`recipient_role='expert'`,
    sql`bot_key='other'`,
    sql`source_version=99`,
    sql`external_user_id='999',external_chat_id='999'`,
    sql`recipient_user_id=${f.expertUserId}::uuid`,
    sql`expires_at=clock_timestamp()`,
    sql`created_at=clock_timestamp()`,
  ]) {
    await expect(
      database.db.execute(
        sql`update booking_notification_deliveries set ${set} where id=${d.id}::uuid`,
      ),
    ).rejects.toThrow();
  }
  await expect(
    database.db.execute(
      sql`delete from booking_notification_deliveries where id=${d.id}::uuid`,
    ),
  ).rejects.toThrow();
  await database.db.execute(
    sql`delete from channel_identities where id=${f.clientIdentity}::uuid`,
  );
  expect(
    (
      await database.db.execute(
        sql`select recipient_identity_id,original_identity_id from booking_notification_deliveries where id=${d.id}::uuid`,
      )
    ).rows,
  ).toEqual([
    { recipient_identity_id: null, original_identity_id: f.clientIdentity },
  ]);
});
it.each([
  "sending_no_lease",
  "sending_no_attempt",
  "terminal_lease",
  "partial_worker",
  "invented_count",
])("rejects invalid delivery state %s", async (kind) => {
  const f = await fixture();
  await cancel(f);
  const d = await delivery(f);
  const sets: Record<string, ReturnType<typeof sql>> = {
    sending_no_lease: sql`state='sending'`,
    sending_no_attempt: sql`state='sending',attempt_count=1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',worker_id='synthetic'`,
    terminal_lease: sql`state='suppressed',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute',worker_id='synthetic'`,
    partial_worker: sql`worker_id='synthetic'`,
    invented_count: sql`attempt_count=1`,
  };
  await expect(
    database.db.transaction(async (tx) => {
      await tx.execute(
        sql`update booking_notification_deliveries set ${sets[kind]!} where id=${d.id}::uuid`,
      );
    }),
  ).rejects.toThrow();
});
const privacy = () =>
  new PostgresPrivacyRepository(database.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        (
          ["object_store", "selarti", "planerka", "make_projection"] as const
        ).map((processor) => ({
          processor,
          ciphertext: `synthetic-encrypted:${processor}`,
          keyReference: "synthetic-test-key",
          algorithm: "AES-256-GCM",
          version: "1",
          subjectDeletionKeyHash: createHash("sha256")
            .update(processor)
            .digest("hex"),
        })),
      verifyEnvelope: () => true,
    },
  });
const withdraw = (f: Awaited<ReturnType<typeof fixture>>) =>
  privacy().withdrawConsentAtomically({
    targetUserId: f.command.userId,
    purpose: "client_messaging",
    policyVersion: "client-messaging-v1",
    correlationId: randomUUID(),
  });
const erase = (f: Awaited<ReturnType<typeof fixture>>) =>
  privacy().startErasureAtomically({
    targetUserId: f.command.userId,
    correlationId: randomUUID(),
    idempotencyKey: randomUUID(),
    pseudonym: randomUUID(),
  });
async function blockedBy(pid: number) {
  for (let n = 0; n < 100; n++) {
    const row = (
      await database.db.execute<{ pid: number }>(
        sql`select pid from pg_stat_activity where datname=current_database() and ${pid} = any(pg_blocking_pids(pid)) order by pid limit 1`,
      )
    ).rows[0];
    if (row) return row.pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("expected_database_lock_wait_not_observed");
}
it.each(["withdraw", "erase"])(
  "real %s and admission serialize in both barrier orders",
  async (kind) => {
    for (const privacyFirst of [true, false]) {
      const f = await fixture();
      await cancel(f);
      const claim = (await f.ledger.claimDeliveries(1, "race-worker"))[0]!;
      let privacyWork: Promise<unknown> | undefined;
      let send: ReturnType<typeof f.ledger.admitAndConsume> | undefined;
      await database.db.transaction(async (tx) => {
        const pid = (
          await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
        ).rows[0]!.pid;
        // Hold a downstream table: observe that the real caller already owns its authority barrier.
        await tx.execute(
          privacyFirst
            ? sql`lock table audit_events in share mode`
            : sql`lock table booking_notification_attempts in share mode`,
        );
        if (privacyFirst)
          privacyWork = kind === "withdraw" ? withdraw(f) : erase(f);
        else send = f.ledger.admitAndConsume(claim, "a".repeat(64));
        const winner = await blockedBy(pid);
        if (privacyFirst)
          send = f.ledger.admitAndConsume(claim, "a".repeat(64));
        else privacyWork = kind === "withdraw" ? withdraw(f) : erase(f);
        await blockedBy(winner);
      });
      const grant = await send;
      await privacyWork;
      if (privacyFirst) {
        expect(grant).toBeUndefined();
        expect((await delivery(f)).state).toBe("suppressed");
      } else {
        expect(grant).toBeDefined();
        expect((await delivery(f)).state).toBe("manual");
      }
      expect(
        (
          await database.db.execute(
            sql`select id from booking_notification_attempts where delivery_id=${claim.id}::uuid`,
          )
        ).rows,
      ).toHaveLength(privacyFirst ? 0 : 1);
    }
  },
  15000,
);
it.each(["withdraw", "erase"])(
  "real privacy %s stops queued work and preserves admitted uncertainty",
  async (kind) => {
    const queued = await fixture();
    await cancel(queued);
    const claim = (await queued.ledger.claimDeliveries(1, "privacy"))[0]!;
    await (kind === "withdraw" ? withdraw(queued) : erase(queued));
    expect(
      await queued.ledger.admitAndConsume(claim, "a".repeat(64)),
    ).toBeUndefined();
    expect((await delivery(queued)).state).toBe("suppressed");
    const active = await fixture();
    await cancel(active);
    const { grant } = await admission(active);
    await (kind === "withdraw" ? withdraw(active) : erase(active));
    expect((await delivery(active)).state).toBe("manual");
    expect(await active.ledger.claimDeliveries(20, "after-privacy")).toEqual(
      [],
    );
    expect(
      (
        await database.db.execute(
          sql`select outcome from booking_notification_attempt_facts where attempt_id=${grant.attemptId}::uuid`,
        )
      ).rows,
    ).toEqual([{ outcome: "unknown" }]);
    if (kind === "erase") {
      expect((await delivery(active)).external_chat_id).toBeNull();
      expect(
        (
          await database.db.execute(
            sql`select client_identity_id,client_original_identity_id,client_external_chat_id,client_consent_authority from booking_notification_contexts where reservation_id=${active.reservationId}::uuid`,
          )
        ).rows,
      ).toEqual([
        {
          client_identity_id: null,
          client_original_identity_id: null,
          client_external_chat_id: null,
          client_consent_authority: null,
        },
      ]);
      expect(
        (
          await database.db.execute(
            sql`select id from channel_identities where user_id=${active.command.userId}::uuid`,
          )
        ).rows,
      ).toEqual([]);
    }
  },
);
it("sending confirmation blocks cancellation until unknown becomes manual, never resends", async () => {
  const f = await fixture();
  const p = await provider(f);
  await p.repo.complete(p.op, p.booking);
  const { grant } = await admission(f);
  await f.bookings.transition({
    reservationId: f.reservationId,
    expectedVersion: 3,
    action: "expert_cancel",
    actor: { type: "expert", id: f.expertId },
    now: new Date(),
    correlationId: randomUUID(),
  });
  expect(await f.ledger.claimDeliveries(20, "before-resolution")).toEqual([]);
  await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
  const claims = await f.ledger.claimDeliveries(20, "after-resolution");
  expect(claims.map((c) => c.id)).toEqual([(await delivery(f)).id]);
  expect((await delivery(f, "client.booking_confirmed")).state).toBe("manual");
  expect(
    (
      await database.db.execute(
        sql`select id from booking_notification_attempts where delivery_id=${grant.deliveryId}::uuid`,
      )
    ).rows,
  ).toHaveLength(1);
});
it.each(["not_applied", "failed"] as const)(
  "contradictory receipt after %s preserves newer state/lease and conflict alert",
  async (kind) => {
    const f = await fixture();
    await cancel(f);
    const { grant } = await admission(f);
    await f.ledger.recordOutcome(grant.attemptId, { kind });
    if (kind === "not_applied") {
      await database.db.execute(
        sql`update booking_notification_deliveries set next_attempt_at=clock_timestamp() where id=${grant.deliveryId}::uuid`,
      );
      await admission(f);
    }
    const before = (
      await database.db.execute(
        sql`select state,attempt_count,lease_token,lease_until from booking_notification_deliveries where id=${grant.deliveryId}::uuid`,
      )
    ).rows;
    expect(
      await f.ledger.resolveReceipt(grant.attemptId, {
        botKey: f.botKey,
        chatId: "201",
        messageId: 810,
      }),
    ).toBe(false);
    expect(
      (
        await database.db.execute(
          sql`select state,attempt_count,lease_token,lease_until from booking_notification_deliveries where id=${grant.deliveryId}::uuid`,
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await database.db.execute(
          sql`select status from outbox_operator_alerts where outbox_id=(select source_outbox_id from booking_notification_deliveries where id=${grant.deliveryId}::uuid) and reason_code='booking_notification_receipt_conflict'`,
        )
      ).rows,
    ).toEqual([{ status: "open" }]);
  },
);
it("matching late receipt closes only its uncertainty alerts and retains append-only facts", async () => {
  const f = await fixture();
  await cancel(f);
  const { grant } = await admission(f);
  await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
  await f.ledger.recoverExpired(20);
  await f.ledger.resolveReceipt(grant.attemptId, {
    botKey: f.botKey,
    chatId: "999",
    messageId: 811,
  });
  expect(
    await f.ledger.resolveReceipt(grant.attemptId, {
      botKey: f.botKey,
      chatId: "201",
      messageId: 811,
    }),
  ).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select reason_code,status from outbox_operator_alerts where outbox_id=(select source_outbox_id from booking_notification_deliveries where id=${grant.deliveryId}::uuid) order by reason_code`,
      )
    ).rows,
  ).toEqual([
    { reason_code: "booking_notification_manual", status: "resolved" },
    { reason_code: "booking_notification_receipt_conflict", status: "open" },
    { reason_code: "booking_notification_unknown", status: "resolved" },
  ]);
  expect(
    (
      await database.db.execute(
        sql`select outcome from booking_notification_attempt_facts where attempt_id=${grant.attemptId}::uuid order by outcome`,
      )
    ).rows,
  ).toEqual([{ outcome: "applied" }, { outcome: "unknown" }]);
  for (const statement of [
    sql`delete from booking_notification_attempts where id=${grant.attemptId}::uuid`,
    sql`update booking_notification_attempts set chat_id='999' where id=${grant.attemptId}::uuid`,
    sql`delete from booking_notification_attempt_facts where attempt_id=${grant.attemptId}::uuid`,
    sql`update booking_notification_attempt_facts set reason_code='changed' where attempt_id=${grant.attemptId}::uuid`,
  ])
    await expect(database.db.execute(statement)).rejects.toThrow();
});
// Last: append a superseding approved version; document facts are immutable.
it("rejects a superseded original approved document", async () => {
  const f = await fixture();
  await cancel(f);
  const claim = (await f.ledger.claimDeliveries(20, "worker")).find(
    (c) => c.reservationId === f.reservationId,
  )!;
  await database.db.execute(
    sql`insert into consent_document_versions(document_key,version,title,body,text_sha256,status,effective_at,approved_at,approved_by) select document_key,version+1,title,body,text_sha256,'approved',clock_timestamp(),clock_timestamp(),'synthetic-supersession' from consent_document_versions where document_key='consent.client_messaging' and version=1`,
  );
  expect(await f.ledger.admitAndConsume(claim, "e".repeat(64))).toBeUndefined();
  expect((await delivery(f)).state).toBe("suppressed");
});
