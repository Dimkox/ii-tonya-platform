import Fastify from "fastify";
import { expect, it } from "vitest";
import { browserAccountRoutes } from "./browser-account.js";
import { createErasureRequestService } from "../../../../packages/application/src/erasure-request-service.js";
const origin = "https://example.invalid";
const receiptToken = `er1.${"A".repeat(43)}`;
it("authenticates creation, requires confirmation, and replays the durable owner request", async () => {
  const app = Fastify();
  const owner = "11111111-1111-4111-8111-111111111111";
  const token = `cs1.${"A".repeat(43)}` as const;
  let digest: string | undefined;
  let active = true;
  const row = {
    id: "request",
    createdAt: "2026-10-09T00:00:00.000Z",
    jobId: null,
  };
  const service = createErasureRequestService({
    requestEnabled: true,
    repository: {
      accept: async (input) => {
        if (input.userId !== owner) return { kind: "denied" };
        if (digest && digest !== input.receiptDigest)
          return { kind: "conflict" };
        digest = input.receiptDigest;
        return { kind: "accepted", request: row };
      },
      findOwned: async (id) => (id === owner && digest ? row : null),
      findByReceiptDigest: async (value) => (value === digest ? row : null),
      getVerifiedJob: async () => {
        throw new Error("unexpected job");
      },
    },
  });
  await app.register(browserAccountRoutes, {
    origin,
    botUsername: "synthetic_bot",
    widgetEnabled: false,
    privacyEnabled: true,
    erasureRequestsEnabled: true,
    erasureRequests: service,
    principals: {
      resolve: async (auth) =>
        active && auth === `Bearer ${token}`
          ? {
              kind: "resolved",
              principal: { userId: owner, active: true, authenticated: true },
            }
          : { kind: "denied" },
    },
    sessions: {
      issue: async () => ({ kind: "unauthorized" }),
      revoke: async () => ({ kind: "denied" }),
    },
  });
  try {
    const probe = await app.inject({
      url: "/v1/browser/session",
      headers: { cookie: `__Host-client-session=${token}` },
    });
    expect(probe.json().erasureAvailable).toBe(true);
    const cookie =
      `__Host-client-session=${token}; ` +
      probe.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers = { origin, cookie, "x-csrf-token": probe.json().csrfToken };
    const post = (payload: unknown, h = headers) =>
      app.inject({
        method: "POST",
        url: "/v1/browser/privacy/erasure-requests",
        headers: h,
        payload: payload as Record<string, unknown>,
      });
    expect((await post({ receiptToken })).statusCode).toBe(400);
    expect((await post({ receiptToken, confirmed: false })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post(
          { receiptToken, confirmed: true },
          { ...headers, "x-csrf-token": "wrong" },
        )
      ).statusCode,
    ).toBe(403);
    const accepted = await post({ receiptToken, confirmed: true });
    expect(accepted.statusCode).toBe(202);
    expect((await post({ receiptToken, confirmed: true })).json()).toEqual(
      accepted.json(),
    );
    expect(
      (await post({ receiptToken: `er1.${"B".repeat(42)}A`, confirmed: true }))
        .statusCode,
    ).toBe(409);
    const owned = await app.inject({
      url: "/v1/browser/privacy/erasure-requests",
      headers,
    });
    expect(owned.json()).toEqual(accepted.json());
    active = false;
    const status = await app.inject({
      method: "POST",
      url: "/v1/browser/privacy/erasure-status",
      headers: { origin },
      payload: { receiptToken },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual(accepted.json());
    expect((await post({ receiptToken, confirmed: true })).statusCode).toBe(
      401,
    );
  } finally {
    await app.close();
  }
});
it("allows sessionless status only, keeps creation CSRF protected and bounds receipt bodies", async () => {
  const app = Fastify();
  const service = createErasureRequestService({
    repository: {
      accept: async () => ({ kind: "denied" }),
      findOwned: async () => null,
      findByReceiptDigest: async () => ({
        id: "request",
        createdAt: "2026-10-09T00:00:00.000Z",
        jobId: null,
      }),
      getVerifiedJob: async () => {
        throw new Error("must not run");
      },
    },
  });
  await app.register(browserAccountRoutes, {
    origin,
    widgetEnabled: false,
    privacyEnabled: false,
    erasureRequests: service,
  });
  try {
    const read = await app.inject({
      method: "POST",
      url: "/v1/browser/privacy/erasure-status",
      headers: { origin },
      payload: { receiptToken },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ stage: "awaiting_execution" });
    expect(read.payload).not.toContain(receiptToken);
    expect(read.headers["cache-control"]).toBe("no-store");
    for (const payload of [
      { receiptToken, userId: "foreign" },
      { receiptToken: "x".repeat(2049) },
      { receiptToken: receiptToken + "=" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/browser/privacy/erasure-status",
        headers: { origin },
        payload,
      });
      expect([400, 403]).toContain(response.statusCode);
      expect(response.payload).not.toContain(receiptToken);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/privacy/erasure-status",
          headers: { origin: "https://foreign.invalid" },
          payload: { receiptToken },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/browser/privacy/erasure-requests",
          headers: { origin },
          payload: { receiptToken, confirmed: true },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
