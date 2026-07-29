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
    expect(await testDb.outboxCountForCorrelation(retried.command.correlationId)).toBe(1);

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
    expect(await testDb.outboxCountForCorrelation("confirm-1")).toBe(1);
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
    expect(await testDb.auditCountForCorrelation("authorized-no-show")).toBe(1);
    expect(await testDb.outboxCountForCorrelation("authorized-no-show")).toBe(1);
  });
});
