import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresClientSessionRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const digest = (prefix: "sha256" | "hmac-sha256:v1", label: string) =>
  `${prefix}:${createHash("sha256").update(label).digest("hex")}`;

describe("client session database-clock review closure", () => {
  it("uses one stable database instant across a delayed insert boundary", async () => {
    const userId = await testDb.createUser();
    await testDb.db.execute(sql`
      create or replace function delay_client_session_insert()
      returns trigger language plpgsql as $$
      begin
        perform pg_sleep(1.5);
        return new;
      end $$
    `);
    await testDb.db.execute(sql`
      create trigger delay_client_session_insert_trigger
      before insert on client_sessions
      for each row execute function delay_client_session_insert()
    `);
    const repository = new PostgresClientSessionRepository(testDb.db);
    await expect(repository.issue({
      userId,
      replayDigest: digest("hmac-sha256:v1", "review-replay") as `hmac-sha256:v1:${string}`,
      proofExpiresAt: new Date(Date.now() + 1_000),
      tokenDigest: digest("sha256", "review-token") as `sha256:${string}`,
      scope: "client_catalog:read",
      maximumTtlMs: 3_600_000,
    })).resolves.toMatchObject({ kind: "issued" });
  });
});
