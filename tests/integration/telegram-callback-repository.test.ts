import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresTelegramCallbackRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 60_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 60_000);

const eligibleIssuanceTimes = () => {
  const now = Date.now();
  return {
    observedAt: new Date(now - 1_000),
    startsAt: new Date(now + 60 * 60_000),
    reservedUntil: new Date(now + 30 * 60_000),
    expiresAtEpochSeconds: Math.floor(now / 1_000) + 10 * 60,
  };
};

const makeConfirmIssuanceEligible = async (
  reservationId: string,
  times = eligibleIssuanceTimes(),
) => {
  await testDb.setTelegramCallbackReservationState(reservationId, {
    reservedUntil: times.reservedUntil,
  });
  await testDb.setTelegramCallbackSlotState(reservationId, {
    observedAt: times.observedAt,
    startsAt: times.startsAt,
    serviceActive: true,
  });
  return times;
};

describe("PostgresTelegramCallbackRepository.consumeIfValid", () => {
  it("does not consume for the wrong expert or an expired callback", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const active = await testDb.seedTelegramCallback({
      tokenHash: "hash-active",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const other = await testDb.seedTelegramCallback({
      tokenHash: "hash-other-expert",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    await expect(
      repository.consumeIfValid({
        tokenHash: active.tokenHash,
        expertId: other.claims.expertId,
        action: "confirm",
        version: 3,
        now: new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(active.notificationId)).toBeNull();

    const expired = await testDb.seedTelegramCallback({
      tokenHash: "hash-expired",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T09:59:59.000Z",
    });
    await expect(
      repository.consumeIfValid({
        tokenHash: expired.tokenHash,
        expertId: expired.claims.expertId,
        action: "confirm",
        version: 3,
        now: new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(expired.notificationId)).toBeNull();
  });

  it("returns claims once for valid contiguous bindings and rejects replay", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "hash-valid",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const command = {
      tokenHash: fixture.tokenHash,
      expertId: fixture.claims.expertId,
      action: "confirm" as const,
      version: 3,
      now: new Date("2026-07-28T10:00:00.000Z"),
    };
    await expect(repository.consumeIfValid(command)).resolves.toEqual(
      fixture.claims,
    );
    await expect(repository.consumeIfValid(command)).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(fixture.notificationId)).toEqual(
      new Date("2026-07-28T10:00:00.000Z"),
    );
  });

  it("atomically allows only one concurrent consumer", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "hash-concurrent",
      action: "cancel",
      version: 4,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const command = {
      tokenHash: fixture.tokenHash,
      expertId: fixture.claims.expertId,
      action: "cancel" as const,
      version: 4,
      now: new Date("2026-07-28T10:00:00.000Z"),
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.consumeIfValid(command)),
    );
    expect(results.filter((result) => result !== null)).toEqual([
      fixture.claims,
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(9);
  });

  it("rejects inactive and unverified authoritative reservation experts", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    for (const [tokenHash, flags] of [
      ["hash-inactive", { expertActive: false, expertVerified: true }],
      ["hash-unverified", { expertActive: true, expertVerified: false }],
    ] as const) {
      const fixture = await testDb.seedTelegramCallback({
        tokenHash,
        action: "confirm",
        version: 3,
        expiresAt: "2026-07-28T10:05:00.000Z",
        ...flags,
      });
      await expect(
        repository.consumeIfValid({
          tokenHash,
          expertId: fixture.claims.expertId,
          action: "confirm",
          version: 3,
          now: new Date("2026-07-28T10:00:00.000Z"),
        }),
      ).resolves.toBeNull();
      expect(
        await testDb.callbackConsumedAt(fixture.notificationId),
      ).toBeNull();
    }
  });

  it("rejects stale callback versions and ineligible current reservation status", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    for (const [tokenHash, state] of [
      ["hash-stale-reservation", { version: 4 }],
      [
        "hash-cancelled-reservation",
        { status: "cancelled_by_client" as const },
      ],
      [
        "hash-expired-hold",
        { reservedUntil: new Date("2026-07-28T09:59:59.000Z") },
      ],
    ] as const) {
      const fixture = await testDb.seedTelegramCallback({
        tokenHash,
        action: "confirm",
        version: 3,
        expiresAt: "2026-07-28T10:05:00.000Z",
      });
      await testDb.setTelegramCallbackReservationState(
        fixture.claims.reservationId,
        state,
      );
      await expect(
        repository.consumeIfValid({
          tokenHash,
          expertId: fixture.claims.expertId,
          action: "confirm",
          version: 3,
          now: new Date("2026-07-28T10:00:00.000Z"),
        }),
      ).resolves.toBeNull();
      expect(
        await testDb.callbackConsumedAt(fixture.notificationId),
      ).toBeNull();
    }
  });

  it("requires a future, fresh, eligible slot for confirm callbacks", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    for (const [tokenHash, state] of [
      ["hash-past-slot", { startsAt: new Date("2026-07-28T09:59:59.000Z") }],
      ["hash-stale-slot", { observedAt: new Date("2026-07-28T09:44:59.000Z") }],
      ["hash-inactive-service", { serviceActive: false }],
    ] as const) {
      const fixture = await testDb.seedTelegramCallback({
        tokenHash,
        action: "confirm",
        version: 3,
        expiresAt: "2026-07-28T10:05:00.000Z",
      });
      await testDb.setTelegramCallbackSlotState(
        fixture.claims.reservationId,
        state,
      );
      await expect(
        repository.consumeIfValid({
          tokenHash,
          expertId: fixture.claims.expertId,
          action: "confirm",
          version: 3,
          now: new Date("2026-07-28T10:00:00.000Z"),
        }),
      ).resolves.toBeNull();
      expect(
        await testDb.callbackConsumedAt(fixture.notificationId),
      ).toBeNull();
    }
  });

  it("does not apply confirm-only hold predicates to a booked cancellation", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const fixture = await testDb.seedTelegramCallback({
      tokenHash: "hash-booked-cancel",
      action: "cancel",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    await testDb.setTelegramCallbackReservationState(
      fixture.claims.reservationId,
      {
        status: "booked",
        reservedUntil: new Date("2026-07-28T09:00:00.000Z"),
      },
    );
    await expect(
      repository.consumeIfValid({
        tokenHash: fixture.tokenHash,
        expertId: fixture.claims.expertId,
        action: "cancel",
        version: 3,
        now: new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).resolves.toEqual(fixture.claims);
  });

  it("derives callback ownership from the reservation and rejects a claimed cross-expert binding", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const owner = await testDb.createTelegramCallbackReservation();
    const attacker = await testDb.createTelegramCallbackReservation();
    const times = await makeConfirmIssuanceEligible(owner.reservationId);
    const claims = {
      reservationId: owner.reservationId,
      expertId: attacker.expertId,
      action: "confirm" as const,
      version: 1,
      expiresAtEpochSeconds: times.expiresAtEpochSeconds,
    };

    await expect(repository.put("hash-cross-owner", claims)).rejects.toThrow(
      "Callback persistence rejected",
    );
    expect(await testDb.notificationCountForToken("hash-cross-owner")).toBe(0);
  });

  it("rejects cross-wired reservation slot and service ownership on put and consume", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const putFixture = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const putTimes = await makeConfirmIssuanceEligible(
      putFixture.reservationId,
    );
    await testDb.crossWireTelegramCallbackReservation(
      putFixture.reservationId,
    );
    await expect(
      repository.put("hash-cross-wired-put", {
        reservationId: putFixture.reservationId,
        expertId: putFixture.expertId,
        action: "confirm",
        version: 3,
        expiresAtEpochSeconds: putTimes.expiresAtEpochSeconds,
      }),
    ).rejects.toMatchObject({
      name: "CallbackConflictError",
      retryable: false,
    });
    expect(
      await testDb.notificationCountForToken("hash-cross-wired-put"),
    ).toBe(0);

    const consumeFixture = await testDb.seedTelegramCallback({
      tokenHash: "hash-cross-wired-consume",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    await testDb.crossWireTelegramCallbackReservation(
      consumeFixture.claims.reservationId,
    );
    await expect(
      repository.consumeIfValid({
        tokenHash: consumeFixture.tokenHash,
        expertId: consumeFixture.claims.expertId,
        action: "confirm",
        version: 3,
        now: new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(
      await testDb.callbackConsumedAt(consumeFixture.notificationId),
    ).toBeNull();
  });

  it("persists only an eligible authoritative reservation expert", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const owner = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const ownerTimes = await makeConfirmIssuanceEligible(owner.reservationId);
    const claims = {
      reservationId: owner.reservationId,
      expertId: owner.expertId,
      action: "confirm" as const,
      version: 3,
      expiresAtEpochSeconds: ownerTimes.expiresAtEpochSeconds,
    };
    await expect(
      repository.put("hash-authoritative", claims),
    ).resolves.toBeUndefined();
    await expect(repository.peek("hash-authoritative")).resolves.toEqual(
      claims,
    );

    for (const [tokenHash, flags] of [
      ["hash-put-inactive", { expertActive: false, expertVerified: true }],
      ["hash-put-unverified", { expertActive: true, expertVerified: false }],
    ] as const) {
      const ineligible = await testDb.createTelegramCallbackReservation({
        ...flags,
        reservationVersion: 3,
      });
      await makeConfirmIssuanceEligible(ineligible.reservationId);
      await expect(
        repository.put(tokenHash, {
          ...claims,
          reservationId: ineligible.reservationId,
          expertId: ineligible.expertId,
        }),
      ).rejects.toThrow("Callback persistence rejected");
      expect(await testDb.notificationCountForToken(tokenHash)).toBe(0);
    }
  });

  it("does not issue confirm callbacks for expired or stale authoritative state", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    for (const [tokenHash, mutate, expiresAtEpochSeconds] of [
      [
        "hash-put-expired-token",
        async () => undefined,
        Math.floor(Date.now() / 1_000) - 1,
      ],
      [
        "hash-put-expired-hold",
        async (reservationId: string) =>
          testDb.setTelegramCallbackReservationState(reservationId, {
            reservedUntil: new Date(Date.now() - 60_000),
          }),
        Math.floor(Date.now() / 1_000) + 600,
      ],
      [
        "hash-put-past-slot",
        async (reservationId: string) =>
          testDb.setTelegramCallbackSlotState(reservationId, {
            startsAt: new Date(Date.now() - 60_000),
          }),
        Math.floor(Date.now() / 1_000) + 600,
      ],
      [
        "hash-put-stale-slot",
        async (reservationId: string) =>
          testDb.setTelegramCallbackSlotState(reservationId, {
            observedAt: new Date(Date.now() - 16 * 60_000),
          }),
        Math.floor(Date.now() / 1_000) + 600,
      ],
      [
        "hash-put-inactive-service-state",
        async (reservationId: string) =>
          testDb.setTelegramCallbackSlotState(reservationId, {
            serviceActive: false,
          }),
        Math.floor(Date.now() / 1_000) + 600,
      ],
    ] as const) {
      const fixture = await testDb.createTelegramCallbackReservation({
        reservationVersion: 3,
      });
      await makeConfirmIssuanceEligible(fixture.reservationId);
      await mutate(fixture.reservationId);
      await expect(
        repository.put(tokenHash, {
          reservationId: fixture.reservationId,
          expertId: fixture.expertId,
          action: "confirm",
          version: 3,
          expiresAtEpochSeconds,
        }),
      ).rejects.toMatchObject({
        name: "CallbackConflictError",
        retryable: false,
      });
      expect(await testDb.notificationCountForToken(tokenHash)).toBe(0);
    }
  });

  it("issues booked cancellation without confirm-only hold and slot predicates", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const fixture = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    await testDb.setTelegramCallbackReservationState(fixture.reservationId, {
      status: "booked",
      reservedUntil: new Date(Date.now() - 60_000),
    });
    await testDb.setTelegramCallbackSlotState(fixture.reservationId, {
      startsAt: new Date(Date.now() - 60_000),
      observedAt: new Date(Date.now() - 60 * 60_000),
      serviceActive: false,
    });
    await expect(
      repository.put("hash-put-booked-cancel", {
        reservationId: fixture.reservationId,
        expertId: fixture.expertId,
        action: "cancel",
        version: 3,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 600,
      }),
    ).resolves.toBeUndefined();
    expect(
      await testDb.notificationCountForToken("hash-put-booked-cancel"),
    ).toBe(1);
  });

  it("rejects a sub-second capped expiry and issues from the next epoch second", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const subSecond = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const subSecondClock =
      await testDb.prepareTelegramCallbackIssuanceBoundary(
        subSecond.reservationId,
        "same_epoch_subsecond",
      );
    await expect(
      repository.put("hash-put-subsecond-expiry", {
        reservationId: subSecond.reservationId,
        expertId: subSecond.expertId,
        action: "confirm",
        version: 3,
        expiresAtEpochSeconds: subSecondClock + 600,
      }),
    ).rejects.toMatchObject({
      name: "CallbackConflictError",
      retryable: false,
    });
    expect(
      await testDb.notificationCountForToken("hash-put-subsecond-expiry"),
    ).toBe(0);

    const nextSecond = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const nextSecondClock =
      await testDb.prepareTelegramCallbackIssuanceBoundary(
        nextSecond.reservationId,
        "future_epoch",
      );
    await expect(
      repository.put("hash-put-next-second-expiry", {
        reservationId: nextSecond.reservationId,
        expertId: nextSecond.expertId,
        action: "confirm",
        version: 3,
        expiresAtEpochSeconds: nextSecondClock + 600,
      }),
    ).resolves.toBeUndefined();
    expect(
      await testDb.notificationCountForToken("hash-put-next-second-expiry"),
    ).toBe(1);
  });

  it("caps confirm callback expiry at the authoritative reservation hold", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const owner = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const times = eligibleIssuanceTimes();
    times.reservedUntil.setMilliseconds(0);
    await makeConfirmIssuanceEligible(owner.reservationId, times);
    const requestedClaims = {
      reservationId: owner.reservationId,
      expertId: owner.expertId,
      action: "confirm" as const,
      version: 3,
      expiresAtEpochSeconds: times.expiresAtEpochSeconds + 60 * 60,
    };
    await repository.put("hash-expiry-cap", requestedClaims);
    await expect(repository.peek("hash-expiry-cap")).resolves.toEqual({
      ...requestedClaims,
      expiresAtEpochSeconds: Math.floor(times.reservedUntil.getTime() / 1_000),
    });
  });
});
