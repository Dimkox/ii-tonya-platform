import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresBookingNotificationRepository } from "../../packages/db/src/repositories/booking-notification-repository.js";
import { PostgresBookingNotificationCallbackRepository } from "../../packages/db/src/repositories/booking-notification-callback-repository.js";
import { createBookingCallbackVault } from "../../packages/integrations/src/telegram/booking-callback-vault.js";
import {
  issueCallback,
  authenticateCallbackToken,
} from "../../packages/integrations/src/telegram/callback-token.js";
import { renderBookingNotification } from "../../packages/worker/src/booking-notification-renderer.js";
import { serializeBookingNotificationWire } from "../../packages/contracts/src/booking-notification-wire.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { captureBookingNotificationIntents } from "../../packages/db/src/repositories/booking-notification-repository.js";
import { PostgresWorkerJobsRepository } from "../../packages/db/src/repositories/worker-jobs-repository.js";
import { PostgresPlanerkaBookingRepository } from "../../packages/db/src/repositories/planerka-booking-repository.js";
import { createBookingNotificationTransport } from "../../packages/integrations/src/telegram/booking-notification-transport.js";

let database: TestDatabase;
const secret = Buffer.alloc(32, 81);
const vault = createBookingCallbackVault({
  activeKeyId: "wire-test",
  keys: new Map([["wire-test", Buffer.alloc(32, 82)]]),
});
const preparation = {
  render: renderBookingNotification,
  open: vault.open,
  authenticateToken: (token: string) =>
    authenticateCallbackToken(token, secret),
};
beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows,
  ).toEqual([{ server_version_num: "170005" }]);
  await database.migrate();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);

async function fixture(
  control: "enabled" | "disabled" | "missing" = "enabled",
  sharedBot?: string,
) {
  const f = await database.createReservableFixture();
  const botKey = sharedBot ?? randomUUID();
  const chatId = sharedBot ? "302" : "301";
  if (control !== "missing")
    await database.db.execute(
      sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},${control === "enabled"}) on conflict(bot_key) do nothing`,
    );
  await database.db.execute(
    sql`update slots set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '2 days 1 hour',observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set ends_at=starts_at+interval '1 hour' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) select user_id,'telegram',${chatId},${chatId},${botKey},'active' from experts where id=${f.expertId}::uuid`,
  );
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${f.command.userId}::uuid,'telegram',${sharedBot ? "402" : "401"},${sharedBot ? "402" : "401"},${botKey},'active')`,
  );
  await seedClientConsent(database.db, f.command.userId, "client_messaging");
  const bookings = new PostgresBookingRepository(database.db, {
    notificationOrigin: {
      botKey,
      messagingPolicyVersion: "client-messaging-v1",
    },
  });
  f.command.now = new Date();
  const reserved = await bookings.reserve(f.command);
  if (reserved.kind === "unavailable") throw Error("wire_fixture_unavailable");
  const deliveryId = (
    await database.db.execute<{ id: string }>(
      sql`select id from booking_notification_deliveries where reservation_id=${reserved.reservationId}::uuid and kind='telegram.reservation_request'`,
    )
  ).rows[0]?.id;
  const issuer = new PostgresBookingNotificationCallbackRepository(
    database.db,
    botKey,
    {
      ...vault,
      issue: async (claims) => {
        const token = await issueCallback(claims, secret, {
          put: async () => {},
          peek: async () => null,
          consumeIfValid: async () => null,
        });
        return { token, tokenHash: authenticateCallbackToken(token, secret)! };
      },
    },
  );
  const ledger = new PostgresBookingNotificationRepository(
    database.db,
    botKey,
    preparation,
  );
  return { ...f, botKey, bookings, reserved, deliveryId, issuer, ledger };
}
async function ready() {
  const f = await fixture();
  const pair = await f.issuer.issueApprovalPair(f.deliveryId!);
  expect(pair).not.toBeNull();
  const claim = (await f.ledger.claimDeliveries(1, "wire-worker"))[0]!;
  return { ...f, pair: pair!, claim };
}
it("commits the digest of the exact rendered persisted callback pair", async () => {
  const f = await ready();
  const grant = await f.ledger.admitPrepared(f.claim);
  expect(grant).toBeDefined();
  expect(f.claim.topic).toBe("telegram.reservation_request");
  const body = JSON.parse(grant!.body);
  expect(body.chat_id).toBe("301");
  expect(
    body.reply_markup.inline_keyboard[0].map(
      (b: { callback_data: string }) => b.callback_data,
    ),
  ).toEqual([f.pair.confirm, f.pair.cancel]);
  expect(grant!.body).toBe(
    serializeBookingNotificationWire({
      chatId: "301",
      text: body.text,
      replyMarkup: body.reply_markup,
    }),
  );
  expect(grant!.bodySha256).toBe(
    createHash("sha256").update(grant!.body, "utf8").digest("hex"),
  );
  expect(
    (
      await database.db.execute(
        sql`select request_digest,wire_version from booking_notification_attempts where id=${grant!.attemptId}::uuid`,
      )
    ).rows,
  ).toEqual([{ request_digest: grant!.bodySha256, wire_version: 1 }]);
  expect(await f.ledger.admitPrepared(f.claim)).toBeUndefined();
});
it.each(["disabled", "missing"] as const)(
  "%s control denies producer capture without cancelling reservation",
  async (control) => {
    const f = await fixture(control);
    expect(await f.ledger.hasBotControl()).toBe(control !== "missing");
    if (control === "missing")
      expect(await f.ledger.setAdmissionEnabled(false)).toBe(false);
    expect(f.reserved.kind).toBe("reserved");
    expect(f.deliveryId).toBeUndefined();
  },
);
it("admission off preserves draining an existing intent", async () => {
  const f = await ready();
  await database.db.execute(
    sql`update booking_notification_bot_controls set admission_enabled=false where bot_key=${f.botKey}`,
  );
  expect(await f.ledger.admitPrepared(f.claim)).toBeDefined();
});
it.each(["paused", "throttled", "missing"] as const)(
  "%s shared control consumes no attempt",
  async (state) => {
    const f = await ready();
    if (state === "missing")
      await database.db.execute(
        sql`delete from booking_notification_bot_controls where bot_key=${f.botKey}`,
      );
    else if (state === "paused")
      await database.db.execute(
        sql`update booking_notification_bot_controls set paused_at=clock_timestamp(),pause_reason='bot_rejected' where bot_key=${f.botKey}`,
      );
    else
      await database.db.execute(
        sql`update booking_notification_bot_controls set not_before=clock_timestamp()+interval '2 hours' where bot_key=${f.botKey}`,
      );
    expect(await f.ledger.admitPrepared(f.claim)).toBeUndefined();
    expect(
      (
        await database.db.execute(
          sql`select attempt_count from booking_notification_deliveries where id=${f.deliveryId}::uuid`,
        )
      ).rows,
    ).toEqual([{ attempt_count: 0 }]);
  },
);
it("missing preparation fails closed while legacy admission remains wire-null", async () => {
  const f = await ready();
  const old = new PostgresBookingNotificationRepository(database.db, f.botKey);
  expect(await old.admitPrepared(f.claim)).toBeUndefined();
  const grant = await old.admitAndConsume(f.claim, "a".repeat(64));
  expect(
    (
      await database.db.execute(
        sql`select wire_version from booking_notification_attempts where id=${grant!.attemptId}::uuid`,
      )
    ).rows,
  ).toEqual([{ wire_version: null }]);
});
it.each(["open", "authenticateToken", "render"] as const)(
  "%s failure cannot consume an attempt",
  async (port) => {
    const f = await ready();
    const broken = {
      ...preparation,
      [port]: () => {
        throw Error("synthetic-port-failure");
      },
    };
    const ledger = new PostgresBookingNotificationRepository(
      database.db,
      f.botKey,
      broken,
    );
    expect(await ledger.admitPrepared(f.claim)).toBeUndefined();
    expect(
      (
        await database.db.execute(
          sql`select attempt_count from booking_notification_deliveries where id=${f.deliveryId}::uuid`,
        )
      ).rows,
    ).toEqual([{ attempt_count: 0 }]);
  },
);
it("rejects a valid token substituted for the persisted action", async () => {
  const f = await ready();
  const ledger = new PostgresBookingNotificationRepository(
    database.db,
    f.botKey,
    { ...preparation, open: () => f.pair.cancel },
  );
  expect(await ledger.admitPrepared(f.claim)).toBeUndefined();
});
it("persists bot pause with the outcome and retains it across repository restart", async () => {
  const f = await ready();
  const grant = (await f.ledger.admitPrepared(f.claim))!;
  expect(
    await f.ledger.recordOutcome(grant.attemptId, {
      kind: "failed",
      reasonCode: "bot_rejected",
      pauseBot: true,
    }),
  ).toBe(true);
  const restarted = new PostgresBookingNotificationRepository(
    database.db,
    f.botKey,
    preparation,
  );
  expect(restarted).toBeDefined();
  expect(
    (
      await database.db.execute(
        sql`select pause_reason,paused_at is not null as paused from booking_notification_bot_controls where bot_key=${f.botKey}`,
      )
    ).rows,
  ).toEqual([{ pause_reason: "bot_rejected", paused: true }]);
});
it("persists the full retry-after as a shared bot deadline", async () => {
  const f = await ready();
  const grant = (await f.ledger.admitPrepared(f.claim))!;
  await f.ledger.recordOutcome(grant.attemptId, {
    kind: "not_applied",
    retryAfterSeconds: 7200,
  });
  expect(
    (
      await database.db.execute(
        sql`select not_before>clock_timestamp()+interval '7190 seconds' as retained from booking_notification_bot_controls where bot_key=${f.botKey}`,
      )
    ).rows,
  ).toEqual([{ retained: true }]);
});
it("a second worker cannot admit another delivery after shared bot pause", async () => {
  const a = await ready();
  const b = await fixture("enabled", a.botKey);
  await b.issuer.issueApprovalPair(b.deliveryId!);
  const second = (await b.ledger.claimDeliveries(1, "second-worker"))[0]!;
  expect(second.id).toBe(b.deliveryId);
  const granted = (await a.ledger.admitPrepared(a.claim))!;
  await a.ledger.recordOutcome(granted.attemptId, {
    kind: "failed",
    reasonCode: "bot_rejected",
    pauseBot: true,
  });
  expect(await b.ledger.admitPrepared(second)).toBeUndefined();
});
it("pause committed while admission waits on control prevents consumption", async () => {
  const f = await ready();
  const blocker = await database.db.$client.connect();
  let pending: ReturnType<typeof f.ledger.admitPrepared> | undefined;
  try {
    await blocker.query("begin");
    const pid = (
      await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")
    ).rows[0]!.pid;
    await blocker.query(
      "select bot_key from booking_notification_bot_controls where bot_key=$1 for update",
      [f.botKey],
    );
    pending = f.ledger.admitPrepared(f.claim);
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const rows = await database.db.$client.query<{ blocked: boolean }>(
        "select exists(select 1 from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))) as blocked",
        [pid],
      );
      if (rows.rows[0]!.blocked) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(observed).toBe(true);
    await blocker.query(
      "update booking_notification_bot_controls set paused_at=clock_timestamp(),pause_reason='bot_rejected' where bot_key=$1",
      [f.botKey],
    );
    await blocker.query("commit");
    expect(await pending).toBeUndefined();
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await pending;
  }
});
it("a renderer cannot substitute authenticated callback buttons", async () => {
  const f = await ready();
  const ledger = new PostgresBookingNotificationRepository(
    database.db,
    f.botKey,
    {
      ...preparation,
      render(view) {
        const result = renderBookingNotification(view);
        if (result.kind !== "rendered" || !result.replyMarkup) return result;
        return {
          ...result,
          replyMarkup: {
            inline_keyboard: [
              [
                { text: "Подтвердить", callback_data: f.pair.cancel },
                { text: "Отказать", callback_data: f.pair.confirm },
              ],
            ],
          },
        };
      },
    },
  );
  expect(await ledger.admitPrepared(f.claim)).toBeUndefined();
});
it("disabled capture also applies to a later cancellation, without removing prior work", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update booking_notification_bot_controls set admission_enabled=false where bot_key=${f.botKey}`,
  );
  await f.bookings.transition({
    reservationId: f.reserved.reservationId,
    expectedVersion: f.reserved.version,
    action: "client_cancel",
    actor: { type: "client", id: f.command.userId },
    now: new Date(),
    correlationId: "wire-cancel",
  });
  expect(
    (
      await database.db.execute(
        sql`select kind from booking_notification_deliveries where reservation_id=${f.reserved.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([{ kind: "telegram.reservation_request" }]);
});
it.each(["completed", "no_show"] as const)(
  "%s prepared view omits calendar cancellation evidence",
  async (status) => {
    const f = await fixture();
    const topic =
      status === "completed"
        ? "client.booking_completed"
        : "client.booking_no_show";
    const action = status === "completed" ? "complete" : "mark_no_show";
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`update reservations set status=${status},version=version+1 where id=${f.reserved.reservationId}::uuid`,
      );
      const source = (
        await tx.execute<{ id: string }>(
          sql`insert into integration_outbox(idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash) values(${`${f.reserved.reservationId}:2:${topic}`},${topic},${JSON.stringify({ reservationId: f.reserved.reservationId, version: 2, charge: 0, action, decision: status })},'wire-terminal','wire-terminal','synthetic') returning id`,
        )
      ).rows[0]!;
      await captureBookingNotificationIntents(tx, source.id);
    });
    const ledger = new PostgresBookingNotificationRepository(
      database.db,
      f.botKey,
      {
        ...preparation,
        render(view) {
          expect(view).not.toHaveProperty("calendar");
          return renderBookingNotification(view);
        },
      },
    );
    const claim = (await ledger.claimDeliveries(1, "terminal-worker"))[0]!;
    expect(claim.topic).toBe(topic);
    expect(await ledger.admitPrepared(claim)).toBeDefined();
  },
);
it("late bot failure still pauses after recovery recorded unknown", async () => {
  const f = await ready();
  const grant = (await f.ledger.admitPrepared(f.claim))!;
  await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
  await f.ledger.recoverExpired(1);
  expect(
    await f.ledger.recordOutcome(grant.attemptId, {
      kind: "failed",
      reasonCode: "bot_rejected",
      pauseBot: true,
    }),
  ).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select paused_at is not null as paused from booking_notification_bot_controls where bot_key=${f.botKey}`,
      )
    ).rows,
  ).toEqual([{ paused: true }]);
  expect(
    (
      await database.db.execute(
        sql`select outcome from booking_notification_attempt_facts where attempt_id=${grant.attemptId}::uuid`,
      )
    ).rows,
  ).toEqual([{ outcome: "unknown" }]);
  expect(
    (
      await database.db.execute(
        sql`select state from booking_notification_deliveries where id=${f.deliveryId}::uuid`,
      )
    ).rows,
  ).toEqual([{ state: "manual" }]);
  expect(await f.ledger.claimDeliveries(1, "no-resend-worker")).toEqual([]);
});
it.each(["failed", "not_applied"] as const)(
  "late %s is acknowledged without replacing recovered uncertainty",
  async (kind) => {
    const f = await ready();
    const grant = (await f.ledger.admitPrepared(f.claim))!;
    await f.ledger.recordOutcome(grant.attemptId, { kind: "unknown" });
    await f.ledger.recoverExpired(1);
    const second = await fixture("enabled", f.botKey);
    await second.issuer.issueApprovalPair(second.deliveryId!);
    const claim = (
      await second.ledger.claimDeliveries(1, "late-second-worker")
    )[0]!;
    expect(
      await f.ledger.recordOutcome(
        grant.attemptId,
        kind === "not_applied"
          ? { kind, retryAfterSeconds: 7200 }
          : { kind, reasonCode: "recipient_rejected", pauseBot: false },
      ),
    ).toBe(true);
    expect(
      (
        await database.db.execute(
          sql`select state,attempt_count from booking_notification_deliveries where id=${f.deliveryId}::uuid`,
        )
      ).rows,
    ).toEqual([{ state: "manual", attempt_count: 1 }]);
    expect(
      (
        await database.db.execute(
          sql`select outcome from booking_notification_attempt_facts where attempt_id=${grant.attemptId}::uuid`,
        )
      ).rows,
    ).toEqual([{ outcome: "unknown" }]);
    expect(
      (
        await database.db.execute(
          sql`select reason_code from outbox_operator_alerts where outbox_id=(select source_outbox_id from booking_notification_deliveries where id=${f.deliveryId}::uuid) and reason_code=${`booking_notification_outcome_conflict_${kind}`}`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(await f.ledger.admitPrepared(f.claim)).toBeUndefined();
    if (kind === "not_applied") {
      expect(
        (
          await database.db.execute(
            sql`select not_before>clock_timestamp()+interval '7190 seconds' as retained from booking_notification_bot_controls where bot_key=${f.botKey}`,
          )
        ).rows,
      ).toEqual([{ retained: true }]);
      expect(await second.ledger.admitPrepared(claim)).toBeUndefined();
      expect(
        (
          await database.db.execute(
            sql`select attempt_count from booking_notification_deliveries where id=${second.deliveryId}::uuid`,
          )
        ).rows,
      ).toEqual([{ attempt_count: 0 }]);
    }
  },
);
it.each([
  ["deliveryId", "00000000-0000-4000-8000-000000000001"],
  ["notificationId", "00000000-0000-4000-8000-000000000002"],
  ["reservationId", "00000000-0000-4000-8000-000000000003"],
  ["expertId", "00000000-0000-4000-8000-000000000004"],
  ["botKey", "different_bot"],
  ["chatId", "999"],
  ["action", "confirm"],
  ["version", 999],
  ["expiresAtEpochSeconds", 1],
] as const)(
  "real vault rejects tampered admission AAD %s before consumption",
  async (field, value) => {
    const f = await ready();
    let opened = 0;
    const ledger = new PostgresBookingNotificationRepository(
      database.db,
      f.botKey,
      {
        ...preparation,
        open(envelope, binding) {
          opened++;
          return vault.open(envelope, { ...binding, [field]: value });
        },
      },
    );
    expect(await ledger.admitPrepared(f.claim)).toBeUndefined();
    expect(opened).toBeGreaterThan(0);
    expect(
      (
        await database.db.execute(
          sql`select attempt_count from booking_notification_deliveries where id=${f.deliveryId}::uuid`,
        )
      ).rows,
    ).toEqual([{ attempt_count: 0 }]);
  },
);
it.each([true, false])(
  "expiry batch obeys durable capture gate=%s for both recipients",
  async (enabled) => {
    const f = await fixture();
    await database.db.execute(
      sql`update booking_notification_bot_controls set admission_enabled=${enabled} where bot_key=${f.botKey}`,
    );
    await database.db.execute(
      sql`update reservations set created_at=clock_timestamp()-interval '1 hour',reserved_until=clock_timestamp()-interval '1 second' where id=${f.reserved.reservationId}::uuid`,
    );
    await new PostgresWorkerJobsRepository(database.db).expireDueBatch({
      now: new Date(),
      batchSize: 20,
    });
    const rows = (
      await database.db.execute<{ kind: string }>(
        sql`select kind from booking_notification_deliveries where reservation_id=${f.reserved.reservationId}::uuid and kind in ('client.reservation_expired','expert.reservation_expired') order by kind`,
      )
    ).rows;
    expect(rows.map((r) => r.kind)).toEqual(
      enabled
        ? ["client.reservation_expired", "expert.reservation_expired"]
        : [],
    );
  },
);
it("calendar rejection's two-source transaction obeys disabled capture", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update slots set provider='planerka' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) select expert_service_id,9876,1,60,'UTC',true,clock_timestamp() from slots where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  await f.bookings.transition({
    reservationId: f.reserved.reservationId,
    expectedVersion: f.reserved.version,
    action: "expert_confirm",
    actor: { type: "expert", id: f.expertId },
    now: new Date(),
    correlationId: "wire-calendar",
  });
  const provider = new PostgresPlanerkaBookingRepository(database.db);
  const op = (await provider.claim(9876, true))!;
  expect(op).toBeDefined();
  await database.db.execute(
    sql`update booking_notification_bot_controls set admission_enabled=false where bot_key=${f.botKey}`,
  );
  await provider.reject(op);
  expect(
    (
      await database.db.execute(
        sql`select status from reservations where id=${f.reserved.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([{ status: "expired" }]);
  expect(
    (
      await database.db.execute(
        sql`select kind from booking_notification_deliveries where reservation_id=${f.reserved.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([{ kind: "telegram.reservation_request" }]);
});
it("explicit owner admission toggle preserves pause and throttle", async () => {
  const f = await fixture();
  await database.db.execute(
    sql`update booking_notification_bot_controls set paused_at=clock_timestamp(),pause_reason='bot_rejected',not_before=clock_timestamp()+interval '2 hours' where bot_key=${f.botKey}`,
  );
  expect(await f.ledger.setAdmissionEnabled(false)).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select admission_enabled,paused_at is not null as paused,pause_reason,not_before>clock_timestamp()+interval '7190 seconds' as throttled from booking_notification_bot_controls where bot_key=${f.botKey}`,
      )
    ).rows,
  ).toEqual([
    {
      admission_enabled: false,
      paused: true,
      pause_reason: "bot_rejected",
      throttled: true,
    },
  ]);
  expect(await f.ledger.setAdmissionEnabled(true)).toBe(true);
  expect(
    (
      await database.db.execute(
        sql`select paused_at is not null as paused from booking_notification_bot_controls where bot_key=${f.botKey}`,
      )
    ).rows,
  ).toEqual([{ paused: true }]);
});
it("local journey binds prepared HTTP receipt, ct2 decision and provider completion to one confirmation", async () => {
  const f = await ready();
  await database.db.execute(
    sql`update slots set provider='planerka' where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) select expert_service_id,9877,1,60,'UTC',true,clock_timestamp() from slots where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  const bodies: string[] = [];
  const transport = createBookingNotificationTransport({
    botKey: f.botKey,
    token: `12345:${"a".repeat(35)}`,
    fetch: async (_url, init) => {
      const body = String(init?.body);
      bodies.push(body);
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 500 + bodies.length,
            from: { id: 12345, is_bot: true },
            chat: { id: Number(JSON.parse(body).chat_id), type: "private" },
          },
        }),
        { status: 200 },
      );
    },
  });
  const request = (await f.ledger.admitPrepared(f.claim))!;
  const sent = await transport.sendPrepared(request);
  expect(sent.kind).toBe("applied");
  if (sent.kind !== "applied") throw Error("synthetic_request_receipt_missing");
  expect(bodies).toEqual([request.body]);
  expect(await f.ledger.resolveReceipt(request.attemptId, sent.receipt)).toBe(
    true,
  );
  const decision = await f.bookings.transitionFromTelegramCallback({
    tokenHash: authenticateCallbackToken(f.pair.confirm, secret),
    reservationId: f.reserved.reservationId,
    expertId: f.expertId,
    action: "confirm",
    version: 1,
    now: new Date(),
    correlationId: "wire-journey",
    telegramContext: {
      botKey: f.botKey,
      telegramUserId: "301",
      chatId: "301",
      messageId: sent.receipt.messageId,
      deliveryId: f.deliveryId!,
    },
  });
  expect(decision).toMatchObject({ status: "reserved", version: 2 });
  expect(await f.ledger.claimDeliveries(1, "before-provider")).toEqual([]);
  const calendar = new PostgresPlanerkaBookingRepository(database.db);
  const op = (await calendar.claim(9877, true))!;
  expect(await calendar.admitSend(op)).toBe(true);
  expect(
    await calendar.complete(op, {
      uid: `synthetic_${op.id}`,
      eventTypeId: op.eventTypeId,
      start: op.request.start,
      end: new Date(Date.parse(op.request.start) + 3600000).toISOString(),
      status: "accepted",
      hosts: [{ id: op.accountId }],
      attendees: [op.request.attendee],
    }),
  ).toBe(true);
  const confirmationClaim = (
    await f.ledger.claimDeliveries(1, "after-provider")
  )[0]!;
  expect(confirmationClaim.topic).toBe("client.booking_confirmed");
  const confirmation = (await f.ledger.admitPrepared(confirmationClaim))!;
  expect(JSON.parse(confirmation.body)).toMatchObject({ chat_id: "401" });
  expect(JSON.parse(confirmation.body)).not.toHaveProperty("reply_markup");
  const confirmed = await transport.sendPrepared(confirmation);
  if (confirmed.kind !== "applied")
    throw Error("synthetic_confirmation_receipt_missing");
  expect(
    await f.ledger.resolveReceipt(confirmation.attemptId, confirmed.receipt),
  ).toBe(true);
  expect(bodies).toEqual([request.body, confirmation.body]);
  expect(await f.ledger.admitPrepared(confirmationClaim)).toBeUndefined();
  expect(await f.ledger.claimDeliveries(1, "journey-finished")).toEqual([]);
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int as count from booking_notification_deliveries where reservation_id=${f.reserved.reservationId}::uuid and kind='client.booking_confirmed' and state='delivered'`,
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
