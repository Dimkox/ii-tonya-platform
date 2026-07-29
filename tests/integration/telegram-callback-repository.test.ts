import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresTelegramCallbackRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const expertOne = "019fa875-2d67-78f1-8c71-f4936268da29";
const expertTwo = "019fa875-2d67-78f1-8c71-f4936268da30";

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 60_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb.stop(), 60_000);

describe("PostgresTelegramCallbackRepository.consumeIfValid", () => {
  it("does not consume for the wrong expert or an expired callback", async () => {
    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    const active = await testDb.seedTelegramCallback({
      tokenHash: "hash-active",
      expertId: expertOne,
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    await expect(
      repository.consumeIfValid({
        tokenHash: active.tokenHash,
        expertId: expertTwo,
        action: "confirm",
        version: 3,
        now: new Date("2026-07-28T10:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(await testDb.callbackConsumedAt(active.notificationId)).toBeNull();

    const expired = await testDb.seedTelegramCallback({
      tokenHash: "hash-expired",
      expertId: expertOne,
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T09:59:59.000Z",
    });
    await expect(
      repository.consumeIfValid({
        tokenHash: expired.tokenHash,
        expertId: expertOne,
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
      expertId: expertOne,
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const command = {
      tokenHash: fixture.tokenHash,
      expertId: expertOne,
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
      expertId: expertOne,
      action: "cancel",
      version: 4,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const command = {
      tokenHash: fixture.tokenHash,
      expertId: expertOne,
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
});
