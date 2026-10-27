import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PostgresClientSessionRepository } from "../../packages/db/src/repositories/client-session-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 120_000);
beforeEach(async () => db.reset());
afterAll(async () => db?.stop(), 120_000);
const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const input = (userId: string, label: string, grant = true) => ({
  userId,
  tokenDigest: digest(label),
  replayDigest: `hmac-sha256:v1:${digest(label).slice(7)}` as const,
  scope: "client_catalog:read" as const,
  maximumTtlMs: 3_600_000 as const,
  proofExpiresAt: new Date(Date.now() + 1_800_000),
  ...(grant ? { bookingGrant: true as const } : {}),
});

it("does not backfill pre-existing read sessions during the additive migration", async () => {
  // Only this test's disposable database is modified; reapply the actual SQL.
  await db.db.execute(sql`drop table client_session_booking_grants`);
  const repo = new PostgresClientSessionRepository(db.db);
  const old = input(await db.createUser(), "pre-migration", false);
  await repo.issue(old);
  await db.db.execute(
    sql.raw(
      readFileSync(
        "packages/db/migrations/0040_client_session_booking_grants.sql",
        "utf8",
      ),
    ),
  );
  expect(await repo.resolveBooking(old.tokenDigest)).toEqual({
    kind: "denied",
  });
  const count = await db.db.execute(
    sql`select count(*)::int n from client_session_booking_grants`,
  );
  expect(count.rows[0]).toEqual({ n: 0 });
});

it("keeps read-only sessions denied and grants only explicit new sessions", async () => {
  const user = await db.createUser();
  const repo = new PostgresClientSessionRepository(db.db);
  const old = input(user, "old", false);
  const fresh = input(user, "new");
  expect((await repo.issue(old)).kind).toBe("issued");
  expect((await repo.issue(fresh)).kind).toBe("issued");
  expect(await repo.resolveBooking(old.tokenDigest)).toEqual({
    kind: "denied",
  });
  expect(await repo.resolveBooking(fresh.tokenDigest)).toEqual({
    kind: "resolved",
    principal: {
      authenticated: true,
      active: true,
      userId: user,
    },
  });
  expect((await repo.resolve(fresh.tokenDigest)).kind).toBe("resolved");
});

it("revokes booking authority with the parent without deleting business reservations", async () => {
  const repo = new PostgresClientSessionRepository(db.db);
  const value = input(await db.createUser(), "logout");
  await repo.issue(value);
  expect((await repo.resolveBooking(value.tokenDigest)).kind).toBe("resolved");
  await repo.revoke(value.tokenDigest);
  expect(await repo.resolveBooking(value.tokenDigest)).toEqual({
    kind: "denied",
  });
  expect(await repo.resolve(value.tokenDigest)).toEqual({ kind: "denied" });
});

it.each(["expired", "inactive"])(
  "denies %s parents even with a durable grant",
  async (mode) => {
    const repo = new PostgresClientSessionRepository(db.db);
    const value = input(await db.createUser(), mode);
    await repo.issue(value);
    expect((await repo.resolveBooking(value.tokenDigest)).kind).toBe(
      "resolved",
    );
    if (mode === "inactive")
      await db.db.execute(
        sql`update users set active=false where id=${value.userId}::uuid`,
      );
    else
      await db.db.execute(
        sql`update client_sessions set created_at=now()-interval '1 hour', expires_at=now()-interval '1 second' where token_digest=${value.tokenDigest}`,
      );
    expect(await repo.resolveBooking(value.tokenDigest)).toEqual({
      kind: "denied",
    });
  },
);

it("creates one grant for replayed proof without partially issuing another session", async () => {
  const repo = new PostgresClientSessionRepository(db.db);
  const value = input(await db.createUser(), "proof");
  await repo.issue(value);
  expect(await repo.issue({ ...value, tokenDigest: digest("second") })).toEqual(
    { kind: "denied" },
  );
  const counts = await db.db.execute(sql`select
    (select count(*)::int from client_sessions) sessions,
    (select count(*)::int from client_identity_proof_receipts) receipts,
    (select count(*)::int from client_session_booking_grants) grants`);
  expect(counts.rows[0]).toEqual({ sessions: 1, receipts: 1, grants: 1 });
});

it("rolls back session and replay receipt when grant insertion fails", async () => {
  const repo = new PostgresClientSessionRepository(db.db);
  const value = input(await db.createUser(), "failure");
  await db.db.execute(
    sql`alter table client_session_booking_grants add constraint test_reject_grant check(false)`,
  );
  try {
    await expect(repo.issue(value)).rejects.toThrow(
      "client_session_repository_unavailable",
    );
    const counts = await db.db.execute(sql`select
      (select count(*)::int from client_sessions) sessions,
      (select count(*)::int from client_identity_proof_receipts) receipts,
      (select count(*)::int from client_session_booking_grants) grants`);
    expect(counts.rows[0]).toEqual({ sessions: 0, receipts: 0, grants: 0 });
  } finally {
    await db.db.execute(
      sql`alter table client_session_booking_grants drop constraint test_reject_grant`,
    );
  }
});

it("enforces one grant per existing parent and cascades parent deletion", async () => {
  const repo = new PostgresClientSessionRepository(db.db);
  const value = input(await db.createUser(), "constraints");
  await repo.issue(value);
  const initial = await db.db.execute(
    sql`select count(*)::int n from client_session_booking_grants`,
  );
  expect(initial.rows[0]).toEqual({ n: 1 });
  await expect(
    db.db.execute(
      sql`insert into client_session_booking_grants(session_token_digest) values (${value.tokenDigest})`,
    ),
  ).rejects.toThrow();
  await expect(
    db.db.execute(
      sql`insert into client_session_booking_grants(session_token_digest) values (${digest("missing")})`,
    ),
  ).rejects.toThrow();
  await db.db.execute(
    sql`delete from client_sessions where token_digest=${value.tokenDigest}`,
  );
  const final = await db.db.execute(
    sql`select count(*)::int n from client_session_booking_grants`,
  );
  expect(final.rows[0]).toEqual({ n: 0 });
});
