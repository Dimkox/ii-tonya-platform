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

  it("derives callback ownership from the reservation and rejects a claimed cross-expert binding", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const owner = await testDb.createTelegramCallbackReservation();
    const attacker = await testDb.createTelegramCallbackReservation();
    const claims = {
      reservationId: owner.reservationId,
      expertId: attacker.expertId,
      action: "confirm" as const,
      version: 1,
      expiresAtEpochSeconds: 1785233100,
    };

    await expect(repository.put("hash-cross-owner", claims)).rejects.toThrow(
      "Callback persistence rejected",
    );
    expect(await testDb.notificationCountForToken("hash-cross-owner")).toBe(0);
  });

  it("persists only an eligible authoritative reservation expert", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const owner = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const claims = {
      reservationId: owner.reservationId,
      expertId: owner.expertId,
      action: "confirm" as const,
      version: 3,
      expiresAtEpochSeconds: 1785233100,
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
});
