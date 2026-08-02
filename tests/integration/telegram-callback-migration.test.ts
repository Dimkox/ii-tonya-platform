import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTelegramCallbackRepository } from "../../packages/db/src/index.js";
import {
  issueCallback,
  verifyCallback,
} from "../../packages/integrations/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const migration = (name: string): string =>
  readFileSync(`packages/db/migrations/${name}.sql`, "utf8");

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
}, 60_000);
afterAll(async () => testDb?.stop(), 60_000);

describe("Telegram callback 0005 to 0006 migration", () => {
  it("invalidates every pending legacy callback and permits only new ct2 callbacks", async () => {
    for (const name of [
      "0000_mvp",
      "0001_message-package-metadata",
      "0002_atomic-message-accounting",
      "0003_booking-concurrency",
      "0004_durable_outbox",
      "0005_outbox_fencing_tokens",
    ]) {
      await testDb.db.$client.query(migration(name));
    }

    const sameOwner = await testDb.seedTelegramCallback({
      tokenHash: "legacy-same-owner",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const crossOwner = await testDb.seedTelegramCallback({
      tokenHash: "legacy-cross-owner",
      action: "confirm",
      version: 3,
      expiresAt: "2026-07-28T10:05:00.000Z",
    });
    const other = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    await testDb.db.$client.query(
      `
        update notifications
        set callback_expert_id = $2::uuid
        where id = $1::uuid
      `,
      [crossOwner.notificationId, other.expertId],
    );

    await testDb.db.$client.query(
      migration("0006_telegram-callback-expert-fk"),
    );

    const legacy = await testDb.db.$client.query<{
      id: string;
      callback_token_hash: string | null;
      callback_claims: string | null;
      callback_consumed_at: Date | null;
      callback_expires_at: Date | null;
      callback_expert_id: string | null;
      reservation_expert_id: string;
    }>(
      `
        select
          n.id,
          n.callback_token_hash,
          n.callback_claims,
          n.callback_consumed_at,
          n.callback_expires_at,
          n.callback_expert_id,
          r.expert_id as reservation_expert_id
        from notifications n
        join reservations r on r.id = n.reservation_id
        where n.id = any($1::uuid[])
        order by n.id
      `,
      [[sameOwner.notificationId, crossOwner.notificationId]],
    );
    expect(legacy.rows).toHaveLength(2);
    for (const row of legacy.rows) {
      expect(row.callback_token_hash).toBeNull();
      expect(row.callback_claims).toBeNull();
      expect(row.callback_consumed_at).toBeInstanceOf(Date);
      expect(row.callback_expires_at?.getTime()).toBeLessThanOrEqual(
        row.callback_consumed_at!.getTime(),
      );
      expect(row.callback_expert_id).toBe(row.reservation_expert_id);
    }
    const dangling = await testDb.db.$client.query<{ count: string }>(`
      select count(*)::text as count
      from notifications
      where callback_token_hash is not null
        and callback_consumed_at is null
    `);
    expect(Number(dangling.rows[0]?.count ?? -1)).toBe(0);

    const repository = new PostgresTelegramCallbackRepository(testDb.db);
    await expect(repository.peek("legacy-same-owner")).resolves.toBeNull();
    await expect(repository.peek("legacy-cross-owner")).resolves.toBeNull();

    const fresh = await testDb.createTelegramCallbackReservation({
      reservationVersion: 3,
    });
    const now = new Date();
    const verifyAt = new Date(now.getTime() + 1_000);
    const expiresAtEpochSeconds = Math.floor(now.getTime() / 1_000) + 600;
    await testDb.setTelegramCallbackReservationState(fresh.reservationId, {
      reservedUntil: new Date(now.getTime() + 30 * 60_000),
    });
    await testDb.setTelegramCallbackSlotState(fresh.reservationId, {
      startsAt: new Date(now.getTime() + 60 * 60_000),
      observedAt: now,
      serviceActive: true,
    });
    const claims = {
      reservationId: fresh.reservationId,
      expertId: fresh.expertId,
      action: "confirm" as const,
      version: 3,
      expiresAtEpochSeconds,
    };
    const secret = new TextEncoder().encode(
      "__PLACEHOLDER_TELEGRAM_CALLBACK_HMAC_KEY__",
    );
    const token = await issueCallback(claims, secret, repository);
    expect(token).toMatch(/^ct2\./u);
    await expect(
      verifyCallback(
        token,
        "123456789",
        {
          telegramUserId: "123456789",
          expertId: fresh.expertId,
          active: true,
          verified: true,
        },
        secret,
        repository,
        verifyAt,
      ),
    ).resolves.toEqual(claims);
  });
});
