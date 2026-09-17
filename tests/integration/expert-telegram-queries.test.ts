import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresExpertTelegramQueryRepository } from "../../packages/db/src/repositories/expert-telegram-query-repository.js";
import { PostgresBookingRepository } from "../../packages/db/src/repositories/booking-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 120_000);

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1_000;
let telegramIdentity = 123456780;

const seed = async (options: { consent?: boolean } = {}) => {
  const telegramUserId = String(++telegramIdentity);
  const fixture = await testDb.createReservableFixture();
  await testDb.db.execute(sql`
    insert into channel_identities (user_id, provider, external_id)
    select user_id, 'telegram', ${telegramUserId}
    from experts where id = ${fixture.expertId}::uuid
  `);
  const reserved = await testDb.db.execute<{ id: string }>(sql`
    insert into reservations (
      user_id, slot_id, expert_id, expert_service_id, status, idempotency_key,
      reserved_until, version, created_at, updated_at
    )
    select
      u.id, s.id, e.id, es.id, 'booked', ${`query-${crypto.randomUUID()}`},
      ${new Date(now.getTime() + DAY_MS - 60 * 60 * 1_000)}, 3, ${now}, ${now}
    from experts e
    join users u on u.id = ${fixture.command.userId}::uuid
    join expert_services es on es.expert_id = e.id
    join slots s on s.expert_service_id = es.id
    where e.id = ${fixture.expertId}::uuid
    limit 1
    returning id
  `);
  const reservationId = reserved.rows[0]?.id;
  if (reservationId === undefined) throw new Error("fixture failed");
  await testDb.db.execute(sql`
    update slots set starts_at = ${new Date(now.getTime() + DAY_MS)}
    where id = (select slot_id from reservations where id = ${reservationId}::uuid)
  `);
  await testDb.db.execute(sql`
    insert into client_profiles (user_id, display_name, timezone, expert_note)
    select user_id, 'Client', 'Europe/Moscow', 'Bring notes'
    from reservations where id = ${reservationId}::uuid
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      expert_note = excluded.expert_note
  `);
  if (options.consent !== false) {
    await testDb.db.execute(sql`
      insert into consents (user_id, consent_type, decision, policy_version, created_at)
      select user_id, 'expert_note', 'granted', 'v1', ${now}
      from reservations where id = ${reservationId}::uuid
    `);
    await testDb.db.execute(sql`
      insert into consents (user_id, consent_type, decision, policy_version, created_at)
      select user_id, 'expert_handoff', 'granted', 'handoff-v1', ${now}
      from reservations where id = ${reservationId}::uuid
    `);
  }
  return { expertId: fixture.expertId, reservationId, telegramUserId };
};

const insertReservationState = async (
  fixture: { expertId: string; reservationId: string },
  input: {
    status:
      "reserved" | "booked" | "completed" | "cancelled_by_client" | "no_show";
    startsAt: Date;
    updatedAt?: Date;
    reservedUntil?: Date;
  },
) => {
  await testDb.db.execute(sql`
    with template as (
      select user_id, expert_id, expert_service_id
      from reservations where id = ${fixture.reservationId}::uuid
    ), inserted_slot as (
      insert into slots (
        expert_service_id, provider, external_slot_id, starts_at, ends_at,
        observed_at, capacity
      )
      select expert_service_id, 'test', gen_random_uuid()::text,
        ${input.startsAt}, ${new Date(input.startsAt.getTime() + 60 * 60 * 1_000)},
        ${now}, 1
      from template
      returning id, expert_service_id
    )
    insert into reservations (
      user_id, slot_id, expert_id, expert_service_id, status,
      idempotency_key, reserved_until, version, created_at, updated_at
    )
    select template.user_id, inserted_slot.id, template.expert_id,
      inserted_slot.expert_service_id, ${input.status}::reservation_status,
      gen_random_uuid()::text, ${input.reservedUntil ?? new Date(now.getTime() + DAY_MS)},
      1, ${new Date(now.getTime() - 31 * DAY_MS)}, ${input.updatedAt ?? now}
    from template cross join inserted_slot
  `);
};

describe("PostgreSQL expert Telegram queries", () => {
  it("authorizes by active verified binding, limits client choices to 20, and rejects foreign identity", async () => {
    const fixture = await seed();
    await testDb.db.execute(sql`
      with template as (
        select r.user_id, r.expert_id, r.expert_service_id
        from reservations r where r.id = ${fixture.reservationId}::uuid
      ), inserted_slots as (
        insert into slots (
          expert_service_id, provider, external_slot_id, starts_at, ends_at,
          observed_at, capacity
        )
        select
          template.expert_service_id, 'test', gen_random_uuid()::text,
          ${now}::timestamptz + make_interval(hours => series.n),
          ${now}::timestamptz + make_interval(hours => series.n + 1), ${now}, 1
        from template cross join generate_series(25, 48) as series(n)
        returning id, expert_service_id
      )
      insert into reservations (
        user_id, slot_id, expert_id, expert_service_id, status,
        idempotency_key, reserved_until, version, created_at, updated_at
      )
      select
        template.user_id, inserted_slots.id, template.expert_id,
        inserted_slots.expert_service_id, 'reserved', gen_random_uuid()::text,
        ${now}::timestamptz + interval '1 day', 1, ${now}, ${now}
      from inserted_slots cross join template
    `);
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    const command = {
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      now,
      limit: 20 as const,
    };
    const choices = await repo.listClientCandidates(command);
    expect(choices).toHaveLength(20);
    expect(choices?.map((choice) => choice.startsAt.getTime())).toEqual(
      [...(choices ?? [])]
        .map((choice) => choice.startsAt.getTime())
        .sort((left, right) => left - right),
    );
    await expect(
      repo.listClientCandidates({ ...command, telegramUserId: "987654321" }),
    ).resolves.toBeNull();
    await testDb.db.execute(
      sql`update experts set active = false where id = ${fixture.expertId}::uuid`,
    );
    await expect(repo.listClientCandidates(command)).resolves.toBeNull();
  });

  it("returns fixed-window aggregates and fails closed for a revoked binding", async () => {
    const fixture = await seed();
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    const command = {
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      from: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
      now,
    };
    await expect(repo.readStats(command)).resolves.toEqual({
      upcoming: 1,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    });
    await testDb.db.execute(
      sql`update experts set verified = false where id = ${fixture.expertId}::uuid`,
    );
    await expect(repo.readStats(command)).resolves.toBeNull();
  });

  it("counts stats at the exact 30-day boundaries and excludes outside states", async () => {
    const fixture = await seed();
    const from = new Date(now.getTime() - 30 * DAY_MS);
    await insertReservationState(fixture, {
      status: "completed",
      startsAt: from,
    });
    await insertReservationState(fixture, {
      status: "completed",
      startsAt: new Date(from.getTime() - 1),
    });
    await insertReservationState(fixture, {
      status: "completed",
      startsAt: new Date(now.getTime() - 1),
    });
    await insertReservationState(fixture, {
      status: "completed",
      startsAt: now,
    });
    await insertReservationState(fixture, {
      status: "cancelled_by_client",
      startsAt: from,
      updatedAt: from,
    });
    await insertReservationState(fixture, {
      status: "cancelled_by_client",
      startsAt: from,
      updatedAt: new Date(from.getTime() - 1),
    });
    await insertReservationState(fixture, {
      status: "cancelled_by_client",
      startsAt: from,
      updatedAt: now,
    });
    await insertReservationState(fixture, {
      status: "no_show",
      startsAt: from,
    });
    await insertReservationState(fixture, { status: "no_show", startsAt: now });
    await insertReservationState(fixture, {
      status: "reserved",
      startsAt: new Date(now.getTime() + DAY_MS),
      reservedUntil: now,
    });

    await expect(
      new PostgresExpertTelegramQueryRepository(testDb.db).readStats({
        expertId: fixture.expertId,
        telegramUserId: fixture.telegramUserId,
        from: from.toISOString(),
        now,
      }),
    ).resolves.toEqual({
      upcoming: 1,
      completed: 2,
      cancelled: 1,
      noShow: 1,
    });
  });

  it("consumes once, returns only consented preparation data, and writes content-free audit", async () => {
    const fixture = await seed();
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    const tokenHash = "a".repeat(64);
    const claims = {
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    };
    await repo.put(tokenHash, claims);
    const command = {
      tokenHash,
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      now,
      correlationId: "client-view-once",
    };
    await expect(
      repo.consumeClientView({ ...command, telegramUserId: "999999999" }),
    ).resolves.toBeNull();
    await expect(repo.peek(tokenHash)).resolves.toEqual(claims);
    await expect(repo.consumeClientView(command)).resolves.toMatchObject({
      reservationId: fixture.reservationId,
      clientDisplayName: "Client",
      serviceName: "Test consultation",
      preparationNote: "Bring notes",
    });
    await expect(repo.consumeClientView(command)).resolves.toBeNull();
    const audit = await testDb.db.execute<{
      action: string;
      metadataHash: string;
    }>(sql`
      select action, metadata_hash as "metadataHash"
      from audit_events where correlation_id = 'client-view-once'
    `);
    expect(audit.rows).toEqual([
      {
        action: "reservation.client_view",
        metadataHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toMatch(
      /Client|Bring notes|consultation/u,
    );
  });

  it("allows exactly one concurrent client view consume and one audit", async () => {
    const fixture = await seed();
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    const tokenHash = "7".repeat(64);
    const claims = {
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    };
    await repo.put(tokenHash, claims);
    const command = {
      tokenHash,
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      now,
      correlationId: `client-view-concurrent-${crypto.randomUUID()}`,
    };

    const results = await Promise.all([
      repo.consumeClientView(command),
      repo.consumeClientView(command),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    const audit = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from audit_events
      where correlation_id = ${command.correlationId}
        and action = 'reservation.client_view'
        and decision = 'allowed'
    `);
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("rejects stale and revoked cv1 callbacks without consuming them", async () => {
    const stale = await seed();
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    const staleHash = "c".repeat(64);
    const staleClaims = {
      reservationId: stale.reservationId,
      expertId: stale.expertId,
      telegramUserId: stale.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    };
    await repo.put(staleHash, staleClaims);
    await testDb.db.execute(sql`
      update reservations set version = version + 1
      where id = ${stale.reservationId}::uuid
    `);
    await expect(
      repo.consumeClientView({
        tokenHash: staleHash,
        reservationId: stale.reservationId,
        expertId: stale.expertId,
        telegramUserId: stale.telegramUserId,
        version: 3,
        now,
        correlationId: "client-view-stale",
      }),
    ).resolves.toBeNull();
    await expect(repo.peek(staleHash)).resolves.toEqual(staleClaims);

    const revoked = await seed();
    const revokedHash = "d".repeat(64);
    const revokedClaims = {
      reservationId: revoked.reservationId,
      expertId: revoked.expertId,
      telegramUserId: revoked.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    };
    await repo.put(revokedHash, revokedClaims);
    await testDb.db.execute(sql`
      update experts set verified = false where id = ${revoked.expertId}::uuid
    `);
    await expect(
      repo.consumeClientView({
        tokenHash: revokedHash,
        reservationId: revoked.reservationId,
        expertId: revoked.expertId,
        telegramUserId: revoked.telegramUserId,
        version: 3,
        now,
        correlationId: "client-view-revoked",
      }),
    ).resolves.toBeNull();
    await expect(repo.peek(revokedHash)).resolves.toEqual(revokedClaims);
  });

  it("rolls callback consumption back when audit persistence fails", async () => {
    const fixture = await seed();
    const tokenHash = "b".repeat(64);
    const failing = new PostgresExpertTelegramQueryRepository(testDb.db, {
      beforeClientViewAudit: async () => {
        throw new Error("audit interrupted");
      },
    });
    const claims = {
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    };
    await failing.put(tokenHash, claims);
    const command = {
      tokenHash,
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      now,
      correlationId: "client-view-rollback",
    };
    await expect(failing.consumeClientView(command)).rejects.toThrow(
      "audit interrupted",
    );
    await expect(
      new PostgresExpertTelegramQueryRepository(testDb.db).peek(tokenHash),
    ).resolves.toEqual(claims);
  });

  it("excludes expired reserved holds from schedule, choices, upcoming stats, issuance, and view", async () => {
    const fixture = await seed();
    const expiredAt = new Date(now.getTime() + 2);
    await testDb.db.execute(sql`
      update reservations
      set status = 'reserved', reserved_until = ${new Date(now.getTime() + 1)}
      where id = ${fixture.reservationId}::uuid
    `);
    const queries = new PostgresExpertTelegramQueryRepository(testDb.db);
    const actor = {
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      now: expiredAt,
    };
    await expect(
      queries.listClientCandidates({ ...actor, limit: 20 }),
    ).resolves.toEqual([]);
    await expect(
      queries.readStats({
        ...actor,
        from: new Date(expiredAt.getTime() - 30 * DAY_MS).toISOString(),
      }),
    ).resolves.toMatchObject({ upcoming: 0 });
    await expect(
      new PostgresBookingRepository(testDb.db).listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: fixture.telegramUserId,
        from: expiredAt,
        to: new Date(expiredAt.getTime() + 7 * DAY_MS),
      }),
    ).resolves.toEqual([]);
    await expect(
      queries.put("e".repeat(64), {
        reservationId: fixture.reservationId,
        expertId: fixture.expertId,
        telegramUserId: fixture.telegramUserId,
        version: 3,
        expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
      }),
    ).rejects.toThrow("expert_query_unavailable");
  });

  it("withholds the name and note unless expert_handoff (and note) consent is granted", async () => {
    for (const decision of [
      "absent",
      "note-revoked",
      "handoff-revoked",
    ] as const) {
      const fixture = await seed({ consent: decision !== "absent" });
      if (decision === "note-revoked") {
        await testDb.db.execute(sql`
          insert into consents (user_id, consent_type, decision, policy_version, created_at)
          select user_id, 'expert_note', 'revoked', 'v2', ${new Date(now.getTime() + 1)}
          from reservations where id = ${fixture.reservationId}::uuid
        `);
      }
      if (decision === "handoff-revoked") {
        await testDb.db.execute(sql`
          insert into consents (user_id, consent_type, decision, policy_version, created_at)
          select user_id, 'expert_handoff', 'revoked', 'handoff-v2', ${new Date(now.getTime() + 1)}
          from reservations where id = ${fixture.reservationId}::uuid
        `);
      }
      const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
      const tokenHash = {
        absent: "f",
        "note-revoked": "9",
        "handoff-revoked": "3",
      }[decision].repeat(64);
      const claims = {
        reservationId: fixture.reservationId,
        expertId: fixture.expertId,
        telegramUserId: fixture.telegramUserId,
        version: 3,
        expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
      };
      await repo.put(tokenHash, claims);
      const result = await repo.consumeClientView({
        tokenHash,
        reservationId: fixture.reservationId,
        expertId: fixture.expertId,
        telegramUserId: fixture.telegramUserId,
        version: 3,
        now,
        correlationId: `client-view-consent-${decision}`,
      });
      // No consented preparation note in any of these states.
      expect(result).not.toHaveProperty("preparationNote");
      // Name is withheld whenever the transfer grant is absent or revoked.
      if (decision === "absent" || decision === "handoff-revoked") {
        expect(result).toMatchObject({ clientDisplayName: "Клиент" });
      } else {
        // note revoked but handoff still granted -> identity visible, note gone.
        expect(result).toMatchObject({ clientDisplayName: "Client" });
      }
    }
  });

  it("bounds existing-schema cleanup of expired view-client notifications", async () => {
    const fixture = await seed();
    await testDb.db.execute(sql`
      insert into notifications (
        reservation_id, idempotency_key, callback_token_hash, callback_claims,
        callback_expires_at, callback_expert_id, callback_action, callback_version
      )
      select ${fixture.reservationId}::uuid, 'expired-view-' || series.n,
        lpad(to_hex(series.n), 64, '0'), '{}',
        ${new Date(now.getTime() - 1)}, ${fixture.expertId}::uuid,
        'view_client', 3
      from generate_series(1, 105) as series(n)
    `);
    const repo = new PostgresExpertTelegramQueryRepository(testDb.db);
    await repo.put("8".repeat(64), {
      reservationId: fixture.reservationId,
      expertId: fixture.expertId,
      telegramUserId: fixture.telegramUserId,
      version: 3,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
    });
    const remaining = await testDb.db.execute<{ count: string }>(sql`
      select count(*)::text as count from notifications
      where callback_action = 'view_client'
        and callback_expires_at <= ${now}
    `);
    expect(remaining.rows[0]?.count).toBe("5");
  });
});
