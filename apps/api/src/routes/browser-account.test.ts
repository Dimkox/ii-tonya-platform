import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { browserAccountRoutes } from "./browser-account.js";
import { clientSessionTokenHash } from "../client-session-token.js";
const token = `cs1.${"A".repeat(43)}` as const;
const origin = "https://example.invalid";
async function setup(
  options: {
    issueError?: boolean;
    revokeError?: boolean;
    onIssue?: () => void;
  } = {},
) {
  const app = Fastify();
  let active = false;
  app.get("/v1/client/privacy/export", async (request) =>
    request.headers.authorization === `Bearer ${token}`
      ? { own: "data" }
      : { error: "denied" },
  );
  await app.register(browserAccountRoutes, {
    origin,
    botUsername: "synthetic_bot",
    widgetEnabled: false,
    privacyEnabled: true,
    sessions: {
      issue: async () => {
        options.onIssue?.();
        if (options.issueError) throw new Error("secret-proof-must-not-leak");
        active = true;
        return {
          kind: "issued",
          accessToken: token,
          tokenType: "Bearer",
          scope: "client_catalog:read",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        };
      },
      revoke: async (digest) => {
        if (options.revokeError) throw new Error("secret-proof-must-not-leak");
        if (digest !== clientSessionTokenHash(token)) return { kind: "denied" };
        active = false;
        return { kind: "revoked" };
      },
    },
    principals: {
      resolve: async (authorization) =>
        active && authorization === `Bearer ${token}`
          ? {
              kind: "resolved",
              principal: {
                userId: "00000000-0000-4000-8000-000000000001",
                active: true,
                authenticated: true,
              },
            }
          : { kind: "denied" },
    },
  });
  return app;
}
const cookies = (response: { cookies: { name: string; value: string }[] }) =>
  response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
it("uses secure host cookies, binds CSRF, exports and invalidates logout without exposing bearer", async () => {
  const app = await setup();
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    expect(probe.json()).toMatchObject({
      authenticated: false,
      available: true,
      widgetEnabled: false,
      erasureAvailable: false,
    });
    const login = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers: {
        origin,
        cookie: cookies(probe),
        "x-csrf-token": probe.json().csrfToken,
        "content-type": "application/json",
      },
      payload: { identityProof: "P".repeat(32) },
    });
    expect(login.statusCode).toBe(201);
    expect(login.payload).not.toContain(token);
    expect(String(login.headers["set-cookie"])).toMatch(/Secure/);
    expect(String(login.headers["set-cookie"])).toMatch(/HttpOnly/);
    expect(String(login.headers["set-cookie"])).toMatch(/SameSite=Strict/);
    expect(String(login.headers["set-cookie"])).not.toMatch(/Domain=/);
    const cookie = cookies(login);
    const own = await app.inject({
      url: "/v1/browser/privacy/export",
      headers: { cookie, "x-csrf-token": login.json().csrfToken },
    });
    expect(own.json()).toEqual({ own: "data" });
    expect(own.headers["content-disposition"]).toContain("attachment");
    const oldCsrf = await app.inject({
      method: "DELETE",
      url: "/v1/browser/session",
      headers: { origin, cookie, "x-csrf-token": probe.json().csrfToken },
    });
    expect(oldCsrf.statusCode).toBe(403);
    const logout = await app.inject({
      method: "DELETE",
      url: "/v1/browser/session",
      headers: { origin, cookie, "x-csrf-token": login.json().csrfToken },
    });
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          url: "/v1/browser/privacy/export",
          headers: { cookie, "x-csrf-token": login.json().csrfToken },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
it("rejects exact-Origin violations with otherwise valid login CSRF and cookie", async () => {
  const app = await setup();
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    const headers = {
      cookie: cookies(probe),
      "x-csrf-token": probe.json().csrfToken,
      "content-type": "application/json",
    };
    for (const candidate of [
      "https://evil.invalid",
      origin + "/",
      origin + ".evil.invalid",
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/browser/session",
            headers: { ...headers, origin: candidate },
            payload: { identityProof: "P".repeat(32) },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/session",
          headers: { ...headers, origin },
          payload: { identityProof: "P".repeat(32) },
        })
      ).statusCode,
    ).toBe(201);
  } finally {
    await app.close();
  }
});
it("does not issue another session when authenticated even if revocation would fail", async () => {
  const onIssue = vi.fn();
  const app = await setup({ revokeError: true, onIssue });
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    const login = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers: {
        origin,
        cookie: cookies(probe),
        "x-csrf-token": probe.json().csrfToken,
      },
      payload: { identityProof: "P".repeat(32) },
    });
    const again = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers: {
        origin,
        cookie: cookies(login),
        "x-csrf-token": login.json().csrfToken,
      },
      payload: { identityProof: "P".repeat(32) },
    });
    expect(again.statusCode).toBe(409);
    expect(again.headers["set-cookie"]).toBeUndefined();
    expect(onIssue).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
it("ignores unrelated duplicate cookies but rejects duplicate authentication cookies", async () => {
  const app = await setup();
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    const headers = {
      origin,
      cookie: cookies(probe) + "; theme=light; theme=dark",
      "x-csrf-token": probe.json().csrfToken,
    };
    const login = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers,
      payload: { identityProof: "P".repeat(32) },
    });
    expect(login.statusCode).toBe(201);
    const doubled = cookies(login) + `; __Host-client-session=${token}`;
    expect(
      (
        await app.inject({
          url: "/v1/browser/privacy/export",
          headers: { cookie: doubled },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it("sanitizes unexpected errors as unavailable while malformed bodies remain validation errors", async () => {
  const app = await setup({ issueError: true });
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    const headers = {
      origin,
      cookie: cookies(probe),
      "x-csrf-token": probe.json().csrfToken,
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/browser/session",
      headers,
      payload: { identityProof: "P".repeat(32) },
    });
    expect(response.statusCode).toBe(503);
    expect(response.payload).not.toContain("secret-proof");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/session",
          headers,
          payload: { unknown: true },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it("denies cross-origin/missing CSRF, anonymous private access and arbitrary proxy paths", async () => {
  const app = await setup();
  try {
    for (const method of ["POST", "DELETE"] as const) {
      expect(
        (
          await app.inject({
            method,
            url: "/v1/browser/session",
            headers: { origin: "https://evil.invalid" },
            ...(method === "POST"
              ? { payload: { identityProof: "P".repeat(32) } }
              : {}),
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (await app.inject({ url: "/v1/browser/privacy/export" })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/v1/browser/privacy/../../admin" })).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
