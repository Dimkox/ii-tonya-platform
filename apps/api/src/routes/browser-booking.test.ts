import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { browserAccountRoutes } from "./browser-account.js";

const origin = "https://example.invalid";
const token = `cs1.${"A".repeat(43)}`;
const bk = `bk1.${"B".repeat(43)}`;
const id = "00000000-0000-4000-8000-000000000101";
const principal = { authenticated: true, active: true, userId: id } as const;
async function setup(grant = true, reserve = true) {
  const app = Fastify();
  const calls: string[] = [];
  for (const [method, path] of [
    ["GET", "bookings"],
    ["POST", "bookings"],
    ["DELETE", `bookings/${bk}`],
    ["POST", "catalog-requests"],
    ["GET", `catalog-requests/${id}`],
  ] as const) {
    app.route({
      method,
      url: `/v1/client/${path}`,
      handler: async (request) => {
        expect(request.headers.authorization).toBe(`Bearer ${token}`);
        calls.push(`${method} ${request.url}`);
        return { ok: true };
      },
    });
  }
  await app.register(browserAccountRoutes, {
    origin,
    botUsername: "test_bot",
    widgetEnabled: false,
    privacyEnabled: true,
    bookingEnabled: true,
    bookingReserveEnabled: reserve,
    catalogEnabled: true,
    principals: { resolve: async () => ({ kind: "resolved", principal }) },
    bookingPrincipals: {
      resolve: async () =>
        grant ? { kind: "resolved", principal } : { kind: "denied" },
    },
    sessions: {
      issue: async () => ({ kind: "unauthorized" }),
      revoke: async () => ({ kind: "revoked" }),
    },
  });
  const probe = await app.inject({
    url: "/v1/browser/session",
    headers: { cookie: `__Host-client-session=${token}` },
  });
  const cookie = [
    `__Host-client-session=${token}`,
    ...probe.cookies.map((c) => `${c.name}=${c.value}`),
  ].join("; ");
  return {
    app,
    calls,
    probe,
    headers: { origin, cookie, "x-csrf-token": probe.json().csrfToken },
  };
}
describe("finite browser booking bridge", () => {
  it("reports fresh grant and reserve capabilities", async () => {
    const { app, probe } = await setup(true, false);
    try {
      expect(probe.json()).toMatchObject({
        authenticated: true,
        bookingAvailable: true,
        bookingReserveAvailable: false,
      });
    } finally {
      await app.close();
    }
  });
  it("leaves catalogue usable without promoting a read-only session", async () => {
    const { app, probe, headers, calls } = await setup(false);
    try {
      expect(probe.json()).toMatchObject({
        authenticated: true,
        bookingAvailable: false,
        bookingReserveAvailable: false,
      });
      expect(
        (
          await app.inject({
            url: `/v1/browser/catalog-requests/${id}`,
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: "/v1/browser/bookings", headers })).statusCode,
      ).toBe(403);
      expect(calls).toEqual([`GET /v1/client/catalog-requests/${id}`]);
    } finally {
      await app.close();
    }
  });
  it("forwards only finite paths and retains read/cancel with reserve off", async () => {
    const { app, headers, calls } = await setup(true, false);
    try {
      for (const [method, path, code] of [
        ["GET", `bookings?after=${bk}`, 200],
        ["DELETE", `bookings/${bk}`, 200],
        ["POST", "bookings", 503],
      ] as const) {
        const response = await app.inject({
          method,
          url: `/v1/browser/${path}`,
          headers,
          ...(method === "POST"
            ? { payload: { choiceHandle: `ch1.${"C".repeat(43)}` } }
            : {}),
        });
        expect(response.statusCode).toBe(code);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      expect(calls).toEqual([
        `GET /v1/client/bookings?after=${bk}`,
        `DELETE /v1/client/bookings/${bk}`,
      ]);
    } finally {
      await app.close();
    }
  });
  it.each([
    ["foreign origin", { origin: "https://evil.invalid" }, 403],
    ["wrong CSRF", { "x-csrf-token": "0".repeat(64) }, 403],
    ["browser bearer", { authorization: `Bearer ${token}` }, 400],
    ["duplicate csrf", { "x-csrf-token": ["a", "b"] }, 403],
    [
      "duplicate cookie",
      {
        cookie: `__Host-client-session=${token}; __Host-client-session=${token}`,
      },
      400,
    ],
    [
      "changed account",
      { cookie: `__Host-client-session=cs1.${"D".repeat(43)}` },
      403,
    ],
  ] as const)("rejects %s before forwarding", async (_name, extra, code) => {
    const { app, headers, calls } = await setup();
    try {
      const response = await app.inject({
        url: "/v1/browser/bookings",
        headers: { ...headers, ...extra },
      });
      expect(response.statusCode).toBe(code);
      expect(calls).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it.each([
    `bookings?after=${bk}&after=${bk}`,
    "bookings?target=evil",
    `bookings/${bk.replace(".", "%2E")}`,
    `catalog-requests/${id}?after=${bk}`,
  ])("rejects path/query tricks %s", async (path) => {
    const { app, headers, calls } = await setup();
    try {
      const response = await app.inject({
        method: path.startsWith("bookings/") ? "DELETE" : "GET",
        url: `/v1/browser/${path}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(calls).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it("rejects DELETE bodies rather than silently dropping them", async () => {
    const { app, headers, calls } = await setup();
    try {
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/browser/bookings/${bk}`,
        headers,
        payload: { userId: id },
      });
      expect(response.statusCode).toBe(400);
      expect(calls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
