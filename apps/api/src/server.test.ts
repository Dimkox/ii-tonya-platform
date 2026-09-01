import { afterEach, describe, expect, it } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createLogger } from "@ii-tonya/observability";
import { createWindowedRateLimiter } from "./rate-limit.js";
import {
  closeServer,
  composeServer,
  createDefaultLifecycle,
  listenServer,
  type ServerLifecycle,
} from "./server.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});
const disabled = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error("disabled");
    },
  },
);

describe("server composition", () => {
  it("migrates before dependency readiness and closes app before database/telemetry lifecycle", async () => {
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    const order: string[] = [];
    const lifecycle: ServerLifecycle = {
      async migrate() {
        order.push("migrate");
      },
      async dependencies(config) {
        order.push("dependencies");
        expect(order).toEqual(["migrate", "dependencies"]);
        return {
          config,
          conversationService: disabled as never,
          bookingService: disabled as never,
          catalogService: disabled as never,
          privacyService: disabled as never,
          adminService: disabled as never,
          selarti: disabled as never,
          telegramCallbacks: disabled as never,
          readiness: {
            check: async () => ({
              postgres: true,
              migrations: true,
              workerLease: true,
              adapters: true,
            }),
          },
          logger: createLogger(),
          inbox: disabled as never,
          rateLimiter: createWindowedRateLimiter(),
          telegramWebhookSecret: "ephemeral-test-placeholder",
        };
      },
      async close() {
        order.push("lifecycle-close");
      },
    };
    const app = await composeServer(lifecycle, {} as DrizzleDb);
    app.addHook("onClose", () => {
      order.push("app-close");
    });
    expect(
      (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    ).toBe(200);
    await closeServer(app, lifecycle, {} as DrizzleDb);
    expect(order).toEqual([
      "migrate",
      "dependencies",
      "app-close",
      "lifecycle-close",
    ]);
  });

  it("constructs the runnable default with PostgreSQL inbox and disabled providers without network calls", async () => {
    const lifecycle = createDefaultLifecycle();
    const fakeDb = {
      execute: async () => ({ rows: [{ present: true, fresh: true }] }),
      $client: { end: async () => undefined },
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
      features: {
        expertReferral: false,
        expertResidencyBilling: false,
      },
      expertReferralKeys: null,
    };
    const dependencies = await lifecycle.dependencies(config, fakeDb);
    expect(dependencies.expertReferralAdminService).toBeDefined();
    await expect(
      dependencies.expertReferralAdminService!.issueBatch(
        {
          id: "00000000-0000-4000-8000-000000000941",
          sessionIdHash: "sha256:disabled-admin-session",
          roles: ["entitlement_admin"],
          mfaVerifiedAt: new Date("2026-08-03T00:00:00.000Z"),
        },
        {
          routeObjectId: "00000000-0000-4000-8000-000000000942",
          inviterExpertId: "00000000-0000-4000-8000-000000000942",
          count: 1,
          approvalId: "00000000-0000-4000-8000-000000000943",
          nonce: "nonce:disabled-admin-test",
        },
      ),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    const app = await (await import("./app.js")).buildApp(dependencies);
    expect(
      (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/webhooks/selarti",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
    await lifecycle.close(fakeDb);
  });

  it("does not query issued versions or resolve HMAC material while referral is disabled", async () => {
    let versionReads = 0;
    let secretReads = 0;
    const lifecycle = createDefaultLifecycle({
      activeIssuedCodeKeyVersions: async () => {
        versionReads += 1;
        throw new Error("disabled startup queried issued versions");
      },
      expertCodeSecretResolver: {
        resolve() {
          secretReads += 1;
          throw new Error("disabled startup resolved secret material");
        },
      },
    });
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
      features: {
        expertReferral: false,
        expertResidencyBilling: false,
      },
      expertReferralKeys: null,
    };
    const fakeDb = {
      execute: async () => ({ rows: [] }),
    } as unknown as DrizzleDb;

    await lifecycle.dependencies(config, fakeDb);
    expect(versionReads).toBe(0);
    expect(secretReads).toBe(0);
  });

  it("validates current and active issued-code keys during startup composition", async () => {
    const order: string[] = [];
    const lifecycle = createDefaultLifecycle({
      activeIssuedCodeKeyVersions: async () => {
        order.push("active-versions");
        return ["v1"];
      },
      expertCodeSecretResolver: {
        resolve(input) {
          order.push("resolve");
          expect(input).toEqual({
            currentVersion: "v2",
            reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
            requiredVersions: ["v1"],
          });
          return {
            currentVersion: "v2",
            versions: ["v2", "v1"],
            key: (version) => new Uint8Array(32).fill(version === "v2" ? 2 : 1),
          };
        },
      },
    });
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
      features: {
        expertReferral: true,
        expertResidencyBilling: false,
      },
      expertReferralKeys: {
        currentVersion: "v2",
        reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      },
    };
    const fakeDb = {
      execute: async () => ({ rows: [] }),
    } as unknown as DrizzleDb;

    await lifecycle.dependencies(config, fakeDb);
    expect(order).toEqual(["active-versions", "resolve"]);
  });

  it("fails startup before dependencies are returned when key resolution is unavailable", async () => {
    const lifecycle = createDefaultLifecycle({
      activeIssuedCodeKeyVersions: async () => ["v3"],
      expertCodeSecretResolver: {
        resolve() {
          throw new Error("expert_referral_key_unavailable");
        },
      },
    });
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
      features: {
        expertReferral: true,
        expertResidencyBilling: false,
      },
      expertReferralKeys: {
        currentVersion: "v2",
        reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      },
    };

    await expect(
      lifecycle.dependencies(config, {} as DrizzleDb),
    ).rejects.toThrow("expert_referral_key_unavailable");
  });

  it("closes Fastify then telemetry/database exactly once when listen fails", async () => {
    process.env.DATABASE_URL =
      "postgresql://placeholder.invalid/test?sslmode=require";
    const order: string[] = [];
    const lifecycle: ServerLifecycle = {
      async migrate() {},
      async dependencies(config) {
        return {
          config,
          conversationService: disabled as never,
          bookingService: disabled as never,
          catalogService: disabled as never,
          privacyService: disabled as never,
          adminService: disabled as never,
          selarti: disabled as never,
          telegramCallbacks: disabled as never,
          readiness: {
            check: async () => ({
              postgres: true,
              migrations: true,
              workerLease: true,
              adapters: true,
            }),
          },
          logger: createLogger(),
          inbox: disabled as never,
          rateLimiter: createWindowedRateLimiter(),
          telegramWebhookSecret: "ephemeral-test-placeholder",
        };
      },
      async close() {
        order.push("lifecycle-close");
      },
    };
    const db = {} as DrizzleDb;
    const app = await composeServer(lifecycle, db);
    app.addHook("onClose", () => {
      order.push("app-close");
    });
    await expect(
      listenServer(
        app,
        lifecycle,
        db,
        { host: "127.0.0.1", port: 1 },
        async () => {
          throw new Error("EADDRINUSE");
        },
      ),
    ).rejects.toThrow("EADDRINUSE");
    expect(order).toEqual(["app-close", "lifecycle-close"]);
  });
});
