import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresWebhookInboxRepository, WebhookInboxClaimLostError } from "../../packages/db/src/index.js";
import { startTestPostgres, type TestDatabase } from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;
beforeAll(async () => { testDb = await startTestPostgres(); await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" }); }, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

describe("Postgres webhook inbox", () => {
  it("owns completion and allows failed delivery to be reclaimed", async () => {
    const repo = new PostgresWebhookInboxRepository(testDb!.db, 30_000);
    const first = await repo.claim("telegram", "update-1");
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");
    await repo.fail(first.claimId);
    const retry = await repo.claim("telegram", "update-1");
    expect(retry.kind).toBe("claimed");
    if (retry.kind !== "claimed") throw new Error("expected retry claim");
    await expect(repo.complete(first.claimId)).rejects.toBeInstanceOf(WebhookInboxClaimLostError);
    await repo.complete(retry.claimId);
    expect(await repo.claim("telegram", "update-1")).toEqual({ kind: "duplicate" });
  });

  it("rejects completion after the lease expires", async () => {
    const repo = new PostgresWebhookInboxRepository(testDb!.db, 30_000);
    const claim = await repo.claim("telegram", "update-expired");
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await testDb!.db.execute(sql`update webhook_inbox set lease_until = now() - interval '1 second' where claim_id = ${claim.claimId}::uuid`);
    await expect(repo.complete(claim.claimId)).rejects.toBeInstanceOf(WebhookInboxClaimLostError);
  });
});
