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
const originalExpertKeys = process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalExpertKeys === undefined) delete process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
  else process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON = originalExpertKeys;
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
      features: { expertReferral: false, expertResidencyBilling: false },
    };
    const app = await (
      await import("./app.js")
    ).buildApp(await lifecycle.dependencies(config, fakeDb));
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

  it("fails before app composition when an enabled referral key version is unavailable", async () => {
    delete process.env.EXPERT_REFERRAL_HMAC_KEYS_JSON;
    const lifecycle = createDefaultLifecycle();
    const fakeDb = {
      execute: async () => ({ rows: [{ keyVersion: 2 }] }),
      $client: { end: async () => undefined },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
      integrations: { selarti: false, planerka: false, telegram: false, makeProjection: false, intentModel: false, payments: false },
      minorOnboarding: false,
      rawConversationLogging: false,
      selartiOutboundBillingMode: "disabled",
      displayTimezone: "Europe/Moscow",
      features: { expertReferral: true, expertResidencyBilling: false },
      expertReferralKey: { currentVersion: "v1", reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON" },
    };
    await expect(lifecycle.dependencies(config, fakeDb)).rejects.toThrow("expert_referral_key_unavailable");
  });

  it("passes the single startup-validated keyring into runtime dependencies", async () => {
    const keyring = {
      currentVersion: "v1",
      activeVersions: ["v1"],
      key: () => new Uint8Array(32),
    };
    const resolver = { resolve: () => keyring };
    const lifecycle = createDefaultLifecycle({ expertCodeSecretResolver: resolver });
    const fakeDb = {
      execute: async () => ({ rows: [] }),
      $client: { end: async () => undefined },
    } as unknown as DrizzleDb;
    const config: RuntimeConfig = {
      databaseUrl: "postgresql://placeholder.invalid/test",
      integrations: { selarti: false, planerka: false, telegram: false, makeProjection: false, intentModel: false, payments: false },
      minorOnboarding: false,
      rawConversationLogging: false,
      selartiOutboundBillingMode: "disabled",
      displayTimezone: "Europe/Moscow",
      features: { expertReferral: true, expertResidencyBilling: false },
      expertReferralKey: { currentVersion: "v1", reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON" },
    };
    const dependencies = await lifecycle.dependencies(config, fakeDb);
    expect(dependencies.expertCodeKeyring).toBe(keyring);
    expect(dependencies.expertReferralAdminService).toBeDefined();
    const app = await (await import("./app.js")).buildApp(dependencies);
    expect((app as unknown as { expertCodeKeyring: unknown }).expertCodeKeyring).toBe(keyring);
    await app.close();
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
