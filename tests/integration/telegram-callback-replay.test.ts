import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import { PostgresTelegramCallbackReplayRepository } from "../../packages/db/src/repositories/telegram-callback-replay-repository.js";
import { createTelegramCallbackService } from "../../apps/api/src/telegram-callback-service.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 180000);
afterAll(async () => {
  await db?.stop();
});

it("stores processed Telegram callbacks in Postgres and blocks replay", async () => {
  const repo = new PostgresTelegramCallbackReplayRepository(db.db);
  const userId = randomUUID();
  await db.db.execute(sql`insert into users (id) values (${userId}::uuid)`);
  await db.db.execute(
    sql`insert into experts (user_id, active) values (${userId}::uuid, true)`,
  );
  await db.db.execute(
    sql`insert into channel_identities (user_id, provider, external_id) values (${userId}::uuid, 'telegram', '424242')`,
  );
  const service = createTelegramCallbackService(repo);
  const update = {
    update_id: 1,
    callback_query: { id: "cbq-db-1", from: { id: 424242 }, data: "x" },
  };
  await expect(service.isAuthorizedIdentity("424242")).resolves.toBe(true);
  await expect(service.isAuthorizedIdentity("999")).resolves.toBe(false);
  await expect(service.verifyCallback(update, "c")).resolves.toBe(true);
  await service.process(update, "c");
  await expect(service.verifyCallback(update, "c")).resolves.toBe(false);
  // Concurrent replays: exactly one writer wins.
  const results = await Promise.all(
    Array.from({ length: 8 }, () => repo.recordProcessed("race-key")),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const rows = await db.db.execute<{ n: string }>(
    sql`select count(*)::text as n from webhook_inbox where provider = 'telegram_callback'`,
  );
  expect(rows.rows[0]?.n).toBe("2");
});
