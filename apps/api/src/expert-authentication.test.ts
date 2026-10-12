import { createHash, createHmac } from "node:crypto";
import Fastify from "fastify";
import { expertBrowserSessionRoutes } from "./routes/expert-browser-session.js";
import { expertSessionRoutes } from "./routes/expert-sessions.js";
import { runExpertSessionRetention } from "../../../packages/worker/src/data-retention.js";
import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import { createDefaultLifecycle } from "./server.js";
import { buildApp } from "./app.js";
import { createTelegramExpertProofVerifier } from "./telegram-expert-proof.js";
import {
  createExpertSessionToken,
  parseExpertBearer,
} from "./expert-session-token.js";
const botToken = `123456:${"x".repeat(35)}`;
const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  expertId: "22222222-2222-4222-8222-222222222222",
  channelIdentityId: "33333333-3333-4333-8333-333333333333",
  externalId: "123456789",
  botKey: "expert-bot",
  externalChatId: "123456789",
};
function signed(age = 0, extra = "") {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) + age),
    user: JSON.stringify({ id: 123456789, first_name: "Synthetic" }),
  });
  params.sort();
  const check = [...params].map(([k, v]) => `${k}=${v}`).join("\n");
  params.set(
    "hash",
    createHmac(
      "sha256",
      createHmac("sha256", "WebAppData").update(botToken).digest(),
    )
      .update(check)
      .digest("hex"),
  );
  return `mini:${params}${extra}`;
}
it("rejects resolver snapshot whose sender differs from the signed Telegram id", async () => {
  expect(
    await createTelegramExpertProofVerifier({
      botToken,
      resolveIdentity: async () => ({
        ...owner,
        externalId: "987654321",
        externalChatId: "987654321",
      }),
    }).verify({
      identityProof: signed(),
      expectedAudience: "ii-tonya-expert",
      expectedScope: "expert_session:create",
      signal: new AbortController().signal,
    }),
  ).toBeNull();
});
it("verifies signed Telegram proof into purpose-specific exact owner, not a client credential", async () => {
  const verifier = createTelegramExpertProofVerifier({
    botToken,
    resolveIdentity: async () => owner,
  });
  const result = await verifier.verify({
    identityProof: signed(),
    expectedAudience: "ii-tonya-expert",
    expectedScope: "expert_session:create",
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    ...owner,
    audience: "ii-tonya-expert",
    scope: "expert_session:create",
    replayDigest: expect.stringMatching(/^expert-login:v1:[a-f0-9]{64}$/u),
  });
});
it.each([
  () => signed(-301),
  () => signed(31),
  () => signed(0, "&auth_date=1"),
  () => signed() + "&unknown=1",
  () => signed().replace("Synthetic", "Tampered"),
  () => "cs1." + "a".repeat(43),
])(
  "denies malformed/expired/tampered/wrong-purpose proof %#",
  async (proof) => {
    const lookup = vi.fn(async () => owner);
    expect(
      await createTelegramExpertProofVerifier({
        botToken,
        resolveIdentity: lookup,
      }).verify({
        identityProof: proof(),
        expectedAudience: "ii-tonya-expert",
        expectedScope: "expert_session:create",
        signal: new AbortController().signal,
      }),
    ).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  },
);
it("expert tokens are canonical32bytes and reject client/admin/noncanonical credentials", () => {
  const token = createExpertSessionToken();
  expect(token).toMatch(/^es1\.[A-Za-z0-9_-]{43}$/u);
  expect(parseExpertBearer(`Bearer ${token}`)).toBe(token);
  for (const token of [
    "cs1." + "a".repeat(43),
    "admin-" + "a".repeat(40),
    "es1." + "a".repeat(43),
    "es1." + "a".repeat(42) + "B",
  ])
    expect(parseExpertBearer(`Bearer ${token}`)).toBeNull();
  expect(parseExpertBearer(`Bearer ${token}\n`)).toBeNull();
});
it("expert session flag defaults off and missing enabled credentials fail without secret leakage", () => {
  const base = {
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  };
  expect(loadEnv(base).features).toHaveProperty("expertSession", false);
  expect(() => loadEnv({ ...base, EXPERT_SESSION_ENABLED: "true" })).toThrow(
    "expert_session_configuration_required",
  );
});
it("ordinary disabled app exposes fail-closed browser session with no-store", async () => {
  const deps = await createDefaultLifecycle().dependencies(
    loadEnv({
      DATABASE_URL: "postgresql://local:local@localhost/test",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
    }),
    { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb,
  );
  const app = await buildApp(deps);
  try {
    const r = await app.inject({ url: "/v1/expert/browser/session" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ available: false, authenticated: false });
    expect(r.headers["cache-control"]).toBe("no-store");
  } finally {
    await app.close();
  }
});
it("widget proof requires explicit enablement and accepts a genuine signature only", async () => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    id: "123456789",
    first_name: "Synthetic",
  });
  params.sort();
  params.set(
    "hash",
    createHmac("sha256", createHash("sha256").update(botToken).digest())
      .update([...params].map(([k, v]) => `${k}=${v}`).join("\n"))
      .digest("hex"),
  );
  const input = {
    identityProof: `widget:${params}`,
    expectedAudience: "ii-tonya-expert" as const,
    expectedScope: "expert_session:create" as const,
    signal: new AbortController().signal,
  };
  expect(
    await createTelegramExpertProofVerifier({
      botToken,
      resolveIdentity: async () => owner,
    }).verify(input),
  ).toBeNull();
  expect(
    await createTelegramExpertProofVerifier({
      botToken,
      resolveIdentity: async () => owner,
      widgetEnabled: true,
    }).verify(input),
  ).toMatchObject(owner);
  const controller = new AbortController();
  controller.abort();
  const lookup = vi.fn(async () => owner);
  expect(
    await createTelegramExpertProofVerifier({
      botToken,
      resolveIdentity: lookup,
    }).verify({ ...input, signal: controller.signal }),
  ).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});
async function browserApp() {
  const app = Fastify();
  const accessToken = createExpertSessionToken();
  let active = false;
  const issue = vi.fn(async () => {
    active = true;
    return {
      kind: "issued" as const,
      accessToken,
      tokenType: "Bearer" as const,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  });
  const revoke = vi.fn(async () => {
    active = false;
    return { kind: "revoked" as const };
  });
  const lookup = {
    findByTokenHash: async () =>
      active
        ? {
            userId: owner.userId,
            expertId: owner.expertId,
            expiresAt: new Date(Date.now() + 3600000),
          }
        : null,
  };
  await app.register(expertBrowserSessionRoutes, {
    sessions: { issue, revoke },
    lookup,
    origin: "https://expert.example",
    botUsername: "expert_test_bot",
  });
  await app.register(expertSessionRoutes, {
    sessions: { issue, revoke },
    lookup,
  });
  return { app, issue, revoke, accessToken };
}
const cookieHeader = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : [value ?? ""])
    .map((v) => v.split(";")[0])
    .join("; ");
it("browser same-origin CSRF login/logout uses separate HttpOnly cookies and never returns a bearer", async () => {
  const { app, issue, revoke, accessToken } = await browserApp();
  try {
    const first = await app.inject({ url: "/v1/expert/browser/session" });
    const preCookie = cookieHeader(first.headers["set-cookie"]);
    expect(preCookie).toContain("__Host-expert-csrf=");
    const login = await app.inject({
      method: "POST",
      url: "/v1/expert/browser/session",
      headers: {
        origin: "https://expert.example",
        cookie: preCookie,
        "x-csrf-token": first.json().csrfToken,
      },
      payload: { identityProof: "mini:" + "synthetic".repeat(5) },
    });
    expect(login.statusCode).toBe(201);
    expect(login.body).not.toContain(accessToken);
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(issue).toHaveBeenCalledTimes(1);
    const set = login.headers["set-cookie"] as string[];
    for (const c of set) {
      expect(c).toContain("Secure; HttpOnly; SameSite=Strict");
      expect(c).toContain("Path=/");
    }
    const current = await app.inject({
      url: "/v1/expert/browser/session",
      headers: { cookie: cookieHeader(set) },
    });
    expect(current.json()).toMatchObject({
      authenticated: true,
      userId: owner.userId,
      expertId: owner.expertId,
    });
    expect(current.body).not.toContain(accessToken);
    const out = await app.inject({
      method: "DELETE",
      url: "/v1/expert/browser/session",
      headers: {
        origin: "https://expert.example",
        cookie: cookieHeader(set),
        "x-csrf-token": login.json().csrfToken,
      },
    });
    expect(out.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
it.each([
  "cross_origin",
  "missing_origin",
  "wrong_csrf",
  "duplicate_cookie",
  "authorization",
])("browser rejects %s before issuing", async (kind) => {
  const { app, issue } = await browserApp();
  try {
    const first = await app.inject({ url: "/v1/expert/browser/session" });
    const headers: Record<string, string> = {
      origin: "https://expert.example",
      cookie: cookieHeader(first.headers["set-cookie"]),
      "x-csrf-token": first.json().csrfToken,
    };
    if (kind === "cross_origin") headers.origin = "https://attacker.example";
    if (kind === "missing_origin") delete headers.origin;
    if (kind === "wrong_csrf") headers["x-csrf-token"] = "a".repeat(64);
    if (kind === "duplicate_cookie") headers.cookie += `; ${headers.cookie}`;
    if (kind === "authorization") headers.authorization = "Bearer client";
    const result = await app.inject({
      method: "POST",
      url: "/v1/expert/browser/session",
      headers,
      payload: { identityProof: "mini:synthetic" },
    });
    expect(result.statusCode).toBe(
      kind === "duplicate_cookie" || kind === "authorization" ? 400 : 403,
    );
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(issue).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it.each([
  '{"identityProof":"mini:x","expertId":"caller"}',
  '{"identityProof":"mini:x","identityProof":"mini:y"}',
  "{",
  '{"identityProof":1}',
])("rejects non-exact expert login body %#", async (payload) => {
  const { app, issue } = await browserApp();
  try {
    const r = await app.inject({
      method: "POST",
      url: "/v1/expert/sessions",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(r.statusCode).toBe(400);
    expect(issue).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it("enabled ordinary lifecycle rejects missing DB capability", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_SESSION_ENABLED: "true",
    EXPERT_TELEGRAM_BOT_TOKEN: botToken,
    EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
    EXPERT_WEB_ORIGIN: "https://expert.example",
    EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
  });
  await expect(
    createDefaultLifecycle().dependencies(config, {
      execute: async () => ({ rows: [] }),
    } as unknown as DrizzleDb),
  ).rejects.toThrow("expert_session_capability_unavailable");
});
it("bounded retention preserves repository failures and rejects invalid reports", async () => {
  const cleanupExpired = vi.fn(async () => ({
    sessionsRemoved: 1,
    receiptsRemoved: 1,
  }));
  expect(
    await runExpertSessionRetention({ repository: { cleanupExpired } }, 100),
  ).toEqual({ sessionsRemoved: 1, receiptsRemoved: 1 });
  expect(cleanupExpired).toHaveBeenCalledWith(100);
  cleanupExpired.mockRejectedValueOnce(new Error("failed"));
  await expect(
    runExpertSessionRetention({ repository: { cleanupExpired } }, 100),
  ).rejects.toThrow("failed");
  cleanupExpired.mockResolvedValueOnce({
    sessionsRemoved: 101,
    receiptsRemoved: 0,
  });
  await expect(
    runExpertSessionRetention({ repository: { cleanupExpired } }, 100),
  ).rejects.toThrow("expert_session_retention_unavailable");
});
