import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeServer,
  composeServer,
  createDefaultLifecycle,
} from "../../apps/api/src/server.js";
import type { IdentityProofVerifier } from "../../packages/application/src/index.js";
import { loadEnv } from "../../packages/config/src/env.js";
import {
  closeDb,
  createDb,
  type DrizzleDb,
} from "../../packages/db/src/index.js";
import { startExternalPostgresDatabase } from "../../packages/db/src/testkit/external-postgres.js";

// Covers the production composition in apps/api/src/server.ts. Every other e2e here
// builds the app through buildTestApp with services injected by the test, so nothing
// exercises createDefaultLifecycle itself - which is exactly where the deployed wiring
// lives. See #46.

const MANAGED_ENV_KEYS = [
  "DATABASE_URL",
  "ALLOW_INSECURE_LOCAL_DATABASE",
  "CLIENT_SESSION_ENABLED",
  "CLIENT_CATALOG_ENABLED",
] as const;

const DISABLED_SUFFIX = " is disabled";

let database: Awaited<ReturnType<typeof startExternalPostgresDatabase>>;
let db: DrizzleDb;
let poolClosed = false;
const savedEnv = new Map<string, string | undefined>();

const nullVerifier: IdentityProofVerifier = {
  async verify() {
    return null;
  },
};

const productionEnv = (extra: Record<string, string> = {}): void => {
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.DATABASE_URL = database.getConnectionUri();
  process.env.ALLOW_INSECURE_LOCAL_DATABASE = "true";
  for (const [key, value] of Object.entries(extra)) {
    process.env[key] = value;
  }
};

// A disabledService() proxy answers every property with an async throw, so probing a
// name that no real service can expose reveals only the proxies.
const disabledLabels = async (deps: object): Promise<string[]> => {
  const labels: string[] = [];
  for (const value of Object.values(deps)) {
    if (value === null || typeof value !== "object") {
      continue;
    }
    const probe = (value as Record<string, unknown>).__productionProbe;
    if (typeof probe !== "function") {
      continue;
    }
    try {
      await (probe as () => Promise<unknown>)();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.endsWith(DISABLED_SUFFIX)) {
        labels.push(message.slice(0, -DISABLED_SUFFIX.length));
      }
    }
  }
  return labels.sort();
};

beforeAll(async () => {
  const adminUrl = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      "II_TONYA_TEST_POSTGRES_ADMIN_URL is required by the Claw PostgreSQL profile",
    );
  }
  for (const key of MANAGED_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
  database = await startExternalPostgresDatabase(adminUrl);
  db = createDb(database.getConnectionUri());
}, 120_000);

afterAll(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  if (db !== undefined && !poolClosed) {
    await closeDb(db);
  }
  await database?.stop();
}, 120_000);

describe("production API composition", () => {
  it("boots through composeServer and serves real client routes, not stubs", async () => {
    productionEnv({
      CLIENT_SESSION_ENABLED: "true",
      CLIENT_CATALOG_ENABLED: "true",
    });
    const lifecycle = createDefaultLifecycle({
      clientSessionComposition: { verifier: nullVerifier },
    });
    const app = await composeServer(lifecycle, db);
    try {
      for (const url of ["/health/live", "/health/ready"]) {
        expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(
          200,
        );
      }
      for (const probe of [
        {
          method: "POST" as const,
          url: "/v1/client/sessions",
          payload: { identityProof: "proof-rejected-by-verifier" },
        },
        { method: "DELETE" as const, url: "/v1/client/sessions/current" },
        {
          method: "POST" as const,
          url: "/v1/client/catalog-requests",
          payload: {},
        },
      ]) {
        const response = await app.inject(probe);
        // 404 would mean the production lifecycle never registered the route;
        // a 5xx carrying "is disabled" would mean it registered a stub instead.
        expect(response.statusCode, probe.url).toBeLessThan(500);
        expect(response.statusCode, probe.url).not.toBe(404);
        expect(response.body, probe.url).not.toContain(
          DISABLED_SUFFIX.trimStart(),
        );
      }
    } finally {
      await closeServer(app, lifecycle, db);
      poolClosed = true;
    }
  }, 120_000);

  it("refuses to boot a client flag without its capability", async () => {
    productionEnv({
      CLIENT_SESSION_ENABLED: "true",
      CLIENT_CATALOG_ENABLED: "true",
    });
    await expect(composeServer(createDefaultLifecycle(), db)).rejects.toThrow(
      /client session/i,
    );
  });

  it("pins the legacy ingress services that are still proxies", async () => {
    productionEnv();
    const deps = await createDefaultLifecycle().dependencies(
      loadEnv(process.env),
      db,
    );
    // Pinned on purpose: while these stay proxies, no user-facing dialogue can run,
    // and a newly stubbed service fails here too. When one is wired for real, drop
    // it from this list in the same change and cover its route above. See #45.
    expect(await disabledLabels(deps)).toEqual([
      "booking ingress",
      "catalog ingress",
      "conversation ingress",
      "privacy ingress",
    ]);
  }, 30_000);
});
