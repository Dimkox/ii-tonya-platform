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

const tokenDigest = (label: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(label).digest("hex")}`;
const replayDigest = (label: string): `hmac-sha256:v1:${string}` =>
  `hmac-sha256:v1:${createHash("sha256").update(`replay:${label}`).digest("hex")}`;
const future = (milliseconds: number) => new Date(Date.now() + milliseconds);

const issueInput = (userId: string, label: string) => ({
  userId,
  replayDigest: replayDigest(label),
  proofExpiresAt: future(30 * 60_000),
  tokenDigest: tokenDigest(label),
  scope: "client_catalog:read" as const,
  maximumTtlMs: 3_600_000 as const,
});

describe("PostgreSQL client session repository", () => {
  it("atomically permits only one concurrent use of a proof", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientSessionRepository(testDb.db);
    const sharedReplay = replayDigest("shared");

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.issue({
          ...issueInput(userId, `candidate-${index}`),
          replayDigest: sharedReplay,
        }),
      ),
    );

    expect(attempts.filter((result) => result.kind === "issued")).toHaveLength(1);
    expect(attempts.filter((result) => result.kind === "denied")).toHaveLength(9);
    const counts = await testDb.db.execute<{
      receipts: string;
      sessions: string;
    }>(sql`
      select
        (select count(*)::text from client_identity_proof_receipts) receipts,
        (select count(*)::text from client_sessions) sessions
    `);
    expect(counts.rows[0]).toEqual({ receipts: "1", sessions: "1" });
  });

  it("denies replay, token collision, inactive users and invalid TTL without partial rows", async () => {
    const activeUser = await testDb.createUser();
    const inactiveUser = await testDb.createUser();
    await testDb.db.execute(sql`update users set active=false where id=${inactiveUser}::uuid`);
    const repository = new PostgresClientSessionRepository(testDb.db);
    const first = issueInput(activeUser, "first");

    await expect(repository.issue(first)).resolves.toMatchObject({ kind: "issued" });
    await expect(
      repository.issue({ ...issueInput(activeUser, "replay"), replayDigest: first.replayDigest }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      repository.issue({ ...issueInput(activeUser, "collision"), tokenDigest: first.tokenDigest }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(repository.issue(issueInput(inactiveUser, "inactive"))).resolves.toEqual({
      kind: "denied",
    });
    await expect(
      repository.issue({ ...issueInput(activeUser, "expired"), proofExpiresAt: future(-1_000) }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      repository.issue({ ...issueInput(activeUser, "long"), proofExpiresAt: future(61 * 60_000) }),
    ).resolves.toEqual({ kind: "denied" });

    const counts = await testDb.db.execute<{ receipts: string; sessions: string }>(sql`
      select
        (select count(*)::text from client_identity_proof_receipts) receipts,
        (select count(*)::text from client_sessions) sessions
    `);
    expect(counts.rows[0]).toEqual({ receipts: "1", sessions: "1" });
  });

  it("resolves fresh active authority and immediately observes deactivation", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientSessionRepository(testDb.db);
    const input = issueInput(userId, "fresh");
    await repository.issue(input);

    await expect(repository.resolve(input.tokenDigest)).resolves.toEqual({
      kind: "resolved",
      principal: { authenticated: true, active: true, userId },
    });
    await testDb.db.execute(sql`update users set active=false where id=${userId}::uuid`);
    await expect(repository.resolve(input.tokenDigest)).resolves.toEqual({ kind: "denied" });
  });

  it("has one winner for concurrent revoke and denies all later resolution", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientSessionRepository(testDb.db);
    const input = issueInput(userId, "revoke");
    await repository.issue(input);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => repository.revoke(input.tokenDigest)),
    );
    expect(outcomes.filter((outcome) => outcome.kind === "revoked")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "denied")).toHaveLength(7);
    await expect(repository.resolve(input.tokenDigest)).resolves.toEqual({ kind: "denied" });
    await expect(repository.revoke(input.tokenDigest)).resolves.toEqual({ kind: "denied" });
  });

  it("uses database expiry and performs receipt-first idempotent cleanup", async () => {
    const userId = await testDb.createUser();
    const repository = new PostgresClientSessionRepository(testDb.db);
    const input = issueInput(userId, "cleanup");
    await repository.issue(input);
    await testDb.db.execute(sql`
      update client_identity_proof_receipts set expires_at=clock_timestamp() - interval '1 second';
      update client_sessions set expires_at=clock_timestamp() - interval '1 second';
    `);

    await expect(repository.resolve(input.tokenDigest)).resolves.toEqual({ kind: "denied" });
    await expect(repository.cleanupExpired(100)).resolves.toEqual({
      receiptsRemoved: 1,
      sessionsRemoved: 1,
    });
    await expect(repository.cleanupExpired(100)).resolves.toEqual({
      receiptsRemoved: 0,
      sessionsRemoved: 0,
    });
  });
});
