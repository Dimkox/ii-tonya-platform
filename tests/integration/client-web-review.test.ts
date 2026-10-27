import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { buildApp } from "../../apps/api/src/app.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { loadEnv } from "../../packages/config/src/env.js";
import { PostgresClientSessionRepository } from "../../packages/db/src/repositories/client-session-repository.js";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  await db.migrate();
}, 180_000);
beforeEach(async () => {
  await db.reset();
  await db.db.execute(sql`truncate consent_document_versions cascade`);
});
afterAll(async () => db?.stop(), 60_000);
const botToken = "123456789:" + "T".repeat(35);
const origin = "https://synthetic.test";
const repo = (presentationTtlMs = 60000) =>
  new PostgresConsentEvidenceRepository(db.db, {
    consentMutationCapability: { enabled: true },
    presentationTtlMs,
  });
const approve = (purpose = "client_profile") =>
  repo().approveDocumentVersion({
    documentKey: `consent.${purpose}`,
    title: "Synthetic only",
    body: '<img src=x onerror="window.executed=true"> Exact & text',
    approvedBy: "synthetic",
  });
const present = (userId: string, repository = repo()) =>
  repository.issuePresentation({
    userId,
    purpose: "client_profile",
    channel: "web",
    documentKey: "consent.client_profile",
  });
const decide = (
  userId: string,
  shown: { token: string; policyVersion: string },
) =>
  repo().recordDecision({
    userId,
    ...shown,
    purpose: "client_profile",
    decision: "granted",
    correlationId: "synthetic",
  });
const tokenDigest = `sha256:${"a".repeat(64)}` as const;
const issue = async (userId: string) =>
  new PostgresClientSessionRepository(db.db).issue({
    userId,
    tokenDigest,
    replayDigest: `hmac-sha256:v1:${"b".repeat(64)}`,
    proofExpiresAt: new Date(Date.now() + 60000),
    scope: "client_catalog:read",
    maximumTtlMs: 3_600_000,
  });
async function hold(query: SQL) {
  const acquired = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transaction = db.db.transaction(async (tx) => {
    await tx.execute(query);
    acquired.resolve();
    await release.promise;
  });
  await Promise.race([acquired.promise, transaction]);
  return async () => {
    release.resolve();
    await transaction;
  };
}
it("boots the default lifecycle with real HMAC and forwards real POST bodies to privacy persistence", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://localhost/synthetic",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    CLIENT_SESSION_ENABLED: "true",
    CLIENT_PRIVACY_ENABLED: "true",
    CLIENT_WEB_ORIGIN: origin,
    CLIENT_TELEGRAM_LOGIN_BOT_USERNAME: "synthetic_bot",
    TELEGRAM_BOT_TOKEN: botToken,
    CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
  });
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const app = await buildApp(await lifecycle.dependencies(config, db.db));
  const cookies = (r: { cookies: { name: string; value: string }[] }) =>
    r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    const proof = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42 }),
    });
    const canonical = [...proof]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    proof.set(
      "hash",
      createHmac(
        "sha256",
        createHmac("sha256", "WebAppData").update(botToken).digest(),
      )
        .update(canonical)
        .digest("hex"),
    );
    const login = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers: {
        origin,
        cookie: cookies(probe),
        "x-csrf-token": probe.json().csrfToken,
      },
      payload: { identityProof: `mini:${proof}` },
    });
    expect(login.statusCode).toBe(201);
    expect(login.json()).not.toHaveProperty("accessToken");
    const headers = {
      origin,
      cookie: cookies(login),
      "x-csrf-token": login.json().csrfToken,
    };
    await approve("client_messaging");
    const shown = await app.inject({
      method: "POST",
      url: "/v1/browser/privacy/presentations",
      headers,
      payload: {
        purpose: "client_messaging",
        channel: "web",
        documentKey: "consent.client_messaging",
      },
    });
    expect(shown.statusCode).toBe(201);
    expect(shown.json().policyVersion).toBe("messaging-v1");
    expect(
      (await db.db.execute(sql`select * from consents`)).rows,
    ).toHaveLength(0);
    const grant = await app.inject({
      method: "POST",
      url: "/v1/browser/privacy/decisions",
      headers,
      payload: {
        token: shown.json().token,
        policyVersion: shown.json().policyVersion,
        purpose: "client_messaging",
        decision: "granted",
      },
    });
    expect(grant.statusCode).toBe(201);
    expect(
      (await db.db.execute(sql`select policy_version from consents`)).rows,
    ).toEqual([{ policy_version: "messaging-v1" }]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/privacy/consents/withdraw",
          headers,
          payload: {
            purpose: "client_messaging",
            policyVersion: "messaging-v1",
          },
        })
      ).statusCode,
    ).toBe(204);
    await db.db.execute(sql`update users set active=false`);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/browser/session",
          headers,
        })
      ).statusCode,
    ).toBe(204);
    await db.db.execute(sql`update users set active=true`);
    expect(
      (
        await app.inject({
          url: "/v1/browser/privacy/consents",
          headers: { cookie: cookies(login) },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
it("revokes a session while its owner is inactive", async () => {
  const userId = await db.createUser();
  await issue(userId);
  await db.db.execute(
    sql`update users set active=false where id=${userId}::uuid`,
  );
  expect(
    await new PostgresClientSessionRepository(db.db).revoke(tokenDigest),
  ).toEqual({ kind: "revoked" });
  await db.db.execute(
    sql`update users set active=true where id=${userId}::uuid`,
  );
  expect(
    await new PostgresClientSessionRepository(db.db).resolve(tokenDigest),
  ).toEqual({ kind: "denied" });
});
it("bounds blocked issuance and revocation without orphan receipts or sessions", async () => {
  const userId = await db.createUser();
  let release = await hold(
    sql`select id from users where id=${userId}::uuid for update`,
  );
  let timer = setTimeout(() => void release(), 1800);
  try {
    await expect(issue(userId)).rejects.toThrow();
  } finally {
    clearTimeout(timer);
    await release();
  }
  expect(
    (await db.db.execute(sql`select * from client_sessions`)).rows,
  ).toHaveLength(0);
  expect(
    (await db.db.execute(sql`select * from client_identity_proof_receipts`))
      .rows,
  ).toHaveLength(0);
  await issue(userId);
  release = await hold(
    sql`select token_digest from client_sessions for update`,
  );
  timer = setTimeout(() => void release(), 1800);
  try {
    await expect(
      new PostgresClientSessionRepository(db.db).revoke(tokenDigest),
    ).rejects.toThrow();
  } finally {
    clearTimeout(timer);
    await release();
  }
});
it("rejects a presentation that expires while waiting for the consent lock", async () => {
  const userId = await db.createUser();
  await approve();
  const shown = await present(userId, repo(300));
  const release = await hold(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
  );
  const timer = setTimeout(() => void release(), 650);
  try {
    await expect(decide(userId, shown)).rejects.toMatchObject({
      code: "consent_presentation_invalid",
    });
  } finally {
    clearTimeout(timer);
    await release();
  }
});
it("bounds document publication lock waits", async () => {
  const userId = await db.createUser();
  await approve();
  const release = await hold(
    sql`lock table consent_document_versions in access exclusive mode`,
  );
  const timer = setTimeout(() => void release(), 1800);
  try {
    await expect(present(userId)).rejects.toThrow();
  } finally {
    clearTimeout(timer);
    await release();
  }
});
it("allows an explicit newer-version grant without withdrawing the old one", async () => {
  const userId = await db.createUser();
  await approve();
  await decide(userId, await present(userId));
  await approve();
  const next = await present(userId);
  expect(next.policyVersion).toBe("profile-v2");
  await decide(userId, next);
  expect(
    (
      await db.db.execute(
        sql`select policy_version,decision from consents order by created_at`,
      )
    ).rows,
  ).toEqual([
    { policy_version: "profile-v1", decision: "granted" },
    { policy_version: "profile-v2", decision: "granted" },
  ]);
});
it("rejects arbitrary or out-of-date configured policy labels instead of authorizing them", async () => {
  const userId = await db.createUser();
  await approve("client_messaging");
  for (const policy of [
    "arbitrary-v1",
    "messaging-v2",
    "client-messaging-v2",
  ]) {
    const repository = new PostgresConsentEvidenceRepository(db.db, {
      consentMutationCapability: { enabled: true },
      requiredPolicyVersions: { client_messaging: policy },
    });
    await expect(
      repository.issuePresentation({
        userId,
        purpose: "client_messaging",
        channel: "web",
        documentKey: "consent.client_messaging",
      }),
    ).rejects.toMatchObject({ code: "consent_document_version_missing" });
  }
  expect(
    (await db.db.execute(sql`select * from consent_presentations`)).rows,
  ).toHaveLength(0);
});
it("bounds the advisory lock for withdrawal too", async () => {
  const userId = await db.createUser();
  await approve();
  await decide(userId, await present(userId));
  const release = await hold(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
  );
  const timer = setTimeout(() => void release(), 1800);
  try {
    await expect(
      new PostgresPrivacyRepository(db.db, {
        privacyMutationCapability: { enabled: true },
      }).withdrawConsentAtomically({
        targetUserId: userId,
        purpose: "client_profile",
        policyVersion: "profile-v1",
        correlationId: "synthetic",
      }),
    ).rejects.toThrow();
  } finally {
    clearTimeout(timer);
    await release();
  }
});
