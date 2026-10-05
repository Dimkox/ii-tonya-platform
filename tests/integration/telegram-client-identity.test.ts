import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PostgresClientSessionRepository } from "../../packages/db/src/repositories/client-session-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 180_000);
beforeEach(async () => db.reset());
afterAll(async () => db?.stop(), 60_000);
const resolve = (id = "42") =>
  new PostgresClientSessionRepository(db.db).resolveTelegramIdentity(id);
it("creates one minimal identity concurrently, no profile or consent", async () => {
  const ids = await Promise.all(Array.from({ length: 4 }, () => resolve()));
  expect(ids[0]).toEqual(expect.any(String));
  expect(new Set(ids).size).toBe(1);
  expect(
    (
      await db.db.execute(
        sql`select (select count(*)::int from users) users, (select count(*)::int from channel_identities) identities, (select count(*)::int from consents) consents, (select count(*)::int from client_profiles) profiles`,
      )
    ).rows[0],
  ).toEqual({ users: 1, identities: 1, consents: 0, profiles: 0 });
});
it("rejects blocked, inactive, duplicate and conflicting mappings", async () => {
  const id = await db.createUser();
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,status) values (${id}::uuid,'telegram','42','blocked')`,
  );
  expect(await resolve()).toBeNull();
  await db.db.execute(sql`update channel_identities set status='active'`);
  await db.db.execute(sql`update users set active=false where id=${id}::uuid`);
  expect(await resolve()).toBeNull();
  await db.db.execute(sql`update users set active=true where id=${id}::uuid`);
  expect(await resolve()).toBe(id);
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values (${id}::uuid,'telegram','42','synthetic-bot','42')`,
  );
  expect(await resolve()).toBeNull();
});
