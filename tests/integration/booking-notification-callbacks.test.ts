import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  PostgresBookingRepository,
  type TransitionTelegramCallbackCommand,
} from "../../packages/db/src/repositories/booking-repository.js";
import { PostgresBookingNotificationRepository } from "../../packages/db/src/repositories/booking-notification-repository.js";
import {
  PostgresBookingNotificationCallbackRepository,
  type BookingApprovalCrypto,
} from "../../packages/db/src/repositories/booking-notification-callback-repository.js";
import { createBookingService } from "../../packages/application/src/booking-service.js";
import {
  issueCallback,
  authenticateCallback,
  type ExpertCallbackClaims,
} from "../../packages/integrations/src/telegram/callback-token.js";
import { createBookingCallbackVault } from "../../packages/integrations/src/telegram/booking-callback-vault.js";

let database: TestDatabase;
const secret = Buffer.alloc(32, 71);
const vault = createBookingCallbackVault({
  activeKeyId: "test-key",
  keys: new Map([["test-key", Buffer.alloc(32, 72)]]),
});
const issued = new Map<string, ExpertCallbackClaims>();
const store = {
  put: async (hash: string, claims: ExpertCallbackClaims) => {
    issued.set(hash, claims);
  },
  peek: async (hash: string) => issued.get(hash) ?? null,
  consumeIfValid: async () => null,
};
const crypto: BookingApprovalCrypto = {
  ...vault,
  issue: async (claims) => {
    const token = await issueCallback(claims, secret, store);
    return { token, tokenHash: nonceHash(token) };
  },
};
const nonceHash = (token: string) =>
  createHash("sha256")
    .update(Buffer.from(token.slice(4), "base64url").subarray(1, 17))
    .digest("hex");
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
let account = 9000;
async function fixture() {
  const f = await database.createReservableFixture();
  f.command.now = new Date();
  const botKey = randomUUID();
  await database.db.execute(
    sql`insert into booking_notification_bot_controls(bot_key,admission_enabled) values(${botKey},true)`,
  );
  await database.db.execute(
    sql`update slots set provider='planerka',starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '2 days 1 hour',observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set ends_at=starts_at+interval '1 hour' where id=${f.command.slotId}::uuid`,
  );
  f.command.now = new Date();
  const expertUser = (
    await database.db.execute<{ id: string }>(
      sql`select user_id as id from experts where id=${f.expertId}::uuid`,
    )
  ).rows[0]!.id;
  const identity = (
    await database.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${expertUser}::uuid,'telegram','301','301',${botKey},'active') returning id`,
    )
  ).rows[0]!.id;
  await database.db.execute(
    sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at) select expert_service_id,${++account},1,60,'UTC',true,clock_timestamp() from slots where id=${f.command.slotId}::uuid`,
  );
  await database.db.execute(
    sql`update slots set observed_at=clock_timestamp() where id=${f.command.slotId}::uuid`,
  );
  const bookings = new PostgresBookingRepository(database.db, {
    notificationOrigin: {
      botKey,
      messagingPolicyVersion: "client-messaging-v1",
    },
  });
  f.command.now = new Date();
  const result = await bookings.reserve(f.command);
  if (result.kind === "unavailable") throw Error("fixture_not_reserved");
  const deliveryId = (
    await database.db.execute<{ id: string }>(
      sql`select id from booking_notification_deliveries where reservation_id=${result.reservationId}::uuid and kind='telegram.reservation_request'`,
    )
  ).rows[0]!.id;
  return {
    ...f,
    bookings,
    botKey,
    identity,
    expertUser,
    reservationId: result.reservationId,
    deliveryId,
    issuer: new PostgresBookingNotificationCallbackRepository(
      database.db,
      botKey,
      crypto,
    ),
    ledger: new PostgresBookingNotificationRepository(database.db, botKey),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pair(f: Fixture) {
  const p = await f.issuer.issueApprovalPair(f.deliveryId);
  expect(p).not.toBeNull();
  return p!;
}
async function sent(
  f: Fixture,
  outcome:
    | "delivered"
    | "unknown"
    | "sending"
    | "not_applied"
    | "failed" = "delivered",
) {
  const p = await pair(f);
  const claim = (await f.ledger.claimDeliveries(1, "callback-test"))[0]!;
  const grant = await f.ledger.admitAndConsume(claim, "a".repeat(64));
  expect(grant).toBeDefined();
  if (outcome === "delivered")
    expect(
      await f.ledger.resolveReceipt(grant!.attemptId, {
        botKey: f.botKey,
        chatId: "301",
        messageId: 501,
      }),
    ).toBe(true);
  else if (outcome !== "sending")
    await f.ledger.recordOutcome(grant!.attemptId, { kind: outcome });
  return { ...p, grant: grant! };
}
function command(
  f: Fixture,
  token: string,
  action: "confirm" | "cancel" = "confirm",
): TransitionTelegramCallbackCommand {
  return {
    tokenHash: nonceHash(token),
    reservationId: f.reservationId,
    expertId: f.expertId,
    action,
    version: 1,
    now: new Date("2000-01-01"),
    correlationId: randomUUID(),
    telegramContext: {
      botKey: f.botKey,
      telegramUserId: "301",
      chatId: "301",
      messageId: 501,
      deliveryId: f.deliveryId,
    },
  };
}
async function counts(f: Fixture) {
  return (
    await database.db.execute(
      sql`select (select count(*)::int from notifications where reservation_id=${f.reservationId}::uuid and callback_consumed_at is not null) consumed,(select count(*)::int from planerka_booking_operations where reservation_id=${f.reservationId}::uuid) operations,(select count(*)::int from audit_events where object_id=${f.reservationId}::uuid and action in ('reservation.expert_confirm','reservation.expert_cancel')) transitions`,
    )
  ).rows[0];
}

// Dropping atomic issuance, stable reuse, recipient/receipt/clock fences or replay
// evidence should fail these cases. No external call or old test import occurs.
it("atomically issues real ct2/vault pair with exact claims, common expiry and stable concurrent reuse", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    f.issuer.issueApprovalPair(f.deliveryId),
    f.issuer.issueApprovalPair(f.deliveryId),
  ]);
  expect(a).not.toBeNull();
  expect(b).toEqual(a);
  expect(a!.confirm).not.toBe(a!.cancel);
  for (const action of ["confirm", "cancel"] as const) {
    const auth = await authenticateCallback(
      a![action],
      "301",
      {
        telegramUserId: "301",
        expertId: f.expertId,
        active: true,
        verified: true,
      },
      secret,
      store,
      new Date(),
    );
    expect(auth.claims).toMatchObject({
      reservationId: f.reservationId,
      expertId: f.expertId,
      action,
      version: 1,
    });
    expect(await f.issuer.findLinkedCallback(auth.tokenHash)).toEqual({
      deliveryId: f.deliveryId,
      reservationId: f.reservationId,
      expertId: f.expertId,
      action,
      version: 1,
    });
  }
  const rows = (
    await database.db.execute<{
      expires: string;
      hash: string;
      claims: string;
    }>(
      sql`select c.expires_at::text as expires,c.callback_token_hash as hash,n.callback_claims as claims from booking_notification_callbacks c join notifications n on n.id=c.notification_id where c.delivery_id=${f.deliveryId}::uuid order by action`,
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0]!.expires).toBe(rows[1]!.expires);
  expect(
    (
      await database.db.execute(
        sql`select bool_and(c.expires_at<=r.reserved_until and c.expires_at<=s.starts_at and c.expires_at=n.callback_expires_at and c.callback_token_hash=n.callback_token_hash) as valid from booking_notification_callbacks c join notifications n on n.id=c.notification_id join reservations r on r.id=n.reservation_id join slots s on s.id=r.slot_id where c.delivery_id=${f.deliveryId}::uuid`,
      )
    ).rows,
  ).toEqual([{ valid: true }]);
});
it("rolls both registry rows and links back when sealing the second action fails", async () => {
  const f = await fixture();
  const broken: BookingApprovalCrypto = {
    ...crypto,
    seal: (token, binding) => {
      if (binding.action === "cancel") throw Error("synthetic-seal-failure");
      return crypto.seal(token, binding);
    },
  };
  await expect(
    new PostgresBookingNotificationCallbackRepository(
      database.db,
      f.botKey,
      broken,
    ).issueApprovalPair(f.deliveryId),
  ).rejects.toThrow();
  expect(
    (
      await database.db.execute(
        sql`select id from notifications where reservation_id=${f.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await database.db.execute(
        sql`select notification_id from booking_notification_callbacks where delivery_id=${f.deliveryId}::uuid`,
      )
    ).rows,
  ).toEqual([]);
});
it.each(["partial", "redacted", "consumed", "hash", "claims", "ciphertext"])(
  "never repairs or regenerates a %s pair",
  async (kind) => {
    const f = await fixture();
    const p = await pair(f);
    if (kind === "partial")
      await database.db.execute(
        sql`delete from booking_notification_callbacks where delivery_id=${f.deliveryId}::uuid and action='cancel'`,
      );
    else if (kind === "redacted")
      await database.db.execute(
        sql`update booking_notification_callbacks set callback_token_ciphertext=null,encryption_key_id=null where delivery_id=${f.deliveryId}::uuid and action='cancel'`,
      );
    else if (kind === "ciphertext")
      await database.db.execute(
        sql`update booking_notification_callbacks set callback_token_ciphertext='invalid' where delivery_id=${f.deliveryId}::uuid and action='cancel'`,
      );
    else
      await database.db.execute(
        sql`update notifications set ${kind === "consumed" ? sql`callback_consumed_at=clock_timestamp()` : kind === "hash" ? sql`callback_token_hash=${"f".repeat(64)}` : sql`callback_claims='{}'`} where callback_token_hash=${nonceHash(p.cancel)}`,
      );
    expect(await f.issuer.issueApprovalPair(f.deliveryId)).toBeNull();
    expect(
      (
        await database.db.execute(
          sql`select id from notifications where reservation_id=${f.reservationId}::uuid`,
        )
      ).rows,
    ).toHaveLength(2);
  },
);
it.each([
  "relinked",
  "inactive",
  "unverified",
  "stale_slot",
  "past_slot",
  "expired",
  "provider_operation",
  "wrong_bot",
])("refuses issuer authority: %s", async (kind) => {
  const f = await fixture();
  if (kind === "relinked")
    await database.db.execute(
      sql`update channel_identities set external_id='302',external_chat_id='302' where id=${f.identity}::uuid`,
    );
  if (kind === "inactive" || kind === "unverified")
    await database.db.execute(
      sql`update experts set ${kind === "inactive" ? sql`active=false` : sql`verified=false`} where id=${f.expertId}::uuid`,
    );
  if (kind === "stale_slot")
    await database.db.execute(
      sql`update slots set observed_at=clock_timestamp()-interval '1 hour' where id=${f.command.slotId}::uuid`,
    );
  if (kind === "past_slot")
    await database.db.execute(
      sql`update slots set starts_at=clock_timestamp()-interval '1 second' where id=${f.command.slotId}::uuid`,
    );
  if (kind === "expired")
    await database.db.execute(
      sql`update reservations set created_at=clock_timestamp()-interval '1 hour',reserved_until=clock_timestamp()-interval '1 second' where id=${f.reservationId}::uuid`,
    );
  if (kind === "provider_operation")
    await f.bookings.transition({
      reservationId: f.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: f.expertId },
      now: new Date(),
      correlationId: randomUUID(),
    });
  const issuer =
    kind === "wrong_bot"
      ? new PostgresBookingNotificationCallbackRepository(
          database.db,
          "other",
          crypto,
        )
      : f.issuer;
  expect(await issuer.issueApprovalPair(f.deliveryId)).toBeNull();
  expect(
    (
      await database.db.execute(
        sql`select id from notifications where reservation_id=${f.reservationId}::uuid`,
      )
    ).rows,
  ).toEqual([]);
});
it("application forwards context and confirmation stays reserved/calendar_pending with one operation", async () => {
  const f = await fixture();
  const p = await sent(f);
  const c = command(f, p.confirm);
  const service = createBookingService({
    repository: f.bookings,
    clock: { now: () => new Date("2000-01-01") },
  });
  expect(
    await service.confirmByExpert({
      reservationId: f.reservationId,
      expertId: f.expertId,
      callbackTokenHash: c.tokenHash,
      expectedVersion: 1,
      correlationId: c.correlationId,
      telegramContext: c.telegramContext!,
    }),
  ).toEqual({ reservationId: f.reservationId, status: "reserved", version: 2 });
  expect(await counts(f)).toEqual({
    consumed: 1,
    operations: 1,
    transitions: 1,
  });
  expect(
    (
      await database.db.execute(
        sql`select id from integration_outbox where topic='client.booking_confirmed' and payload->>'reservationId'=${f.reservationId}`,
      )
    ).rows,
  ).toEqual([]);
});
it.each([
  "bot",
  "chat",
  "user",
  "message",
  "delivery",
  "missing_context",
  "wrong_action",
  "wrong_version",
  "relinked",
  "inactive",
  "unverified",
])("rejects bound consumption mismatch %s without mutation", async (kind) => {
  const f = await fixture();
  const p = await sent(f);
  const c = command(f, p.confirm);
  if (kind === "missing_context") delete c.telegramContext;
  else if (kind === "bot") c.telegramContext!.botKey = "other";
  else if (kind === "chat") c.telegramContext!.chatId = "302";
  else if (kind === "user") c.telegramContext!.telegramUserId = "302";
  else if (kind === "message") c.telegramContext!.messageId = 502;
  else if (kind === "delivery") c.telegramContext!.deliveryId = randomUUID();
  else if (kind === "wrong_action") c.action = "cancel";
  else if (kind === "wrong_version") c.version = 2;
  else if (kind === "relinked")
    await database.db.execute(
      sql`update channel_identities set external_id='302',external_chat_id='302' where id=${f.identity}::uuid`,
    );
  else
    await database.db.execute(
      sql`update experts set ${kind === "inactive" ? sql`active=false` : sql`verified=false`} where id=${f.expertId}::uuid`,
    );
  expect(await f.bookings.transitionFromTelegramCallback(c)).toBeNull();
  expect(await counts(f)).toEqual({
    consumed: 0,
    operations: 0,
    transitions: 0,
  });
});
it.each(["unadmitted", "not_applied", "failed"] as const)(
  "definitely unsent %s request cannot authorize a callback",
  async (outcome) => {
    const f = await fixture();
    const p = outcome === "unadmitted" ? await pair(f) : await sent(f, outcome);
    expect(
      await f.bookings.transitionFromTelegramCallback(command(f, p.confirm)),
    ).toBeNull();
    expect(await counts(f)).toEqual({
      consumed: 0,
      operations: 0,
      transitions: 0,
    });
  },
);
it.each(["unknown", "sending"] as const)(
  "%s attempt may authorize its unique callback without inventing a receipt",
  async (outcome) => {
    const f = await fixture();
    const p = await sent(f, outcome);
    expect(
      await f.bookings.transitionFromTelegramCallback(command(f, p.confirm)),
    ).toMatchObject({ status: "reserved", version: 2 });
    expect(
      (
        await database.db.execute(
          sql`select outcome from booking_notification_attempt_facts where attempt_id=${p.grant.attemptId}::uuid order by outcome`,
        )
      ).rows,
    ).toEqual(outcome === "unknown" ? [{ outcome: "unknown" }] : []);
  },
);
it.each(["confirm", "cancel"] as const)(
  "authenticated %s replay returns original committed result without a second transition",
  async (action) => {
    const f = await fixture();
    const p = await sent(f);
    const c = command(f, p[action], action);
    const result = await f.bookings.transitionFromTelegramCallback(c);
    expect(result).not.toBeNull();
    expect(await f.issuer.findLinkedCallback(c.tokenHash)).toMatchObject({
      deliveryId: f.deliveryId,
      action,
    });
    expect(
      await f.bookings.transitionFromTelegramCallback({
        ...c,
        correlationId: randomUUID(),
      }),
    ).toEqual({ ...result, replayed: true });
    expect(await counts(f)).toEqual({
      consumed: 1,
      operations: action === "confirm" ? 1 : 0,
      transitions: 1,
    });
    const opposite = action === "confirm" ? "cancel" : "confirm";
    expect(
      await f.bookings.transitionFromTelegramCallback(
        command(f, p[opposite], opposite),
      ),
    ).toBeNull();
  },
);
it("consumed flag without committed audit never fabricates replay", async () => {
  const f = await fixture();
  const p = await sent(f);
  await database.db.execute(
    sql`update notifications set callback_consumed_at=clock_timestamp() where callback_token_hash=${nonceHash(p.confirm)}`,
  );
  expect(
    await f.bookings.transitionFromTelegramCallback(command(f, p.confirm)),
  ).toBeNull();
  expect(await counts(f)).toEqual({
    consumed: 1,
    operations: 0,
    transitions: 0,
  });
});
it("replay returns the original result after later cancellation but rejects a relinked expert", async () => {
  const f = await fixture();
  const p = await sent(f);
  const c = command(f, p.confirm);
  expect(await f.bookings.transitionFromTelegramCallback(c)).toMatchObject({
    status: "reserved",
    version: 2,
  });
  await f.bookings.transition({
    reservationId: f.reservationId,
    expectedVersion: 2,
    action: "expert_cancel",
    actor: { type: "expert", id: f.expertId },
    now: new Date(),
    correlationId: randomUUID(),
  });
  expect(await f.bookings.transitionFromTelegramCallback(c)).toEqual({
    reservationId: f.reservationId,
    status: "reserved",
    version: 2,
    replayed: true,
  });
  await database.db.execute(
    sql`update channel_identities set external_id='302',external_chat_id='302' where id=${f.identity}::uuid`,
  );
  expect(await f.bookings.transitionFromTelegramCallback(c)).toBeNull();
  expect(await counts(f)).toEqual({
    consumed: 1,
    operations: 1,
    transitions: 2,
  });
});
it("concurrent opposite buttons commit exactly one domain transition", async () => {
  const f = await fixture();
  const p = await sent(f);
  const results = await Promise.all([
    f.bookings.transitionFromTelegramCallback(command(f, p.confirm)),
    f.bookings.transitionFromTelegramCallback(command(f, p.cancel, "cancel")),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await counts(f)).toMatchObject({ consumed: 1, transitions: 1 });
});
it("callback consumption rolls back with transition failure", async () => {
  const f = await fixture();
  const p = await sent(f);
  // Fail inside the actual provider enqueue, after proving consumption exists
  // in that transaction. A hook failure before consumption is not rollback proof.
  await database.db
    .execute(sql`create function booking_callback_test_failure() returns trigger language plpgsql as $$ begin
    if not exists(select 1 from notifications where reservation_id=NEW.reservation_id and callback_consumed_at is not null) then raise exception 'missing_consumption'; end if;
    raise exception 'synthetic_transition_after_consumption'; end $$;
    create trigger booking_callback_test_failure before insert on planerka_booking_operations for each row execute function booking_callback_test_failure()`);
  try {
    await expect(
      f.bookings.transitionFromTelegramCallback(command(f, p.confirm)),
    ).rejects.toMatchObject({
      cause: { message: "synthetic_transition_after_consumption" },
    });
  } finally {
    await database.db.execute(
      sql`drop trigger booking_callback_test_failure on planerka_booking_operations; drop function booking_callback_test_failure()`,
    );
  }
  expect(await counts(f)).toEqual({
    consumed: 0,
    operations: 0,
    transitions: 0,
  });
});
it("context-bound reservation cannot use an unlinked legacy callback", async () => {
  const f = await fixture();
  const p = await sent(f);
  await database.db.execute(
    sql`delete from booking_notification_callbacks where delivery_id=${f.deliveryId}::uuid`,
  );
  const c = command(f, p.confirm);
  delete c.telegramContext;
  expect(await f.bookings.transitionFromTelegramCallback(c)).toBeNull();
  expect(await counts(f)).toEqual({
    consumed: 0,
    operations: 0,
    transitions: 0,
  });
});
it("post-lock database time rejects expiry crossed during callback row wait despite old caller time", async () => {
  const f = await fixture();
  const p = await sent(f);
  const hash = nonceHash(p.confirm);
  // Exact common credential expiry is controlled before the contender starts.
  await database.db.execute(
    sql`with t as materialized(select date_trunc('second',clock_timestamp())+interval '5 seconds' as expiry)
      update notifications n set callback_expires_at=t.expiry,callback_claims=jsonb_set(n.callback_claims::jsonb,'{expiresAtEpochSeconds}',to_jsonb(extract(epoch from t.expiry)::bigint))::text from t where reservation_id=${f.reservationId}::uuid`,
  );
  await database.db.execute(
    sql`update booking_notification_callbacks c set expires_at=n.callback_expires_at from notifications n where n.id=c.notification_id and c.delivery_id=${f.deliveryId}::uuid`,
  );
  let work: Promise<unknown> | undefined;
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from notifications where callback_token_hash=${hash} for update`,
    );
    expect(
      (
        await tx.execute(
          sql`select callback_expires_at>clock_timestamp() as future from notifications where callback_token_hash=${hash}`,
        )
      ).rows,
    ).toEqual([{ future: true }]);
    work = f.bookings.transitionFromTelegramCallback(command(f, p.confirm));
    // Prove a live contender is waiting on THIS transaction before expiry.
    // A late-starting contender must fail the test, not simulate the race.
    let observedWait = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const observation = await tx.execute<{
        waiting: boolean;
        future: boolean;
      }>(sql`
        select exists(select 1 from pg_stat_activity a
          where a.datname=current_database() and a.pid<>pg_backend_pid()
          and pg_backend_pid()=any(pg_blocking_pids(a.pid))) as waiting,
          callback_expires_at>clock_timestamp() as future
        from notifications where callback_token_hash=${hash}`);
      const row = observation.rows[0]!;
      if (row.waiting) {
        expect(row.future).toBe(true);
        observedWait = true;
        break;
      }
      if (!row.future) break;
      await tx.execute(sql`select pg_sleep(0.02)`);
    }
    expect(observedWait).toBe(true);
    await tx.execute(sql`select pg_sleep(greatest(0,extract(epoch from
      (callback_expires_at-clock_timestamp())))+0.1)
      from notifications where callback_token_hash=${hash}`);
  });
  expect(await work).toBeNull();
  expect(await counts(f)).toEqual({
    consumed: 0,
    operations: 0,
    transitions: 0,
  });
}, 15_000);
