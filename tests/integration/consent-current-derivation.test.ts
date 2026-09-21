import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { hasCurrentTestExpertConsent } from "../../packages/db/src/repositories/test-expert-consent-authority.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

// D2 карты W1: «текущее решение» раньше выводилось двумя несовместимыми способами. Read-гейты
// эксперта брали самое позднее мгновение и требовали, чтобы все записи в нём были granted,
// а авторизация тестового эксперта — `distinct on … order by created_at desc, id desc`, где
// `id` это случайный uuid. Тест фиксирует, что теперь оба места отвечают одинаково.
let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 180_000);
afterAll(async () => testDb?.stop(), 60_000);

async function userWith(
  decisions: readonly [string, string][],
): Promise<string> {
  const user = (
    await testDb!.db.execute<{ id: string }>(
      sql`insert into users (id) values (gen_random_uuid()) returning id`,
    )
  ).rows[0];
  if (!user) throw new Error("субъект не создан");
  for (const [decision, at] of decisions) {
    await testDb!.db.execute(sql`
      insert into consents (user_id, consent_type, decision, policy_version, created_at)
      values (${user.id}::uuid, 'client_messaging', ${decision}, 'messaging-v1',
              ${at}::timestamptz)
    `);
  }
  return user.id;
}

const ask = (userId: string) =>
  hasCurrentTestExpertConsent(testDb!.db, {
    userId,
    messagingPolicyVersion: "messaging-v1",
  });

describe("single current-consent derivation", () => {
  it("grants when the latest instant is granted", async () => {
    expect(
      await ask(
        await userWith([
          ["granted", "2026-09-01T10:00:00Z"],
          ["denied", "2026-09-02T10:00:00Z"],
          ["granted", "2026-09-03T10:00:00Z"],
        ]),
      ),
    ).toBe(true);
  });

  it("withholds when the latest instant is revoked or denied", async () => {
    expect(
      await ask(
        await userWith([
          ["granted", "2026-09-01T10:00:00Z"],
          ["revoked", "2026-09-05T10:00:00Z"],
        ]),
      ),
    ).toBe(false);
    expect(
      await ask(
        await userWith([
          ["granted", "2026-09-01T10:00:00Z"],
          ["denied", "2026-09-05T10:00:00Z"],
        ]),
      ),
    ).toBe(false);
  });

  it("fails closed when the same instant contradicts itself, whatever the row order", async () => {
    // Порядок вставки намеренно противоположен в двух случаях: раньше исход решал uuid.
    for (const pair of [
      ["granted", "denied"],
      ["denied", "granted"],
    ] as const) {
      const at = "2026-09-04T10:00:00Z";
      expect(
        await ask(
          await userWith([
            [pair[0], at],
            [pair[1], at],
          ]),
        ),
        `порядок вставки ${pair.join("->")} не должен менять ответ`,
      ).toBe(false);
    }
  });

  it("does not accept a decision for another policy version", async () => {
    const userId = await userWith([["granted", "2026-09-01T10:00:00Z"]]);
    expect(
      await hasCurrentTestExpertConsent(testDb!.db, {
        userId,
        messagingPolicyVersion: "messaging-v2",
      }),
    ).toBe(false);
  });

  it("treats the absence of any decision as not granted", async () => {
    const user = (
      await testDb!.db.execute<{ id: string }>(
        sql`insert into users (id) values (gen_random_uuid()) returning id`,
      )
    ).rows[0]!;
    expect(await ask(user.id)).toBe(false);
  });
});
