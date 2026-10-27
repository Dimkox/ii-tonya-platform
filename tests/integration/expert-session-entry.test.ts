import { createHash, createHmac, randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { loadEnv } from "../../packages/config/src/env.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { buildApp } from "../../apps/api/src/app.js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PostgresExpertSessionRepository as ComposedSessionRepository } from "../../packages/db/dist/index.js";
import { createProductionWorkerRuntimeFactory } from "../../apps/worker/src/main.js";
import { PostgresExpertSessionRepository } from "../../packages/db/src/repositories/expert-session-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let database: ExpertReferralTestDatabase;
it.each(["before_issue", "after_issue"] as const)(
  "same-row sender remap invalidates the signed identity %s",
  async (stage) => {
    const i = await input();
    const verified = await repo().resolveTelegramIdentity(i.externalId);
    expect(verified).toMatchObject({
      externalId: i.externalId,
      botKey: i.botKey,
      externalChatId: i.externalChatId,
    });
    if (stage === "after_issue")
      expect((await repo().issue(i)).kind).toBe("issued");
    await database.db.execute(
      sql`update channel_identities set external_id='987654321',external_chat_id='987654321' where id=${i.channelIdentityId}::uuid`,
    );
    expect(await repo().resolveTelegramIdentity("987654321")).toMatchObject({
      userId: i.userId,
      expertId: i.expertId,
      channelIdentityId: i.channelIdentityId,
      externalId: "987654321",
    });
    expect(
      await repo().issue({
        ...i,
        tokenDigest: digest(),
        replayDigest: `expert-login:v1:${digest().slice(7)}`,
      }),
    ).toEqual({ kind: "denied" });
    expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
    expect(await repo().revoke(i.tokenDigest)).toEqual({ kind: "denied" });
  },
);
it("same-row legacy scope/private-chat changes invalidate the stored snapshot", async () => {
  const i = await input();
  expect((await repo().issue(i)).kind).toBe("issued");
  await database.db.execute(
    sql`update channel_identities set bot_key=null,external_chat_id=null where id=${i.channelIdentityId}::uuid`,
  );
  expect(await repo().resolveTelegramIdentity(i.externalId)).not.toBeNull();
  expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
  const legacy = {
    ...i,
    botKey: null,
    externalChatId: null,
    tokenDigest: digest(),
    replayDigest: `expert-login:v1:${digest().slice(7)}`,
  };
  expect((await repo().issue(legacy)).kind).toBe("issued");
  await database.db.execute(
    sql`update channel_identities set external_chat_id=external_id where id=${i.channelIdentityId}::uuid`,
  );
  expect(await repo().resolveTelegramIdentity(i.externalId)).not.toBeNull();
  expect(await repo().findByTokenHash(legacy.tokenDigest)).toBeNull();
  expect(await repo().revoke(legacy.tokenDigest)).toEqual({ kind: "denied" });
});
it("channel erasure cascades session removal but preserves unexpired proof consumption", async () => {
  const i = await input();
  expect((await repo().issue(i)).kind).toBe("issued");
  await database.db.transaction(async (tx) => {
    await tx.execute(
      sql`delete from channel_identities where id=${i.channelIdentityId}::uuid`,
    );
    await tx.execute(
      sql`update users set active=false where id=${i.userId}::uuid`,
    );
  });
  expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
  expect(
    (
      await database.db.execute(
        sql`select replay_digest,session_token_digest,expires_at>clock_timestamp() unexpired from expert_identity_proof_receipts`,
      )
    ).rows,
  ).toEqual([
    {
      replay_digest: i.replayDigest,
      session_token_digest: null,
      unexpired: true,
    },
  ]);
  expect(await repo().cleanupExpired(100)).toEqual({
    sessionsRemoved: 0,
    receiptsRemoved: 0,
  });
  // Even a subsequently restored valid owner/channel cannot replay that proof.
  await database.db.execute(
    sql`update users set active=true where id=${i.userId}::uuid`,
  );
  const channel = (
    await database.db.execute<{ id: string }>(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${i.userId}::uuid,'telegram','123456789','expert-bot','123456789') returning id`,
    )
  ).rows[0]!.id;
  expect(
    await repo().issue({
      ...i,
      channelIdentityId: channel,
      tokenDigest: digest(),
    }),
  ).toEqual({ kind: "denied" });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_sessions`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it.each(["unresolved", "other_bot", "competing_owner", "nonexpert"] as const)(
  "denies %s mapping without creating authority",
  async (kind) => {
    const i = await input();
    if (kind === "unresolved")
      await database.db.execute(
        sql`update channel_identities set status='unresolved' where id=${i.channelIdentityId}::uuid`,
      );
    if (kind === "other_bot")
      await database.db.execute(
        sql`update channel_identities set bot_key='other-bot' where id=${i.channelIdentityId}::uuid`,
      );
    if (kind === "nonexpert")
      await database.db.execute(
        sql`delete from experts where id=${i.expertId}::uuid`,
      );
    if (kind === "competing_owner") {
      const userId = randomUUID();
      await database.db.execute(
        sql`insert into users(id) values(${userId}::uuid)`,
      );
      await database.db.execute(
        sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${userId}::uuid,'telegram','123456789','other-bot','123456789')`,
      );
    }
    expect(await repo().resolveTelegramIdentity("123456789")).toBeNull();
    expect(await repo().issue(i)).toEqual({ kind: "denied" });
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int n from expert_sessions`,
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
  },
);
const repo = () =>
  new PostgresExpertSessionRepository(database.db, "expert-bot");
const digest = () =>
  `sha256:${createHash("sha256").update(randomUUID()).digest("hex")}` as const;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
}, 120000);
beforeEach(async () => {
  await database.reset();
});
afterAll(async () => {
  await database?.stop();
});
async function identity() {
  const owner = await database.createExpertIdentity({
    externalId: "123456789",
  });
  const rows = await database.db.execute<{ id: string }>(
    sql`update channel_identities set bot_key='expert-bot',external_chat_id=external_id where user_id=${owner.userId}::uuid returning id`,
  );
  return { ...owner, channelIdentityId: rows.rows[0]!.id };
}
async function input() {
  const owner = await identity();
  return {
    userId: owner.userId,
    expertId: owner.expertId,
    channelIdentityId: owner.channelIdentityId,
    externalId: "123456789",
    botKey: "expert-bot",
    externalChatId: "123456789",
    tokenDigest: digest(),
    replayDigest: `expert-login:v1:${digest().slice(7)}`,
    proofExpiresAt: new Date(Date.now() + 60000),
  };
}
it("issues only for an exact verified private-channel owner and resolves/revokes the opaque digest", async () => {
  const i = await input();
  expect(await repo().resolveTelegramIdentity("123456789")).toEqual({
    userId: i.userId,
    expertId: i.expertId,
    channelIdentityId: i.channelIdentityId,
    externalId: i.externalId,
    botKey: i.botKey,
    externalChatId: i.externalChatId,
  });
  const result = await repo().issue(i);
  expect(result.kind).toBe("issued");
  expect(await repo().findByTokenHash(i.tokenDigest)).toMatchObject({
    userId: i.userId,
    expertId: i.expertId,
    expiresAt: expect.any(Date),
  });
  const rows = (
    await database.db.execute(
      sql`select token_digest,expires_at-created_at<=interval '1 hour' bounded from expert_sessions`,
    )
  ).rows;
  expect(rows).toEqual([{ token_digest: i.tokenDigest, bounded: true }]);
  expect(await repo().revoke(i.tokenDigest)).toEqual({ kind: "revoked" });
  expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
});
it.each([
  "user",
  "expert",
  "verified",
  "owner",
  "channel",
  "blocked",
  "chat",
] as const)(
  "rechecks %s authority at issuance and every lookup",
  async (change) => {
    const i = await input();
    expect((await repo().issue(i)).kind).toBe("issued");
    if (change === "user")
      await database.db.execute(
        sql`update users set active=false where id=${i.userId}::uuid`,
      );
    if (change === "expert")
      await database.db.execute(
        sql`update experts set active=false where id=${i.expertId}::uuid`,
      );
    if (change === "verified")
      await database.db.execute(
        sql`update experts set verified=false where id=${i.expertId}::uuid`,
      );
    if (change === "owner" || change === "channel") {
      const otherUserId = randomUUID();
      await database.db.execute(
        sql`insert into users(id) values(${otherUserId}::uuid)`,
      );
      await database.db.execute(
        change === "owner"
          ? sql`update experts set user_id=${otherUserId}::uuid where id=${i.expertId}::uuid`
          : sql`update channel_identities set user_id=${otherUserId}::uuid where id=${i.channelIdentityId}::uuid`,
      );
    }
    if (change === "blocked")
      await database.db.execute(
        sql`update channel_identities set status='blocked' where id=${i.channelIdentityId}::uuid`,
      );
    if (change === "chat")
      await database.db.execute(
        sql`update channel_identities set external_chat_id='-123' where id=${i.channelIdentityId}::uuid`,
      );
    expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
    expect(
      await repo().issue({
        ...i,
        tokenDigest: digest(),
        replayDigest: `expert-login:v1:${digest().slice(7)}`,
      }),
    ).toEqual({ kind: "denied" });
    expect(await repo().revoke(i.tokenDigest)).toEqual({ kind: "denied" });
  },
);
it("consumes a proof once even with concurrent different tokens", async () => {
  const i = await input();
  const results = await Promise.all([
    repo().issue(i),
    repo().issue({ ...i, tokenDigest: digest() }),
  ]);
  expect(results.map((x) => x.kind).sort()).toEqual(["denied", "issued"]);
  expect(
    (
      await database.db.execute(
        sql`select (select count(*)::int from expert_sessions) sessions,(select count(*)::int from expert_identity_proof_receipts) receipts`,
      )
    ).rows,
  ).toEqual([{ sessions: 1, receipts: 1 }]);
});
it("denies expired proof without creating session or consuming receipt", async () => {
  const i = await input();
  expect(
    await repo().issue({ ...i, proofExpiresAt: new Date(Date.now() - 1) }),
  ).toEqual({ kind: "denied" });
  expect(
    (
      await database.db.execute(
        sql`select count(*)::int n from expert_sessions`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it("accepts sole legacy mapping but rejects ambiguity and unknown users", async () => {
  const i = await input();
  await database.db.execute(
    sql`update channel_identities set bot_key=null,external_chat_id=null where id=${i.channelIdentityId}::uuid`,
  );
  expect(await repo().resolveTelegramIdentity("123456789")).toEqual({
    userId: i.userId,
    expertId: i.expertId,
    channelIdentityId: i.channelIdentityId,
    externalId: i.externalId,
    botKey: null,
    externalChatId: null,
  });
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values(${i.userId}::uuid,'telegram','123456789','other-bot','123456789')`,
  );
  expect(await repo().resolveTelegramIdentity("123456789")).toBeNull();
  expect(await repo().resolveTelegramIdentity("999999999")).toBeNull();
});
it("bounded cleanup preserves unexpired replay receipts and rejects invalid limits", async () => {
  const i = await input();
  expect((await repo().issue(i)).kind).toBe("issued");
  await repo().revoke(i.tokenDigest);
  expect(await repo().cleanupExpired(1)).toEqual({
    sessionsRemoved: 0,
    receiptsRemoved: 0,
  });
  await expect(repo().cleanupExpired(0)).rejects.toThrow();
});
it("ordinary lifecycle verifies signed proof, issues the real DB bearer and revokes it", async () => {
  const owner = await identity();
  const botToken = `123456:${"x".repeat(35)}`;
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_SESSION_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: botToken,
    EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
    EXPERT_WEB_ORIGIN: "https://expert.example",
    EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
  });
  const app = await buildApp(
    await createDefaultLifecycle().dependencies(config, database.db),
  );
  function proof(id: number) {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id, first_name: "Synthetic" }),
    });
    params.sort();
    params.set(
      "hash",
      createHmac(
        "sha256",
        createHmac("sha256", "WebAppData").update(botToken).digest(),
      )
        .update([...params].map(([k, v]) => `${k}=${v}`).join("\n"))
        .digest("hex"),
    );
    return `mini:${params}`;
  }
  try {
    const denied = await app.inject({
      method: "POST",
      url: "/v1/expert/sessions",
      payload: { identityProof: proof(999999999) },
    });
    expect(denied.statusCode).toBe(401);
    const issued = await app.inject({
      method: "POST",
      url: "/v1/expert/sessions",
      payload: { identityProof: proof(123456789) },
    });
    expect(issued.statusCode).toBe(201);
    const token = issued.json<{ accessToken: string }>().accessToken;
    expect(token).toMatch(/^es1\.[A-Za-z0-9_-]{43}$/u);
    const headers = { authorization: `Bearer ${token}` };
    const current = await app.inject({ url: "/v1/expert/session", headers });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({
      userId: owner.userId,
      expertId: owner.expertId,
      expiresAt: expect.any(String),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/expert/sessions",
          payload: { identityProof: proof(123456789) },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/expert/sessions/current",
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: "/v1/expert/session", headers })).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
it("cleanup removes only expired rows within each bound", async () => {
  const i = await input();
  expect((await repo().issue(i)).kind).toBe("issued");
  await database.db.execute(
    sql`update expert_identity_proof_receipts set created_at=statement_timestamp()-interval '2 minutes',expires_at=statement_timestamp()-interval '1 minute'`,
  );
  await database.db.execute(
    sql`update expert_sessions set created_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour'`,
  );
  expect(await repo().findByTokenHash(i.tokenDigest)).toBeNull();
  expect(await repo().cleanupExpired(1)).toEqual({
    sessionsRemoved: 1,
    receiptsRemoved: 1,
  });
  expect(await repo().cleanupExpired(1)).toEqual({
    sessionsRemoved: 0,
    receiptsRemoved: 0,
  });
});
it("uses fresh DB time after a real owner-row lock crossing proof expiry", async () => {
  const i = await input();
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let locked!: () => void;
  const acquired = new Promise<void>((r) => {
    locked = r;
  });
  let submitted!: () => void;
  const boundary = new Promise<void>((r) => {
    submitted = r;
  });
  type Tx = Parameters<Parameters<typeof database.db.transaction>[0]>[0];
  const dialect = new PgDialect();
  const db = new Proxy(database.db, {
    get(target, key) {
      if (key === "transaction")
        return <T>(work: (tx: Tx) => Promise<T>) =>
          target.transaction((tx) =>
            work(
              new Proxy(tx, {
                get(t, k) {
                  if (k === "execute")
                    return (q: Parameters<Tx["execute"]>[0]) => {
                      const statement =
                        typeof q === "string"
                          ? q
                          : dialect.sqlToQuery(q.getSQL()).sql;
                      const result = t.execute(q);
                      if (statement.includes("select id from users"))
                        submitted();
                      return result;
                    };
                  const v = Reflect.get(t, k);
                  return typeof v === "function" ? v.bind(t) : v;
                },
              }),
            ),
          );
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const blocker = database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from users where id=${i.userId}::uuid for update`,
    );
    locked();
    await held;
  });
  const blockerObserved = blocker.catch((error) => {
    throw error;
  });
  await acquired;
  let issuance: Promise<unknown> | undefined;
  try {
    const now = (
      await database.db.execute<{ expires: string }>(
        sql`select clock_timestamp()+interval '400 milliseconds' expires`,
      )
    ).rows[0]!.expires;
    i.proofExpiresAt = new Date(now);
    issuance = new PostgresExpertSessionRepository(db, "expert-bot").issue(i);
    const observed = issuance.catch((error) => error);
    await boundary;
    await database.db.execute(
      sql`select pg_sleep(greatest(0,extract(epoch from (${i.proofExpiresAt}::timestamptz-clock_timestamp())))+0.02)`,
    );
    release();
    await blockerObserved;
    expect(await observed).toEqual({ kind: "denied" });
    expect(
      (
        await database.db.execute(
          sql`select (select count(*)::int from expert_sessions) sessions,(select count(*)::int from expert_identity_proof_receipts) receipts`,
        )
      ).rows,
    ).toEqual([{ sessions: 0, receipts: 0 }]);
  } finally {
    release();
    await blockerObserved;
    await issuance?.catch(() => undefined);
  }
});
it("normal worker factory runs bounded retention, propagates failure and stays disabled without its flag", async () => {
  const i = await input();
  expect((await repo().issue(i)).kind).toBe("issued");
  await database.db.execute(
    sql`update expert_identity_proof_receipts set created_at=statement_timestamp()-interval '2 minutes',expires_at=statement_timestamp()-interval '1 minute'`,
  );
  await database.db.execute(
    sql`update expert_sessions set created_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour'`,
  );
  const base = {
    DATABASE_URL: database.db.$client.options.connectionString!,
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  };
  const config = loadEnv({
    ...base,
    EXPERT_SESSION_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: `123456:${"x".repeat(35)}`,
    EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
    EXPERT_WEB_ORIGIN: "https://expert.example",
    EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
  });
  const cleanup = vi.spyOn(
    ComposedSessionRepository.prototype,
    "cleanupExpired",
  );
  const runtime = await createProductionWorkerRuntimeFactory().create(config);
  try {
    expect((await runtime.runOnce()).processorPrivacy).toMatchObject({
      expertSession: { sessionsRemoved: 1, receiptsRemoved: 1 },
    });
    expect(cleanup).toHaveBeenCalledWith(100);
    cleanup.mockRejectedValueOnce(new Error("synthetic_cleanup_failure"));
    await expect(runtime.runOnce()).rejects.toThrow(
      "synthetic_cleanup_failure",
    );
  } finally {
    await runtime.close();
    cleanup.mockRestore();
  }
  const disabled = await createProductionWorkerRuntimeFactory().create(
    loadEnv(base),
  );
  const absent = vi.spyOn(
    ComposedSessionRepository.prototype,
    "cleanupExpired",
  );
  try {
    await disabled.runOnce();
    expect(absent).not.toHaveBeenCalled();
  } finally {
    await disabled.close();
    absent.mockRestore();
  }
});
