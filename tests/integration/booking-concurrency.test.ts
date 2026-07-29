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
    const results = await Promise.all(users.map((userId, index) => repo.reserve({
      idempotencyKey: `reserve-capacity-${index}`,
      userId,
      slotId,
      now: new Date("2026-07-28T10:00:00.000Z"),
      minimumLeadMs: 24 * 60 * 60 * 1_000,
      confirmationBufferMs: 60 * 60 * 1_000,
      correlationId: `corr-capacity-${index}`,
    })));

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(1);
    expect(results.filter((result) =>
      result.kind === "unavailable" && result.reason === "capacity"
    )).toHaveLength(1);
  });

  it("rejects a provider observation from the future", async () => {
    const slotId = await testDb.createSlot({
      capacity: 1,
      startsAt: "2026-08-02T10:00:00.000Z",
      observedAt: "2026-07-28T10:00:00.001Z",
    });
    const userId = await testDb.createUser();
    const repo = new PostgresBookingRepository(testDb.db);

    await expect(repo.reserve({
      idempotencyKey: `future-observation-${slotId}`,
      userId,
      slotId,
      now: new Date("2026-07-28T10:00:00.000Z"),
      minimumLeadMs: 24 * 60 * 60 * 1_000,
      confirmationBufferMs: 60 * 60 * 1_000,
      correlationId: `future-observation-${slotId}`,
    })).resolves.toEqual({ kind: "unavailable", reason: "stale_slot" });
  });

  it("BOOK-02 allows only one of two concurrent overlapping reservations for the same client", async () => {
    const fixture = await testDb.createOverlappingClientSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all([
      repo.reserve(fixture.first),
      repo.reserve(fixture.second),
    ]);

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(1);
    expect(results.filter((result) =>
      result.kind === "unavailable" && result.reason === "client_active_overlap"
    )).toHaveLength(1);
    expect(await testDb.activeReservationCountForClient(fixture.clientId)).toBe(1);
  });

  it("BOOK-03 allows only one of two concurrent overlapping reservations for the same expert", async () => {
    const fixture = await testDb.createOverlappingExpertSlots();
    const repo = new PostgresBookingRepository(testDb.db);
    const results = await Promise.all([
      repo.reserve(fixture.first),
      repo.reserve(fixture.second),
    ]);

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(1);
    expect(results.filter((result) =>
      result.kind === "unavailable" && result.reason === "expert_active_overlap"
    )).toHaveLength(1);
    expect(await testDb.activeReservationCountForExpert(fixture.expertId)).toBe(1);
  });

  it("restarts the whole SERIALIZABLE transaction on 40001 and stops after three attempts", async () => {
    const retried = await testDb.createReservableFixture();
    await testDb.installSerializationFailureTrigger(retried.command.idempotencyKey, 1);
    const alerts: string[] = [];
    const repo = new PostgresBookingRepository(testDb.db, {
      maxSerializationAttempts: 3,
      retryDelayMs: () => 0,
      onSerializationExhausted: (code) => alerts.push(code),
    });

    await expect(repo.reserve(retried.command)).resolves.toMatchObject({ kind: "reserved" });
    expect(await testDb.serializationAttemptCount(retried.command.idempotencyKey)).toBe(2);
    expect(await testDb.reservationCountForKey(retried.command.idempotencyKey)).toBe(1);
    expect(await testDb.outboxCountForCorrelation(retried.command.correlationId)).toBe(2);
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        retried.command.correlationId,
      )).map((delivery) => delivery.topic),
    ).toEqual(["planerka.reserve", "telegram.reservation_request"]);

    const exhausted = await testDb.createReservableFixture();
    await testDb.installSerializationFailureTrigger(exhausted.command.idempotencyKey, 3);
    const exhaustedError = await repo.reserve(exhausted.command).catch((error: unknown) => error);
    expect(exhaustedError).toBeInstanceOf(BookingSerializationExhaustedError);
    expect(exhaustedError).toMatchObject({
      code: "booking_serialization_exhausted",
      cause: expect.objectContaining({ code: "40001" }),
    });
    expect(await testDb.serializationAttemptCount(exhausted.command.idempotencyKey)).toBe(3);
    expect(await testDb.reservationCountForKey(exhausted.command.idempotencyKey)).toBe(0);
    expect(alerts).toEqual(["booking_serialization_exhausted"]);
  });

  it("returns the same reservation for a repeated selection and rejects stale callback versions", async () => {
    const fixture = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);
    const first = await repo.reserve(fixture.command);
    if (first.kind !== "reserved") throw new Error(`Expected reserved, received ${first.kind}`);
    const retry = await repo.reserve(fixture.command);
    expect(retry).toMatchObject({
      kind: "duplicate",
      reservationId: first.reservationId,
    });

    await expect(repo.transition({
      reservationId: first.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.expertId },
      now: new Date("2026-07-28T10:01:00.000Z"),
      correlationId: "confirm-1",
    })).resolves.toMatchObject({ status: "booked", version: 2 });

    await expect(repo.transition({
      reservationId: first.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.expertId },
      now: new Date("2026-07-28T10:02:00.000Z"),
      correlationId: "confirm-retry",
    })).rejects.toThrow("Stale reservation version");
    expect(await testDb.auditCountForCorrelation("confirm-1")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("confirm-1")).toBe(2);
    expect(
      await testDb.outboxDeliveriesForCorrelation("confirm-1"),
    ).toEqual([
      expect.objectContaining({
        idempotencyKey: `${first.reservationId}:2:client.booking_confirmed`,
        topic: "client.booking_confirmed",
        correlationId: "confirm-1",
        reconciliationKey: "booking:confirm-1",
        payload: expect.objectContaining({
          reservationId: first.reservationId,
          version: 2,
          charge: 0,
        }),
      }),
      expect.objectContaining({
        idempotencyKey: `${first.reservationId}:2:planerka.confirm`,
        topic: "planerka.confirm",
        correlationId: "confirm-1",
        reconciliationKey: "booking:confirm-1",
        payload: expect.objectContaining({
          reservationId: first.reservationId,
          version: 2,
          charge: 0,
        }),
      }),
    ]);
  });

  it("rejects sequential and concurrent reuse of an idempotency key for another selection", async () => {
    const first = await testDb.createReservableFixture();
    const second = await testDb.createReservableFixture();
    const repo = new PostgresBookingRepository(testDb.db);
    await expect(repo.reserve(first.command)).resolves.toMatchObject({ kind: "reserved" });

    await expect(repo.reserve({
      ...second.command,
      idempotencyKey: first.command.idempotencyKey,
    })).rejects.toBeInstanceOf(BookingIdempotencyConflictError);

    const third = await testDb.createReservableFixture();
    const fourth = await testDb.createReservableFixture();
    const sharedKey = `shared-${third.command.idempotencyKey}`;
    const settled = await Promise.allSettled([
      repo.reserve({ ...third.command, idempotencyKey: sharedKey }),
      repo.reserve({ ...fourth.command, idempotencyKey: sharedKey }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
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
    await expect(repo.transition({
      reservationId: fixture.reservationId,
      expectedVersion: 1,
      action: "expert_confirm",
      actor: { type: "expert", id: fixture.actorExpertId },
      now: fixture.now,
      correlationId: `confirm-${caseName}`,
    })).rejects.toThrow(expected);
    expect(await testDb.reservationStatus(fixture.reservationId)).toBe("reserved");
  });

  it("enforces client ownership on cancellation and deadline on system expiry", async () => {
    const fixture = await testDb.createReservableFixture();
    const otherUser = await testDb.createUser();
    const repo = new PostgresBookingRepository(testDb.db);
    const reserved = await repo.reserve(fixture.command);
    if (reserved.kind !== "reserved") throw new Error("Expected reservation");

    await expect(repo.transition({
      reservationId: reserved.reservationId,
      expectedVersion: reserved.version,
      action: "client_cancel",
      actor: { type: "client", id: otherUser },
      now: fixture.command.now,
      correlationId: "wrong-client",
    })).rejects.toThrow("Client does not own reservation");

    await expect(repo.transition({
      reservationId: reserved.reservationId,
      expectedVersion: reserved.version,
      action: "expire",
      actor: { type: "system", id: fixture.expertId },
      now: fixture.command.now,
      correlationId: "early-expiry",
    })).rejects.toThrow("Reservation hold has not expired");

    await expect(repo.transition({
      reservationId: reserved.reservationId,
      expectedVersion: reserved.version,
      action: "client_cancel",
      actor: { type: "client", id: fixture.command.userId },
      now: fixture.command.now,
      correlationId: "client-cancelled",
    })).resolves.toMatchObject({
      status: "cancelled_by_client",
      version: 2,
    });
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        "client-cancelled",
      )).map((delivery) => delivery.topic),
    ).toEqual(["planerka.cancel", "telegram.booking_cancelled"]);

    const expiryFixture = await testDb.createReservableFixture();
    const expiring = await repo.reserve(expiryFixture.command);
    if (expiring.kind !== "reserved") {
      throw new Error("Expected expiring reservation");
    }
    await expect(repo.transition({
      reservationId: expiring.reservationId,
      expectedVersion: expiring.version,
      action: "expire",
      actor: { type: "system", id: expiryFixture.expertId },
      now: new Date("2026-08-01T10:00:00.000Z"),
      correlationId: "system-expired",
    })).resolves.toMatchObject({ status: "expired", version: 2 });
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        "system-expired",
      )).map((delivery) => delivery.topic),
    ).toEqual([
      "client.reservation_expired",
      "expert.reservation_expired",
      "planerka.cancel",
    ]);
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
      await repo.transition({
        reservationId: reserved.reservationId,
        expectedVersion: 1,
        action: "expert_confirm",
        actor: { type: "expert", id: fixture.expertId },
        now: new Date("2026-07-28T10:01:00.000Z"),
        correlationId,
      });
      return reserved.reservationId;
    };

    const completeReservationId = await book(completeFixture, "book-for-complete");
    await expect(repo.transition({
      reservationId: completeReservationId,
      expectedVersion: 2,
      action: "complete",
      actor: { type: "client", id: completeFixture.command.userId },
      now: new Date("2026-08-02T11:00:00.000Z"),
      correlationId: "unauthorized-complete",
    })).rejects.toThrow("System actor is required");
    await expect(repo.transition({
      reservationId: completeReservationId,
      expectedVersion: 2,
      action: "complete",
      actor: { type: "system", id: completeFixture.expertId },
      now: new Date("2026-08-02T11:00:00.000Z"),
      correlationId: "authorized-complete",
    })).resolves.toMatchObject({ status: "completed", version: 3 });

    const noShowReservationId = await book(noShowFixture, "book-for-no-show");
    await expect(repo.transition({
      reservationId: noShowReservationId,
      expectedVersion: 2,
      action: "mark_no_show",
      actor: { type: "client", id: noShowFixture.command.userId },
      now: new Date("2026-08-02T11:00:00.000Z"),
      correlationId: "unauthorized-no-show",
    })).rejects.toThrow("Expert does not own reservation");
    await expect(repo.transition({
      reservationId: noShowReservationId,
      expectedVersion: 2,
      action: "mark_no_show",
      actor: { type: "expert", id: noShowFixture.expertId },
      now: new Date("2026-08-02T11:00:00.000Z"),
      correlationId: "authorized-no-show",
    })).resolves.toMatchObject({ status: "no_show", version: 3 });

    expect(await testDb.auditCountForCorrelation("authorized-complete")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("authorized-complete")).toBe(1);
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        "authorized-complete",
      )).map((delivery) => delivery.topic),
    ).toEqual(["client.booking_completed"]);
    expect(await testDb.auditCountForCorrelation("authorized-no-show")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("authorized-no-show")).toBe(1);
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        "authorized-no-show",
      )).map((delivery) => delivery.topic),
    ).toEqual(["client.booking_no_show"]);
  });

  it("consumes an expert callback and transitions the reservation in one transaction", async () => {
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "a".repeat(64),
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
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
    expect(
      await testDb.reservationStatus(fixture.claims.reservationId),
    ).toBe("reserved");

    await expect(
      repository.transitionFromTelegramCallback(command),
    ).resolves.toMatchObject({
      reservationId: fixture.claims.reservationId,
      status: "booked",
      version: 4,
    });
    await expect(
      repository.transitionFromTelegramCallback(command),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(fixture.notificationId)).toEqual(
      command.now,
    );
    expect(
      (await testDb.outboxDeliveriesForCorrelation(
        command.correlationId,
      )).map((delivery) => delivery.topic),
    ).toEqual(["client.booking_confirmed", "planerka.confirm"]);
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
    expect(
      await testDb.reservationStatus(fixture.claims.reservationId),
    ).toBe("reserved");

    await expect(
      new PostgresBookingRepository(
        testDb.db,
      ).transitionFromTelegramCallback(command),
    ).resolves.toMatchObject({
      status: "cancelled_by_expert",
      version: 5,
    });
    expect(
      await testDb.outboxDeliveriesForCorrelation(command.correlationId),
    ).toEqual([
      expect.objectContaining({
        idempotencyKey:
          `${fixture.claims.reservationId}:5:client.booking_cancelled`,
        topic: "client.booking_cancelled",
        payload: expect.objectContaining({ charge: 0, version: 5 }),
      }),
      expect.objectContaining({
        idempotencyKey:
          `${fixture.claims.reservationId}:5:planerka.cancel`,
        topic: "planerka.cancel",
        payload: expect.objectContaining({ charge: 0, version: 5 }),
      }),
    ]);
  });
});
