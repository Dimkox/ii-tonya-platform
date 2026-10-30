import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadEarlyBirdGatewayBootstrap } from "./early-bird-gateway-bootstrap.js";
import { loadEnv } from "@ii-tonya/config";
import Fastify from "fastify";
import type { RuntimeConfig } from "@ii-tonya/config";
import { createExpertVerificationComposition } from "./expert-verification-composition.js";
import { yookassaWebhookRoutes } from "./routes/yookassa-webhook.js";

const config = {
  features: {
    expertVerification: true,
    expertSeparatedSales: true,
    expertHeldOnboarding: true,
  },
  expertVerification: {
    paymentMode: "test",
    messagingConsentPolicyVersion: "policy-v1",
    checkoutEnabled: true,
    paymentVerificationEnabled: true,
  },
} as RuntimeConfig;
it("injects the public held checkout into the authenticated manager service", () => {
  const held = {
    strictFirstSendCancellation: true as const,
    createCheckout: async () => ({
      url: "https://yookassa.ru/checkout",
      paymentId: "held",
    }),
    recoverCheckout: async () => ({ kind: "pending" as const }),
    reconcile: async () => ({ kind: "pending" as const }),
    reconcileKnown: async () => ({ examined: 0 }),
  };
  const capability = createExpertVerificationComposition({} as never, config, {
    providerMode: "test",
    publicHeldCheckout: held,
  } as never);
  expect(capability?.heldCheckout).toBe(held);
});
it("refuses held checkout when neither strict public nor legacy capabilities exist", () => {
  expect(() =>
    createExpertVerificationComposition({} as never, config),
  ).toThrow("expert_verification_payment_capability_required");
});
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function bootstrapFixture() {
  const root = join(process.cwd(), ".getzilla/runtime/scratch");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(root, "public-api-"));
  dirs.push(dir);
  const write = (name: string, value: string) => {
    const file = join(dir, name);
    writeFileSync(file, value, { mode: 0o600 });
    return file;
  };
  const key = (name: string) =>
    write(name, randomBytes(32).toString("base64url"));
  const connection = (name: string) => ({
    login: name,
    urlFile: write(
      name,
      `postgresql://${name}:synthetic-only@localhost:1/fixture`,
    ),
  });
  const section = (prefix: string, names: string[]) =>
    Object.fromEntries(
      names.map((name) => [name, connection(prefix + name.toLowerCase())]),
    );
  const descriptor = {
    version: 1,
    ipc: {
      address: "@unused",
      subjectKeyFile: key("subject"),
      authKeyFile: key("auth"),
      subjectKeyVersion: "v1",
    },
    identityKeyFile: key("identity"),
    requestKeys: {
      activeReference: "public:v1",
      files: { "public:v1": key("request") },
    },
    receiptKeys: { activeKeyId: "receipt", files: { receipt: key("receipt") } },
    databases: section("wave_", [
      "sender",
      "standardSender",
      "candidateReader",
      "bindingWriter",
      "knownBindingReader",
    ]),
    webhookDatabases: section("webhook_", [
      "compositePaymentSettlement",
      "compositeRefundReader",
      "compositeRefundBinding",
      "compositeRefundSettlement",
      "deferredPaymentLookup",
      "deferredSnapshotReader",
      "deferredPaymentBinding",
      "deferredPaymentSettlement",
      "deferredRefundReader",
      "deferredRefundBinding",
      "deferredRefundSettlement",
      "deferredRefundCancel",
    ]),
    deferredDatabases: section("deferred_", [
      "prepare",
      "invoice",
      "send",
      "bound",
    ]),
    publicDatabases: section("public_", [
      "onboardingSender",
      "mainSender",
      "refundSender",
      "binder",
      "observations",
    ]),
  };
  const file = write("descriptor", JSON.stringify(descriptor));
  const settings = {
    ...config,
    databaseUrl: "postgresql://primary:synthetic-only@localhost:1/fixture",
    features: { ...config.features, expertApplicant: true },
    expertApplicant: {
      botId: "1",
      botKey: "fixture",
      messagingConsentPolicyVersion: "p",
    },
    expertVerification: { ...config.expertVerification!, paymentMode: "live" },
    launchPhase: {
      configuredPhase: "PUBLIC_LAUNCH",
      enrollmentStartMs: Date.parse("2026-11-01T00:00:00+03:00"),
      clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
      promoDeadlineDays: 10,
      finalCallTriggerMs: Date.parse("2026-12-28T10:00:00+03:00"),
      policyVersion: "wave1-2027-01-11-v1",
    },
    yookassaGateway: {
      publicExpertEnabled: true,
      mode: "live",
      shopId: "1",
      configurationFile: file,
      returnUrl: "https://ii-tonya.ru/return",
      receipt: {
        vatCode: 1,
        paymentSubject: "service",
        paymentMode: "full_payment",
      },
    },
  } as RuntimeConfig;
  return { descriptor, file, settings };
}
it.each(["WAVE_1_EARLY_BIRD", "PUBLIC_LAUNCH"] as const)(
  "constructs public ports in %s and closes all dedicated pools once",
  async (phase) => {
    const f = bootstrapFixture();
    f.settings.launchPhase = {
      ...f.settings.launchPhase!,
      configuredPhase: phase,
    };
    let created = 0,
      closed = 0;
    const logins: string[] = [];
    const bootstrap = loadEarlyBirdGatewayBootstrap(f.settings, ((
      url: string,
      settings: Record<string, unknown>,
    ) => {
      created++;
      logins.push(new URL(url).username);
      expect(settings.connectionTimeoutMillis).toBe(4000);
      return {
        $client: {
          end: async () => {
            closed++;
          },
        },
      };
    }) as never)!;
    try {
      const options = bootstrap.serverOptions({} as never);
      expect(
        options.expertVerificationPayments?.publicHeldCheckout
          .strictFirstSendCancellation,
      ).toBe(true);
      expect(options.expertCard?.mainCheckout).toBe(
        options.expertResidencyLifecycle?.mainCheckout,
      );
      expect(options.earlyBirdRuntime.sender.login).toBe("wave_sender");
      expect(logins.filter((name) => name.startsWith("public_"))).toHaveLength(
        5,
      );
      expect(new Set(logins).size).toBe(created);
    } finally {
      await bootstrap.close();
      await bootstrap.close();
    }
    expect(closed).toBe(created);
  },
);
it("rejects missing or shared public roles before allocating a pool", () => {
  const f = bootstrapFixture();
  delete f.descriptor.publicDatabases.binder;
  writeFileSync(f.file, JSON.stringify(f.descriptor));
  expect(() => loadEarlyBirdGatewayBootstrap(f.settings)).toThrow(
    "early_bird_gateway_bootstrap_configuration_invalid",
  );
});
it("public gateway is default off and refuses activation without the gateway provider", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost/test?sslmode=require",
    REDIS_URL: "redis://localhost:6379",
  };
  expect(loadEnv(base).yookassaGateway).toBeUndefined();
  expect(() =>
    loadEnv({ ...base, PUBLIC_EXPERT_GATEWAY_ENABLED: "true" }),
  ).toThrow();
});
it("never falls through to legacy settlement after a public candidate fails fresh verification", async () => {
  const app = Fastify();
  let legacy = 0,
    failed = 0;
  await yookassaWebhookRoutes(app, {
    effectivePeerAddress: () => "185.71.76.1",
    inbox: {
      claim: async () => ({ kind: "claimed", claimId: "claim" }),
      complete: async () => {},
      fail: async () => {
        failed++;
      },
    },
    publicPayment: { handle: async () => "pending" },
    resolvePurpose: async () => {
      legacy++;
      return "MAIN_SUBSCRIPTION";
    },
    verify: async () => {
      legacy++;
      return null;
    },
    deliver: async () => {},
    resolveSucceeded: async () => {},
  } as never);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/yookassa",
      payload: {
        type: "notification",
        event: "payment.succeeded",
        object: { id: "public-payment" },
      },
    });
    expect(response.statusCode).toBe(503);
    expect(legacy).toBe(0);
    expect(failed).toBe(1);
  } finally {
    await app.close();
  }
});
