import Fastify from "fastify";
import { expect, it } from "vitest";
import { browserAccountRoutes } from "./browser-account.js";

const tokenA = `cs1.${"A".repeat(43)}`;
const tokenB = `cs1.${"B".repeat(43)}`;
async function fixture() {
  const app = Fastify();
  const forwarded: string[] = [];
  for (const suffix of ["consents", "export"]) {
    app.get(`/v1/client/privacy/${suffix}`, async (request) => {
      const account =
        request.headers.authorization === `Bearer ${tokenA}` ? "A" : "B";
      forwarded.push(account);
      return { account, private: `private-${account}` };
    });
  }
  await app.register(browserAccountRoutes, {
    origin: "https://synthetic.test",
    botUsername: "synthetic_bot",
    widgetEnabled: false,
    privacyEnabled: true,
    sessions: {
      issue: async () => ({ kind: "unavailable" }),
      revoke: async () => ({ kind: "revoked" }),
    },
    principals: {
      resolve: async (authorization) =>
        [tokenA, tokenB].some((token) => authorization === `Bearer ${token}`)
          ? {
              kind: "resolved",
              principal: {
                authenticated: true,
                active: true,
                userId:
                  authorization === `Bearer ${tokenA}`
                    ? "00000000-0000-4000-8000-000000000001"
                    : "00000000-0000-4000-8000-000000000002",
              },
            }
          : { kind: "denied" },
    },
  });
  async function probe(token: string) {
    const sessionCookie = `__Host-client-session=${token}`;
    const response = await app.inject({
      url: "/v1/browser/session",
      headers: { cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().authenticated).toBe(true);
    return {
      cookie: [
        sessionCookie,
        ...response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`),
      ].join("; "),
      csrf: response.json().csrfToken as string,
    };
  }
  return { app, forwarded, probe };
}

it.each(["consents", "export"])(
  "binds %s reads to the known session, not whichever cookie another tab last installed",
  async (suffix) => {
    const { app, forwarded, probe } = await fixture();
    try {
      const a = await probe(tokenA),
        b = await probe(tokenB);
      const url = `/v1/browser/privacy/${suffix}`;
      const ownA = await app.inject({
        url,
        headers: { cookie: a.cookie, "x-csrf-token": a.csrf },
      });
      expect(ownA.statusCode).toBe(200);
      expect(ownA.json().account).toBe("A");
      const switched = await app.inject({
        url,
        headers: { cookie: b.cookie, "x-csrf-token": a.csrf },
      });
      expect(switched.statusCode).toBe(403);
      expect(switched.payload).not.toContain("private-B");
      expect(forwarded).toEqual(["A"]);
      expect(
        (
          await app.inject({
            method: "HEAD",
            url,
            headers: { cookie: b.cookie, "x-csrf-token": a.csrf },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ url, headers: { cookie: b.cookie } })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url,
            headers: { cookie: b.cookie, "x-csrf-token": [b.csrf, b.csrf] },
          })
        ).statusCode,
      ).toBe(403);
      const ownB = await app.inject({
        url,
        headers: { cookie: b.cookie, "x-csrf-token": b.csrf },
      });
      expect(ownB.statusCode).toBe(200);
      expect(ownB.json().account).toBe("B");
      expect(forwarded).toEqual(["A", "B"]);
    } finally {
      await app.close();
    }
  },
);

it("keeps the session probe public and returns anonymous 401 before private-read binding checks", async () => {
  const { app, forwarded } = await fixture();
  try {
    const probe = await app.inject({ url: "/v1/browser/session" });
    expect(probe.statusCode).toBe(200);
    expect(probe.json().authenticated).toBe(false);
    for (const suffix of ["consents", "export"])
      for (const headers of [{}, { "x-csrf-token": "invalid" }])
        expect(
          (await app.inject({ url: `/v1/browser/privacy/${suffix}`, headers }))
            .statusCode,
        ).toBe(401);
    expect(forwarded).toEqual([]);
  } finally {
    await app.close();
  }
});
