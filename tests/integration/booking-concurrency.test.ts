import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BookingIdempotencyConflictError,
  BookingSerializationExhaustedError,
  PostgresBookingRepository,
} from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

// Provider identity is explicit in booking fixtures; production validation stays on.
async function mapReservation(reservationId: string) {
  await testDb.db.execute(
    sql`update slots set provider='planerka' where id=(select slot_id from reservations where id=${reservationId}::uuid)`,
  );
  await testDb.db
    .execute(sql`insert into planerka_service_mappings(expert_service_id,account_id,event_type_id,duration_minutes,time_zone,enabled,verified_at)
    select expert_service_id,1,(select count(*)::integer+1 from planerka_service_mappings),60,'UTC',true,clock_timestamp() from reservations where id=${reservationId}::uuid
    on conflict(expert_service_id) do nothing`);
}

// Historical read/terminal-transition fixtures need a bound provider fact.
// These fixtures do not exercise creation; the workflow suite does.
async function seedHistoricalProviderFact(reservationId: string) {
  await testDb.db
    .execute(sql`insert into planerka_booking_operations(reservation_id,account_id,event_type_id,request,request_fingerprint,starts_at,ends_at,state,provider_uid)
    select r.id,1,1,'{}'::jsonb,repeat('0',64),s.starts_at,s.ends_at,'booked','fixture_'||r.id::text
    from reservations r join slots s on s.id=r.slot_id where r.id=${reservationId}::uuid
    on conflict(reservation_id) do update set state='booked',provider_uid=excluded.provider_uid`);
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 120_000);

describe("booking transaction", () => {
  it("allocates the last place to exactly one concurrent client", async () => {
    const slotId = await testDb.createSlot({
      capacity: 1,
      startsAt: "2026-08-02T10:00:00.000Z",
    });
    const users = await Promise.all([testDb.createUser(), testDb.createUser()]);
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all(
      users.map((userId, index) =>
        repo.reserve({
          idempotencyKey: `reserve-capacity-${index}`,
          userId,
          slotId,
          now: new Date("2026-07-28T10:00:00.000Z"),
          minimumLeadMs: 24 * 60 * 60 * 1_000,
          confirmationBufferMs: 60 * 60 * 1_000,
          correlationId: `corr-capacity-${index}`,
        }),
      ),
    );

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(
      results.filter(
        (result) =>
          result.kind === "unavailable" && result.reason === "capacity",
      ),
    ).toHaveLength(1);
  });

  it("rejects a provider observation from the future", async () => {
    const slotId = await testDb.createSlot({
      capacity: 1,
      startsAt: "2026-08-02T10:00:00.000Z",
      observedAt: "2026-07-28T10:00:00.001Z",
    });
    const userId = await testDb.createUser();
    const repo = new PostgresBookingRepository(testDb.db);

    await expect(
      repo.reserve({
        idempotencyKey: `future-observation-${slotId}`,
        userId,
        slotId,
        now: new Date("2026-07-28T10:00:00.000Z"),
        minimumLeadMs: 24 * 60 * 60 * 1_000,
        confirmationBufferMs: 60 * 60 * 1_000,
        correlationId: `future-observation-${slotId}`,
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "stale_slot" });
  });

  it("BOOK-02 allows only one of two concurrent overlapping reservations for the same client", async () => {
    const fixture = await testDb.createOverlappingClientSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all([
      repo.reserve(fixture.first),
      repo.reserve(fixture.second),
    ]);

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(
      results.filter(
        (result) =>
          result.kind === "unavailable" &&
          result.reason === "client_active_overlap",
      ),
    ).toHaveLength(1);
    expect(await testDb.activeReservationCountForClient(fixture.clientId)).toBe(
      1,
    );
  });

  it("BOOK-03 allows only one of two concurrent overlapping reservations for the same expert", async () => {
    const fixture = await testDb.createOverlappingExpertSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all([
      repo.reserve(fixture.first),
      repo.reserve(fixture.second),
    ]);

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(
      results.filter(
        (result) =>
          result.kind === "unavailable" &&
          result.reason === "expert_active_overlap",
      ),
    ).toHaveLength(1);
    expect(await testDb.activeReservationCountForExpert(fixture.expertId)).toBe(
      1,
    );
  });

  it("restarts the whole SERIALIZABLE transaction on 40001 and stops after three attempts", async () => {
    const retried = await testDb.createReservableFixture();
    await testDb.installSerializationFailureTrigger(
      retried.command.idempotencyKey,
      1,
    );
    const alerts: string[] = [];
    const repo = new PostgresBookingRepository(testDb.db, {
      maxSerializationAttempts: 3,
      retryDelayMs: () => 0,
      onSerializationExhausted: (code) => alerts.push(code),
    });

    await expect(repo.reserve(retried.command)).resolves.toMatchObject({
      kind: "reserved",
    });
    expect(
      await testDb.serializationAttemptCount(retried.command.idempotencyKey),
    ).toBe(2);
    expect(
      await testDb.reservationCountForKey(retried.command.idempotencyKey),
    ).toBe(1);
    expect(
      await testDb.outboxCountForCorrelation(retried.command.correlationId),
    ).toBe(1);
    expect(
      (
        await testDb.outboxDeliveriesForCorrelation(
          retried.command.correlationId,
        )
      ).map((delivery) => delivery.topic),
    ).toEqual(["telegram.reservation_request"]);

    const exhausted = await testDb.createReservableFixture();
    await testDb.installSerializationFailureTrigger(
      exhausted.command.idempotencyKey,
      3,
    );
    const exhaustedError = await repo
      .reserve(exhausted.command)
      .catch((error: unknown) => error);
    expect(exhaustedError).toBeInstanceOf(BookingSerializationExhaustedError);
    expect(exhaustedError).toMatchObject({
      code: "booking_serialization_exhausted",
      cause: expect.objectContaining({ code: "40001" }),
    });
    expect(
      await testDb.serializationAttemptCount(exhausted.command.idempotencyKey),
    ).toBe(3);
    expect(
      await testDb.reservationCountForKey(exhausted.command.idempotencyKey),
    ).toBe(0);
    expect(alerts).toEqual(["booking_serialization_exhausted"]);
  });

  it("returns the same reservation for a repeated selection and rejects stale callback versions", async () => {
    const fixture = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);
    const first = await repo.reserve(fixture.command);
    if (first.kind !== "reserved")
      throw new Error(`Expected reserved, received ${first.kind}`);
    const retry = await repo.reserve(fixture.command);
    expect(retry).toMatchObject({
      kind: "duplicate",
      reservationId: first.reservationId,
    });

    await mapReservation(first.reservationId);
    await expect(
      repo.transition({
        reservationId: first.reservationId,
        expectedVersion: 1,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.expertId },
        now: new Date("2026-07-28T10:01:00.000Z"),
        correlationId: "confirm-1",
      }),
    ).resolves.toMatchObject({ status: "reserved", version: 2 });

    await expect(
      repo.transition({
        reservationId: first.reservationId,
        expectedVersion: 1,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.expertId },
        now: new Date("2026-07-28T10:02:00.000Z"),
        correlationId: "confirm-retry",
      }),
    ).rejects.toThrow("Stale reservation version");
    expect(await testDb.auditCountForCorrelation("confirm-1")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("confirm-1")).toBe(0);
    expect(await testDb.outboxDeliveriesForCorrelation("confirm-1")).toEqual(
      [],
    );
  });

  it("rejects sequential and concurrent reuse of an idempotency key for another selection", async () => {
    const first = await testDb.createReservableFixture();
    const second = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);
    await expect(repo.reserve(first.command)).resolves.toMatchObject({
      kind: "reserved",
    });

    await expect(
      repo.reserve({
        ...second.command,
        idempotencyKey: first.command.idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(BookingIdempotencyConflictError);

    const third = await testDb.createReservableFixture();
    const fourth = await testDb.createReservableFixture();
    const sharedKey = `shared-${third.command.idempotencyKey}`;
    const settled = await Promise.allSettled([
      repo.reserve({ ...third.command, idempotencyKey: sharedKey }),
      repo.reserve({ ...fourth.command, idempotencyKey: sharedKey }),
    ]);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejection = settled.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(BookingIdempotencyConflictError),
    });
    expect(await testDb.reservationCountForKey(sharedKey)).toBe(1);
  });

  it.each([
    ["expired_hold", "Reservation hold has expired"],
    ["wrong_expert", "Expert does not own reservation"],
    ["inactive_expert", "Expert is not eligible"],
    ["past_slot", "Slot is no longer confirmable"],
    ["stale_slot", "Slot observation is stale"],
    ["future_slot", "Slot observation is stale"],
  ] as const)("rejects ineligible confirm: %s", async (caseName, expected) => {
    const fixture = await testDb.createConfirmEligibilityCase(caseName);
    const repo = new PostgresBookingRepository(testDb.db);
    await expect(
      repo.transition({
        reservationId: fixture.reservationId,
        expectedVersion: 1,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.actorExpertId },
        now: fixture.now,
        correlationId: `confirm-${caseName}`,
      }),
    ).rejects.toThrow(expected);
    expect(await testDb.reservationStatus(fixture.reservationId)).toBe(
      "reserved",
    );
  });

  it("enforces client ownership on cancellation and deadline on system expiry", async () => {
    const fixture = await testDb.createReservableFixture();
    const otherUser = await testDb.createUser();
    const repo = new PostgresBookingRepository(testDb.db);
    const reserved = await repo.reserve(fixture.command);
    if (reserved.kind !== "reserved") throw new Error("Expected reservation");

    await expect(
      repo.transition({
        reservationId: reserved.reservationId,
        expectedVersion: reserved.version,
        action: "client_cancel",
        actor: { type: "client", id: otherUser },
        now: fixture.command.now,
        correlationId: "wrong-client",
      }),
    ).rejects.toThrow("Client does not own reservation");

    await expect(
      repo.transition({
        reservationId: reserved.reservationId,
        expectedVersion: reserved.version,
        action: "expire",
        actor: { type: "system", id: fixture.expertId },
        now: fixture.command.now,
        correlationId: "early-expiry",
      }),
    ).rejects.toThrow("Reservation hold has not expired");

    await expect(
      repo.transition({
        reservationId: reserved.reservationId,
        expectedVersion: reserved.version,
        action: "client_cancel",
        actor: { type: "client", id: fixture.command.userId },
        now: fixture.command.now,
        correlationId: "client-cancelled",
      }),
    ).resolves.toMatchObject({
      status: "cancelled_by_client",
      version: 2,
    });
    expect(
      (await testDb.outboxDeliveriesForCorrelation("client-cancelled")).map(
        (delivery) => delivery.topic,
      ),
    ).toEqual(["telegram.booking_cancelled"]);

    const expiryFixture = await testDb.createReservableFixture();
    const expiring = await repo.reserve(expiryFixture.command);
    if (expiring.kind !== "reserved") {
      throw new Error("Expected expiring reservation");
    }
    await expect(
      repo.transition({
        reservationId: expiring.reservationId,
        expectedVersion: expiring.version,
        action: "expire",
        actor: { type: "system", id: expiryFixture.expertId },
        now: new Date("2026-08-01T10:00:00.000Z"),
        correlationId: "system-expired",
      }),
    ).resolves.toMatchObject({ status: "expired", version: 2 });
    expect(
      (await testDb.outboxDeliveriesForCorrelation("system-expired")).map(
        (delivery) => delivery.topic,
      ),
    ).toEqual(["client.reservation_expired", "expert.reservation_expired"]);
  });

  it("fails closed for completion and no-show actors and audits authorized actions", async () => {
    const completeFixture = await testDb.createReservableFixture();
    const noShowFixture = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);

    const book = async (
      fixture: Awaited<ReturnType<TestDatabase["createReservableFixture"]>>,
      correlationId: string,
    ) => {
      const reserved = await repo.reserve(fixture.command);
      if (reserved.kind !== "reserved") throw new Error("Expected reservation");
      await mapReservation(reserved.reservationId);
      await repo.transition({
        reservationId: reserved.reservationId,
        expectedVersion: 1,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.expertId },
        now: new Date("2026-07-28T10:01:00.000Z"),
        correlationId,
      });
      await seedHistoricalProviderFact(reserved.reservationId);
      await testDb.db.execute(
        sql`update reservations set status=\'booked\' where id=${reserved.reservationId}::uuid`,
      );
      return reserved.reservationId;
    };

    const completeReservationId = await book(
      completeFixture,
      "book-for-complete",
    );
    await expect(
      repo.transition({
        reservationId: completeReservationId,
        expectedVersion: 2,
        action: "complete",
        actor: { type: "client", id: completeFixture.command.userId },
        now: new Date("2026-08-02T11:00:00.000Z"),
        correlationId: "unauthorized-complete",
      }),
    ).rejects.toThrow("System actor is required");
    await expect(
      repo.transition({
        reservationId: completeReservationId,
        expectedVersion: 2,
        action: "complete",
        actor: { type: "system", id: completeFixture.expertId },
        now: new Date("2026-08-02T11:00:00.000Z"),
        correlationId: "authorized-complete",
      }),
    ).resolves.toMatchObject({ status: "completed", version: 3 });

    const noShowReservationId = await book(noShowFixture, "book-for-no-show");
    await expect(
      repo.transition({
        reservationId: noShowReservationId,
        expectedVersion: 2,
        action: "mark_no_show",
        actor: { type: "client", id: noShowFixture.command.userId },
        now: new Date("2026-08-02T11:00:00.000Z"),
        correlationId: "unauthorized-no-show",
      }),
    ).rejects.toThrow("Expert does not own reservation");
    await expect(
      repo.transition({
        reservationId: noShowReservationId,
        expectedVersion: 2,
        action: "mark_no_show",
        actor: { type: "expert", id: noShowFixture.expertId },
        now: new Date("2026-08-02T11:00:00.000Z"),
        correlationId: "authorized-no-show",
      }),
    ).resolves.toMatchObject({ status: "no_show", version: 3 });

    expect(await testDb.auditCountForCorrelation("authorized-complete")).toBe(
      1,
    );
    expect(await testDb.outboxCountForCorrelation("authorized-complete")).toBe(
      1,
    );
    expect(
      (await testDb.outboxDeliveriesForCorrelation("authorized-complete")).map(
        (delivery) => delivery.topic,
      ),
    ).toEqual(["client.booking_completed"]);
    expect(await testDb.auditCountForCorrelation("authorized-no-show")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("authorized-no-show")).toBe(
      1,
    );
    expect(
      (await testDb.outboxDeliveriesForCorrelation("authorized-no-show")).map(
        (delivery) => delivery.topic,
      ),
    ).toEqual(["client.booking_no_show"]);
  });

  it("consumes an expert callback and transitions the reservation in one transaction", async () => {
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "a".repeat(64),
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    await mapReservation(fixture.claims.reservationId);
    const repository = new PostgresBookingRepository(testDb.db);
    const command = {
      tokenHash: fixture.tokenHash,
      reservationId: fixture.claims.reservationId,
      expertId: fixture.claims.expertId,
      action: "confirm" as const,
      version: 3,
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "callback-confirm-atomic",
    };

    await expect(
      repository.transitionFromTelegramCallback({
        ...command,
        reservationId: "00000000-0000-4000-8000-000000000999",
      }),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(fixture.notificationId)).toBeNull();
    expect(await testDb.reservationStatus(fixture.claims.reservationId)).toBe(
      "reserved",
    );

    await expect(
      repository.transitionFromTelegramCallback(command),
    ).resolves.toMatchObject({
      reservationId: fixture.claims.reservationId,
      status: "reserved",
      version: 4,
    });
    await expect(
      repository.transitionFromTelegramCallback(command),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(fixture.notificationId)).toEqual(
      command.now,
    );
    expect(
      (await testDb.outboxDeliveriesForCorrelation(command.correlationId)).map(
        (delivery) => delivery.topic,
      ),
    ).toEqual([]);
  });

  it("composes eligible slot search, Telegram ownership, and an owner-scoped schedule", async () => {
    const fixture = await testDb.createReservableFixture();
    const repository = new PostgresBookingRepository(testDb.db);
    await testDb.db.execute(sql`
      update expert_services
      set code = 'consultation', language = 'ru'
      where id = (
        select expert_service_id from slots
        where id = ${fixture.command.slotId}::uuid
      )
    `);
    await testDb.db.execute(sql`
      insert into channel_identities (user_id, provider, external_id)
      select user_id, 'telegram', '123456789'
      from experts
      where id = ${fixture.expertId}::uuid
    `);

    const search = () =>
      repository.searchSlots({
        serviceCode: "consultation",
        language: "ru",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
        now: fixture.command.now,
        minimumLeadMs: 86_400_000,
      });
    const containsFixture = (slots: readonly { slotId: string }[]) =>
      slots.some((slot) => slot.slotId === fixture.command.slotId);

    await expect(search().then(containsFixture)).resolves.toBe(true);
    await testDb.db.execute(sql`
      update experts set active = false where id = ${fixture.expertId}::uuid
    `);
    await expect(search().then(containsFixture)).resolves.toBe(false);
    await testDb.db.execute(sql`
      update experts set active = true, verified = false
      where id = ${fixture.expertId}::uuid
    `);
    await expect(search().then(containsFixture)).resolves.toBe(false);
    await testDb.db.execute(sql`
      update experts set verified = true where id = ${fixture.expertId}::uuid
    `);
    await testDb.db.execute(sql`
      update expert_services set active = false
      where id = (
        select expert_service_id from slots
        where id = ${fixture.command.slotId}::uuid
      )
    `);
    await expect(search().then(containsFixture)).resolves.toBe(false);
    await testDb.db.execute(sql`
      update expert_services set active = true
      where id = (
        select expert_service_id from slots
        where id = ${fixture.command.slotId}::uuid
      )
    `);
    await testDb.db.execute(sql`
      update slots set observed_at = ${new Date(
        fixture.command.now.getTime() - 15 * 60 * 1_000 - 1,
      )}
      where id = ${fixture.command.slotId}::uuid
    `);
    await expect(search().then(containsFixture)).resolves.toBe(false);
    await testDb.db.execute(sql`
      update slots set observed_at = ${new Date(
        fixture.command.now.getTime() + 1,
      )}
      where id = ${fixture.command.slotId}::uuid
    `);
    await expect(search().then(containsFixture)).resolves.toBe(false);
    await testDb.db.execute(sql`
      update slots set observed_at = ${fixture.command.now}
      where id = ${fixture.command.slotId}::uuid
    `);
    await expect(
      repository
        .searchSlots({
          serviceCode: "unknown-service",
          language: "ru",
          from: new Date("2026-07-29T00:00:00.000Z"),
          to: new Date("2026-08-06T00:00:00.000Z"),
          now: fixture.command.now,
          minimumLeadMs: 86_400_000,
        })
        .then(containsFixture),
    ).resolves.toBe(false);
    await expect(
      repository
        .searchSlots({
          serviceCode: "consultation",
          language: "en",
          from: new Date("2026-07-29T00:00:00.000Z"),
          to: new Date("2026-08-06T00:00:00.000Z"),
          now: fixture.command.now,
          minimumLeadMs: 86_400_000,
        })
        .then(containsFixture),
    ).resolves.toBe(false);

    const reserved = await repository.reserve(fixture.command);
    if (reserved.kind !== "reserved") throw new Error("Expected reservation");
    const slots = await search();
    expect(slots.every((slot) => slot.slotId !== fixture.command.slotId)).toBe(
      true,
    );
    const schedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
    });
    if (schedule === null) throw new Error("Expected authorized schedule");
    expect(schedule).toEqual([
      expect.objectContaining({
        reservationId: reserved.reservationId,
        expertId: fixture.expertId,
        status: "reserved",
        expertNoteConsent: false,
      }),
    ]);
    expect(schedule[0]).not.toHaveProperty("expertNote");
    expect(schedule[0]).not.toHaveProperty("meetingUrl");
    await testDb.db.execute(sql`
      insert into client_profiles (
        user_id, display_name, timezone, expert_note
      )
      select user_id, 'Клиент с согласием', 'Europe/Moscow', 'Предпочитает утро'
      from reservations
      where id = ${reserved.reservationId}::uuid
      on conflict (user_id) do update
      set display_name = excluded.display_name,
          expert_note = excluded.expert_note,
          updated_at = now()
    `);
    const noConsentSchedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(noConsentSchedule?.[0]).toMatchObject({
      expertNoteConsent: false,
      expertHandoffConsent: false,
      clientDisplayName: "Клиент",
    });
    expect(noConsentSchedule?.[0]).not.toHaveProperty("expertNote");
    // 2026-09-21: словарь `decision` закрыт проверкой `consents_decision_known` (миграция 0039,
    // EVID-01), поэтому не-грантовое значение здесь — легальное `revoked`. Свойство
    // «нераспознанный токен не открывает гейт» теперь защищается на уровне БД и проверяется
    // тестом миграции (tests/integration/consent-evidence-schema.test.ts), а на уровне домена —
    // packages/domain/src/consent.test.ts.
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_note', 'revoked', 'expert-note-v1',
        '2026-07-29T09:59:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    const unknownConsentSchedule =
      await repository.listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: "123456789",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      });
    expect(unknownConsentSchedule?.[0]).toMatchObject({
      expertNoteConsent: false,
    });
    expect(unknownConsentSchedule?.[0]).not.toHaveProperty("expertNote");
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_note', 'granted', 'expert-note-v1',
        '2026-07-29T10:00:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_handoff', 'granted', 'handoff-v1',
        '2026-07-29T10:00:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    await testDb.db.execute(sql`
      update reservations
      set meeting_url = 'https://meeting.invalid/private',
          updated_at = now()
      where id = ${reserved.reservationId}::uuid
    `);
    const reservedWithMeetingUrl =
      await repository.listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: "123456789",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      });
    expect(reservedWithMeetingUrl?.[0]).not.toHaveProperty("meetingUrl");
    await seedHistoricalProviderFact(reserved.reservationId);
    await testDb.db.execute(sql`
      update reservations
      set status = 'booked', updated_at = now()
      where id = ${reserved.reservationId}::uuid
    `);
    const consentedSchedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(consentedSchedule).toEqual([
      expect.objectContaining({
        reservationId: reserved.reservationId,
        status: "booked",
        clientDisplayName: "Клиент с согласием",
        expertNote: "Предпочитает утро",
        expertNoteConsent: true,
        meetingUrl: "https://meeting.invalid/private",
      }),
    ]);
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_note', 'denied', 'expert-note-v1',
        '2026-07-29T10:01:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_note', 'granted', 'expert-note-v1-conflict',
        '2026-07-29T10:01:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    const revokedSchedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(revokedSchedule?.[0]).toMatchObject({
      status: "booked",
      expertNoteConsent: false,
      meetingUrl: "https://meeting.invalid/private",
    });
    expect(revokedSchedule?.[0]).not.toHaveProperty("expertNote");

    // Зазор, найденный независимым review: note granted + handoff denied.
    // До ужесточения CASE SQL отдавал plaintext заметки в слой приложения,
    // и ни один тест этого состояния не покрывал.
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_note', 'granted', 'expert-note-v1',
        '2026-07-29T10:02:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    await testDb.db.execute(sql`
      insert into consents (
        user_id, consent_type, decision, policy_version, created_at
      )
      select
        user_id, 'expert_handoff', 'denied', 'handoff-v1',
        '2026-07-29T10:03:00.000Z'::timestamptz
      from reservations
      where id = ${reserved.reservationId}::uuid
    `);
    const handoffDeniedSchedule = await repository.listAuthorizedExpertSchedule(
      {
        expertId: fixture.expertId,
        telegramUserId: "123456789",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      },
    );
    expect(handoffDeniedSchedule?.[0]).toMatchObject({
      status: "booked",
      expertNoteConsent: true,
      expertHandoffConsent: false,
      clientDisplayName: "Клиент",
      meetingUrl: "https://meeting.invalid/private",
    });
    expect(handoffDeniedSchedule?.[0]).not.toHaveProperty("expertNote");

    // DEC-PLT-004 §4 (строка Telegram): meeting_url наружу «не ранее 30 мин» до встречи.
    const originalSlotRow = await testDb.db.execute<{ startsAt: Date }>(sql`
      select starts_at as "startsAt" from slots where id = ${fixture.command.slotId}::uuid
    `);
    const originalStartsAt = originalSlotRow.rows[0]?.startsAt;
    await testDb.db.execute(sql`
      update slots set starts_at = now() + interval '2 hours'
      where id = ${fixture.command.slotId}::uuid
    `);
    const tooEarlySchedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2027-12-31T00:00:00.000Z"),
    });
    expect(tooEarlySchedule?.[0]).toMatchObject({
      status: "booked",
      clientDisplayName: "Клиент",
    });
    expect(tooEarlySchedule?.[0]).not.toHaveProperty("meetingUrl");
    await testDb.db.execute(sql`
      update slots set starts_at = now() + interval '10 minutes'
      where id = ${fixture.command.slotId}::uuid
    `);
    const insideLeadSchedule = await repository.listAuthorizedExpertSchedule({
      expertId: fixture.expertId,
      telegramUserId: "123456789",
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2027-12-31T00:00:00.000Z"),
    });
    expect(insideLeadSchedule?.[0]).toMatchObject({
      status: "booked",
      meetingUrl: "https://meeting.invalid/private",
    });
    await testDb.db.execute(sql`
      update slots set starts_at = ${originalStartsAt}
      where id = ${fixture.command.slotId}::uuid
    `);
    await testDb.db.execute(sql`
      update experts set active = false where id = ${fixture.expertId}::uuid
    `);
    await expect(
      repository.listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: "123456789",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    await testDb.db.execute(sql`
      update experts set active = true where id = ${fixture.expertId}::uuid
    `);
    await expect(
      repository.listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: "987654321",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    await testDb.db.execute(sql`
      delete from channel_identities
      where provider = 'telegram' and external_id = '123456789'
    `);
    await expect(
      repository.listAuthorizedExpertSchedule({
        expertId: fixture.expertId,
        telegramUserId: "123456789",
        from: new Date("2026-07-29T00:00:00.000Z"),
        to: new Date("2026-08-06T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();
  });

  it("rolls callback consumption back when the reservation transition fails", async () => {
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "b".repeat(64),
      action: "cancel",
      version: 4,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const command = {
      tokenHash: fixture.tokenHash,
      reservationId: fixture.claims.reservationId,
      expertId: fixture.claims.expertId,
      action: "cancel" as const,
      version: 4,
      now: new Date("2026-07-28T10:00:00.000Z"),
      correlationId: "callback-cancel-rollback",
    };
    const failing = new PostgresBookingRepository(testDb.db, {
      beforeCallbackTransition: () =>
        Promise.reject(new Error("transition interrupted")),
    });

    await expect(
      failing.transitionFromTelegramCallback(command),
    ).rejects.toThrow("transition interrupted");
    expect(await testDb.callbackConsumedAt(fixture.notificationId)).toBeNull();
    expect(await testDb.reservationStatus(fixture.claims.reservationId)).toBe(
      "reserved",
    );

    await expect(
      new PostgresBookingRepository(testDb.db).transitionFromTelegramCallback(
        command,
      ),
    ).resolves.toMatchObject({
      status: "cancelled_by_expert",
      version: 5,
    });
    expect(
      await testDb.outboxDeliveriesForCorrelation(command.correlationId),
    ).toEqual([
      expect.objectContaining({
        idempotencyKey: `${fixture.claims.reservationId}:5:client.booking_cancelled`,
        topic: "client.booking_cancelled",
        payload: expect.objectContaining({ charge: 0, version: 5 }),
      }),
    ]);
  });
});
