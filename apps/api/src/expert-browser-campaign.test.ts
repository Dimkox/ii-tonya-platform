import Fastify from "fastify";
import { request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import {
  createExpertCampaignService,
  createExpertReferralService,
  type SavedExpertCampaignQuote,
} from "@ii-tonya/application";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import { expertBrowserSessionRoutes } from "./routes/expert-browser-session.js";
import {
  createExpertSessionToken,
  expertSessionTokenHash,
} from "./expert-session-token.js";
import { createExpertBearerPrincipalResolver } from "./expert-principal-resolver.js";
import { createDefaultLifecycle } from "./server.js";
import { buildApp } from "./app.js";

const userId = "11111111-1111-4111-8111-111111111111";
const expertId = "22222222-2222-4222-8222-222222222222";
const tariffVersionId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
const origin = "https://expert.example";
const prefix = "/v1/expert/browser/residency/";
const quoteRequest = {
  tariffVersionId,
  termMonths: 3,
  idempotencyKey: "quote-command-001",
};
const checkoutRequest = { quoteId, idempotencyKey: "checkout-command-001" };
const tariff = {
  tariffVersionId,
  displayName: "Про",
  priceMinor: "100001",
  currency: "RUB" as const,
  durationSeconds: 2592000,
  commercialPolicyVersion: "expert_residency_v2" as const,
  creditCapBps: 3000,
  individualServicesEnabled: true,
  groupEventLimit: 5,
  statisticsLevel: "expanded" as const,
  supportPriority: "priority" as const,
};
const saved: SavedExpertCampaignQuote = {
  ...tariff,
  id: quoteId,
  userId,
  ruleVersion: "expert_energy_start_v1",
  termMonths: 3,
  calculationTimestamp: "2026-10-12T00:00:00.000Z",
  quotedAt: "2026-10-12T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  baseMonthlyMinor: "100001",
  discountedMonthlyMinor: "90001",
  monthlyPriceMinor: "80001",
  priceMinor: "240003",
  energyDiscountBps: 1000,
  startDiscountBps: 1000,
  floorApplied: false,
};
const apps: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(
  options: {
    provider?: boolean;
    capability?: "absent" | "legacy";
    composed?: boolean;
    billing?: boolean;
  } = {},
) {
  const accessToken = createExpertSessionToken();
  let record: { userId: string; expertId: string; expiresAt: Date } | null = {
    userId,
    expertId,
    expiresAt: new Date(Date.now() + 3600000),
  };
  const lookup = {
    findByTokenHash: vi.fn(async (hash: string) =>
      hash === expertSessionTokenHash(accessToken) ? record : null,
    ),
  };
  const sessions = {
    issue: async () => ({ kind: "unauthorized" as const }),
    revoke: async () => ({ kind: "revoked" as const }),
  };
  const createQuote = vi.fn(async () => saved);
  const createCheckoutOrder = vi.fn(async () => ({
    id: quoteId,
    cashMinor: "240003",
    currency: "RUB" as const,
    status: "payment_pending" as const,
  }));
  const ownerUserId = vi.fn(async () => userId);
  const listActiveTariffs = vi.fn(async () => [tariff]);
  const service = createExpertCampaignService({
    environmentEnabled: true,
    ownerUserId,
    listActiveTariffs,
    createQuote,
    createCheckoutOrder,
    ...(options.provider
      ? {
          checkoutProvider: {
            createCheckout: async () => ({
              kind: "created" as const,
              paymentId: "synthetic",
              checkoutUrl: "https://checkout.example/pay",
            }),
          },
        }
      : {}),
  });
  const principals = createExpertBearerPrincipalResolver({ sessions: lookup });
  const session = {
    sessions,
    lookup,
    principals,
    origin,
    botUsername: "expert_test_bot",
  };
  const campaign =
    options.capability === "legacy"
      ? { ...service, kind: "legacy" }
      : options.capability === "absent"
        ? undefined
        : service;
  let app;
  if (options.composed) {
    const deps = await createDefaultLifecycle().dependencies(
      loadEnv({
        DATABASE_URL: "postgresql://local:local@localhost/test",
        ALLOW_INSECURE_LOCAL_DATABASE: "true",
      }),
      { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb,
    );
    app = await buildApp({
      ...deps,
      config: {
        ...deps.config,
        features: {
          ...deps.config.features,
          expertSession: true,
          expertResidencyBilling: options.billing !== false,
        },
      },
      expertSession: session,
      expertApi: {
        principals,
        residency: service,
        referrals: createExpertReferralService({
          environmentEnabled: false,
          queries: {
            ownerUserId,
            summary: async () => ({
              availableMinor: "0",
              reservedMinor: "0",
              debtMinor: "0",
              nearestExpiry: null,
            }),
          },
          commands: { redeem: async () => ({ kind: "forbidden" }) },
        }),
      },
    });
  } else {
    app = Fastify();
    // Runtime legacy/absent capability must fail closed even for untyped callers.
    await app.register(expertBrowserSessionRoutes, {
      ...session,
      campaign,
    } as Parameters<typeof expertBrowserSessionRoutes>[1]);
  }
  apps.push(app);
  const first = await app.inject({
    url: "/v1/expert/browser/session",
    headers: { cookie: `__Host-expert-session=${accessToken}` },
  });
  const set = first.headers["set-cookie"];
  const cookie = [
    `__Host-expert-session=${accessToken}`,
    ...(Array.isArray(set) ? set : [set ?? ""]).map((v) => v.split(";")[0]),
  ].join("; ");
  const headers = {
    cookie,
    origin,
    "x-csrf-token": first.json().csrfToken as string,
    "content-type": "application/json",
  };
  return {
    app,
    headers,
    createQuote,
    createCheckoutOrder,
    ownerUserId,
    listActiveTariffs,
    lookup,
    expire: () => {
      record = null;
    },
    stale: () => {
      record = { userId, expertId, expiresAt: new Date(0) };
    },
  };
}
it("uses the current cookie principal for tariffs and exact saved quote/checkout commands", async () => {
  const t = await setup({ provider: true });
  const tariffs = await t.app.inject({
    url: prefix + "tariffs",
    headers: t.headers,
  });
  expect(tariffs.statusCode).toBe(200);
  expect(tariffs.json()[0]).toMatchObject({
    baseMonthlyMinor: "100001",
    priceKind: "base",
  });
  const quote = await t.app.inject({
    method: "POST",
    url: prefix + "quotes",
    headers: t.headers,
    payload: quoteRequest,
  });
  expect(quote.statusCode).toBe(200);
  expect(quote.json()).toEqual(saved);
  expect(t.createQuote).toHaveBeenCalledWith({ ...quoteRequest, userId });
  const checkout = await t.app.inject({
    method: "POST",
    url: prefix + "checkouts",
    headers: t.headers,
    payload: checkoutRequest,
  });
  expect(checkout.statusCode).toBe(200);
  expect(t.createCheckoutOrder).toHaveBeenCalledWith({
    ...checkoutRequest,
    userId,
    expertId,
  });
  expect(t.lookup.findByTokenHash).toHaveBeenCalledTimes(4);
  expect(checkout.headers["cache-control"]).toBe("no-store");
});
it.each(["absent", "legacy"] as const)(
  "rejects %s campaign capability explicitly",
  async (capability) => {
    const t = await setup({ capability });
    expect(
      (await t.app.inject({ url: prefix + "tariffs", headers: t.headers }))
        .statusCode,
    ).toBe(503);
    expect(t.listActiveTariffs).not.toHaveBeenCalled();
  },
);
it.each([true, false])(
  "ordinary buildApp forwards campaign only when billing enabled=%s",
  async (billing) => {
    const t = await setup({ composed: true, billing });
    expect(
      (await t.app.inject({ url: prefix + "tariffs", headers: t.headers }))
        .statusCode,
    ).toBe(billing ? 200 : 503);
  },
);
it("provider absence returns unavailable without order or reservation writes", async () => {
  const t = await setup();
  const r = await t.app.inject({
    method: "POST",
    url: prefix + "checkouts",
    headers: t.headers,
    payload: checkoutRequest,
  });
  expect(r.statusCode).toBe(503);
  expect(r.json()).toEqual({ error: "payment_unavailable" });
  expect(t.createCheckoutOrder).not.toHaveBeenCalled();
});
it.each(["expire", "stale"] as const)(
  "rechecks %s session before every mutation",
  async (action) => {
    const t = await setup();
    t[action]();
    expect(
      (
        await t.app.inject({
          method: "POST",
          url: prefix + "quotes",
          headers: t.headers,
          payload: quoteRequest,
        })
      ).statusCode,
    ).toBe(401);
    expect(t.createQuote).not.toHaveBeenCalled();
  },
);
it("owner reassignment denies the authenticated session", async () => {
  const t = await setup();
  t.ownerUserId.mockResolvedValue("another-owner");
  expect(
    (
      await t.app.inject({
        method: "POST",
        url: prefix + "quotes",
        headers: t.headers,
        payload: quoteRequest,
      })
    ).statusCode,
  ).toBe(403);
  expect(t.createQuote).not.toHaveBeenCalled();
});
it.each([
  { origin: "https://forged.example" },
  { "x-csrf-token": "f".repeat(64) },
  { authorization: "Bearer forged" },
  { cookie: "__Host-expert-session=bad; __Host-expert-session=bad" },
])("rejects forged browser authority %# before writes", async (forged) => {
  const t = await setup();
  const r = await t.app.inject({
    method: "POST",
    url: prefix + "quotes",
    headers: { ...t.headers, ...forged },
    payload: quoteRequest,
  });
  expect([400, 403]).toContain(r.statusCode);
  expect(t.createQuote).not.toHaveBeenCalled();
});
it.each([
  JSON.stringify({ ...quoteRequest, userId }),
  JSON.stringify({ ...quoteRequest, priceMinor: "1" }),
  JSON.stringify({ ...quoteRequest, expertId }),
  JSON.stringify({ ...quoteRequest, termMonths: 2 }),
  '{"tariffVersionId":"' +
    tariffVersionId +
    '","termMonths":1,"termMonths":3,"idempotencyKey":"quote-001"}',
  "{",
  "null",
  " ".repeat(8200),
])("rejects strict/bounded malformed campaign body %#", async (payload) => {
  const t = await setup();
  expect(
    (
      await t.app.inject({
        method: "POST",
        url: prefix + "quotes",
        headers: t.headers,
        payload,
      })
    ).statusCode,
  ).toBe(400);
  expect(t.createQuote).not.toHaveBeenCalled();
});
it("checkout refuses tariff/price authority alongside quote id", async () => {
  const t = await setup({ provider: true });
  expect(
    (
      await t.app.inject({
        method: "POST",
        url: prefix + "checkouts",
        headers: t.headers,
        payload: { ...checkoutRequest, tariffVersionId, priceMinor: "1" },
      })
    ).statusCode,
  ).toBe(400);
  expect(t.createCheckoutOrder).not.toHaveBeenCalled();
});

it.each(["origin", "cookie", "x-csrf-token", "authorization"])(
  "rejects duplicate raw %s header lines before service work",
  async (name) => {
    const t = await setup();
    const address = await t.app.listen({ host: "127.0.0.1", port: 0 });
    const body = JSON.stringify(quoteRequest);
    const value =
      name === "authorization"
        ? "Bearer forged"
        : t.headers[name as keyof typeof t.headers];
    const headers = Object.entries(t.headers)
      .filter(([key]) => key !== name)
      .flat();
    // light-my-request normalizes header arrays into one raw line. Use a real
    // loopback HTTP connection so rawHeaders contains two distinct field lines.
    headers.push(
      name,
      value,
      name,
      value,
      "content-length",
      String(Buffer.byteLength(body)),
      "host",
      new URL(address).host,
      "connection",
      "close",
    );
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        `${address}${prefix}quotes`,
        { method: "POST", headers },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      req.on("error", reject);
      req.setTimeout(3000, () => req.destroy(new Error("loopback_timeout")));
      req.end(body);
    });
    expect(status).toBe(400);
    expect(t.createQuote).not.toHaveBeenCalled();
    expect(t.ownerUserId).not.toHaveBeenCalled();
  },
);
it.each(["tariffs", "quotes", "checkouts"])(
  "session lookup rejection fails closed on %s",
  async (path) => {
    const t = await setup({ provider: true });
    t.lookup.findByTokenHash.mockRejectedValue(
      new Error("private repository diagnostic"),
    );
    const r = await t.app.inject({
      url: prefix + path,
      method: path === "tariffs" ? "GET" : "POST",
      headers: t.headers,
      ...(path === "tariffs"
        ? {}
        : { payload: path === "quotes" ? quoteRequest : checkoutRequest }),
    });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("private repository diagnostic");
    expect(t.ownerUserId).not.toHaveBeenCalled();
    expect(t.createQuote).not.toHaveBeenCalled();
    expect(t.createCheckoutOrder).not.toHaveBeenCalled();
  },
);
