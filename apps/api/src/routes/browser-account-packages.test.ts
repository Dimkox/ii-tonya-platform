import Fastify from "fastify";
import { expect, it } from "vitest";
import { browserAccountRoutes } from "./browser-account.js";
import { buildApp } from "../app.js";
import { createDefaultLifecycle } from "../server.js";
import {
  PostgresClientAccountPackagesRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { RuntimeConfig } from "@ii-tonya/config";

const token = `cs1.${"A".repeat(43)}`;
const userId = "00000000-0000-4000-8000-000000000001";
const data = {
  asOf: "2026-10-10T10:00:00.000Z",
  totalRemainingUnits: "0",
  hasMore: false,
  packages: [],
};
async function fixture(mode = "ok") {
  const app = Fastify();
  const reads: string[] = [];
  let resolves = 0;
  let principalOutcome: "resolved" | "denied" | "unavailable" = "resolved";
  await app.register(browserAccountRoutes, {
    origin: "https://synthetic.test",
    botUsername: "synthetic_bot",
    widgetEnabled: false,
    privacyEnabled: false,
    sessions: {
      issue: async () => ({ kind: "unavailable" }),
      revoke: async () => ({ kind: "revoked" }),
    },
    principals: {
      resolve: async () => {
        resolves++;
        if (principalOutcome !== "resolved") return { kind: principalOutcome };
        return {
          kind: "resolved",
          principal: { authenticated: true, active: true, userId },
        };
      },
    },
    ...(mode === "absent"
      ? {}
      : {
          clientAccountPackages: {
            read: async (id: string) => {
              reads.push(id);
              if (mode === "failure")
                throw new Error("private-database-details");
              return data;
            },
          },
        }),
  });
  const probe = await app.inject({
    url: "/v1/browser/session",
    headers: { cookie: `__Host-client-session=${token}` },
  });
  const cookie = [
    `__Host-client-session=${token}`,
    ...probe.cookies.map((c) => `${c.name}=${c.value}`),
  ].join("; ");
  resolves = 0;
  return {
    app,
    reads,
    setPrincipalOutcome: (outcome: typeof principalOutcome) => {
      principalOutcome = outcome;
    },
    resolves: () => resolves,
    headers: { cookie, "x-csrf-token": probe.json().csrfToken as string },
  };
}
it("returns owner packages with one principal resolution and no-store", async () => {
  const f = await fixture();
  try {
    const response = await f.app.inject({
      url: "/v1/browser/packages",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(data);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(f.reads).toEqual([userId]);
    expect(f.resolves()).toBe(1);
  } finally {
    await f.app.close();
  }
});
it("serves authorized HEAD without a body and with no-store", async () => {
  const f = await fixture();
  try {
    const response = await f.app.inject({
      method: "HEAD",
      url: "/v1/browser/packages",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.payload).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(f.reads).toEqual([userId]);
    expect(f.resolves()).toBe(1);
  } finally {
    await f.app.close();
  }
});
it.each([
  ["denied", 401],
  ["unavailable", 503],
] as const)(
  "does not read packages for a %s principal",
  async (outcome, status) => {
    const f = await fixture();
    try {
      f.setPrincipalOutcome(outcome);
      const response = await f.app.inject({
        url: "/v1/browser/packages",
        headers: f.headers,
      });
      expect(response.statusCode).toBe(status);
      expect(f.reads).toEqual([]);
    } finally {
      await f.app.close();
    }
  },
);
it("composes the native reader through buildApp only when client sessions are enabled", async () => {
  let transactions = 0;
  const db = {
    transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      transactions++;
      return operation({
        execute: async () => ({ rows: [{ snapshot: data, corrupt: false }] }),
      });
    },
  } as unknown as DrizzleDb;
  const config: RuntimeConfig = {
    databaseUrl: "postgresql://placeholder.invalid/test",
    integrations: {
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    },
    minorOnboarding: false,
    rawConversationLogging: false,
    selartiOutboundBillingMode: "disabled",
    displayTimezone: "Europe/Moscow",
    yookassaRecovery: { enabled: false },
    clientWeb: {
      origin: "https://synthetic.test",
      botUsername: "synthetic_bot",
      widgetEnabled: false,
    },
    features: {
      workerOutboxDelivery: false,
      clientSession: true,
      clientCatalog: false,
      expertReferral: false,
      expertReferralMaturityWorker: false,
      expertResidencyBilling: false,
    },
  };
  const lifecycle = createDefaultLifecycle({
    clientSessionComposition: { verifier: { verify: async () => null } },
  });
  const deps = await lifecycle.dependencies(config, db);
  expect(deps.clientAccountPackages).toBeInstanceOf(
    PostgresClientAccountPackagesRepository,
  );
  const disabledConfig = {
    ...config,
    features: { ...config.features, clientSession: false },
  };
  expect(
    (await lifecycle.dependencies(disabledConfig, db)).clientAccountPackages,
  ).toBeUndefined();
  for (const enabled of [true, false]) {
    const app = await buildApp({
      ...deps,
      config: enabled ? config : disabledConfig,
      clientPrincipal: {
        resolve: async () => ({
          kind: "resolved",
          principal: { authenticated: true, active: true, userId },
        }),
      },
    });
    try {
      const before = transactions;
      const probe = await app.inject({
        url: "/v1/browser/session",
        headers: { cookie: `__Host-client-session=${token}` },
      });
      expect(probe.json().authenticated).toBe(enabled);
      const cookie = [
        `__Host-client-session=${token}`,
        ...probe.cookies.map((c) => `${c.name}=${c.value}`),
      ].join("; ");
      const response = await app.inject({
        url: "/v1/browser/packages",
        headers: {
          cookie,
          "x-csrf-token": probe.json().csrfToken ?? "0".repeat(64),
        },
      });
      expect(response.statusCode).toBe(enabled ? 200 : 503);
      if (enabled) expect(response.json()).toEqual(data);
      expect(transactions - before).toBe(enabled ? 1 : 0);
    } finally {
      await app.close();
    }
  }
});
it("denies anonymous, stale/missing/duplicate binding, selectors and cross-origin reads including HEAD", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.app.inject({ url: "/v1/browser/packages" })).statusCode,
    ).toBe(401);
    for (const method of ["GET", "HEAD"] as const) {
      for (const headers of [
        { cookie: f.headers.cookie },
        { ...f.headers, "x-csrf-token": "0".repeat(64) },
        {
          ...f.headers,
          "x-csrf-token": [
            f.headers["x-csrf-token"],
            f.headers["x-csrf-token"],
          ],
        },
        { ...f.headers, origin: "https://other.test" },
      ]) {
        expect(
          (await f.app.inject({ method, url: "/v1/browser/packages", headers }))
            .statusCode,
        ).toBe(403);
      }
    }
    expect(
      (
        await f.app.inject({
          url: `/v1/browser/packages?userId=${userId}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(f.reads).toEqual([]);
  } finally {
    await f.app.close();
  }
});
it.each(["absent", "failure"])(
  "fails closed when dependency is %s",
  async (mode) => {
    const f = await fixture(mode);
    try {
      const response = await f.app.inject({
        url: "/v1/browser/packages",
        headers: f.headers,
      });
      expect(response.statusCode).toBe(503);
      expect(response.payload).not.toContain("private-database");
    } finally {
      await f.app.close();
    }
  },
);
