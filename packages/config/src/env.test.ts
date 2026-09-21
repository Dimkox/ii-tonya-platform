import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const databaseUrl =
  "postgres://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya";
const localEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: databaseUrl,
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  ...overrides,
});

describe("loadEnv", () => {
  it("defaults dangerous integrations to disabled and rejects raw transcript logging", () => {
    const config = loadEnv(localEnv());

    expect(config.integrations).toEqual({
      selarti: false,
      planerka: false,
      telegram: false,
      makeProjection: false,
      intentModel: false,
      payments: false,
    });
    expect(config.minorOnboarding).toBe(false);
    expect(config.rawConversationLogging).toBe(false);
    expect(config.features).toEqual({
      workerOutboxDelivery: false,
      clientCatalog: false,
      clientSession: false,
      clientBooking: false,
      clientBookingReserve: false,
      clientFreeAccessV2: false,
      clientTelegramIngress: false,
      clientHybridRouting: false,
      clientPrivacy: false,
      telegramEgressConsentGate: false,
      selartiCostAdmission: false,
      selartiResponseIngress: false,
      b2TelegramDispatch: false,
      b2SensitiveRetention: false,
      testExpertPromo: false,
      testExpertDeterministicFlow: false,
      testExpertSelarti: false,
      testExpertReconciliation: false,
      expertReferral: false,
      expertReferralMaturityWorker: false,
      expertResidencyBilling: false,
      expertTelegramQueries: false,
      expertTelegramFinancialViews: false,
      expertAiIngress: false,
      expertTelegramReferral: false,
      expertTelegramCheckout: false,
      yookassa: false,
    });
    expect(config.features.selartiCostAdmission).toBe(false);
    expect(config.selartiOutboundBillingMode).toBe("disabled");
    expect(() =>
      loadEnv(localEnv({ RAW_CONVERSATION_LOGGING: "true" })),
    ).toThrow("Raw conversation logging is prohibited");
    expect(() => loadEnv(localEnv({ SELARTI_ENABLED: "true" }))).toThrow();
  });

  it("defaults test-expert reconciliation off and accepts only exact booleans", () => {
    expect(loadEnv(localEnv()).features.testExpertReconciliation).toBe(false);
    expect(
      loadEnv(localEnv({ TEST_EXPERT_RECONCILIATION_ENABLED: "true" })).features
        .testExpertReconciliation,
    ).toBe(true);
    expect(() =>
      loadEnv(localEnv({ TEST_EXPERT_RECONCILIATION_ENABLED: "TRUE" })),
    ).toThrow();
  });

  it("allows deterministic test-expert flow without Selarti and fails closed for incomplete residual activation", () => {
    const deterministic = loadEnv(
      localEnv({
        TEST_EXPERT_PROMO_ENABLED: "true",
        TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED: "true",
        CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
        CLIENT_TELEGRAM_BOT_KEY: "bot-client",
        CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
        TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret-value-0001",
      }),
    );
    expect(deterministic.features).toMatchObject({
      testExpertPromo: true,
      testExpertDeterministicFlow: true,
      testExpertSelarti: false,
    });
    expect(() =>
      loadEnv(
        localEnv({
          TEST_EXPERT_PROMO_ENABLED: "true",
          TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED: "true",
          TEST_EXPERT_SELARTI_ENABLED: "true",
          TEST_EXPERT_PROMPT_VERSION: "approved-v1",
          CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
          CLIENT_TELEGRAM_BOT_KEY: "bot-client",
          CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
          TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret-value-0001",
        }),
      ),
    ).toThrow("test_expert_residual_configuration_incomplete");
  });

  it("requires reconciliation and worker outbox capabilities for test-expert residual startup", () => {
    const residual = {
      TEST_EXPERT_PROMO_ENABLED: "true",
      TEST_EXPERT_DETERMINISTIC_FLOW_ENABLED: "true",
      TEST_EXPERT_SELARTI_ENABLED: "true",
      TEST_EXPERT_PROMPT_VERSION: "approved-v1",
      CLIENT_TELEGRAM_INGRESS_ENABLED: "true",
      CLIENT_TELEGRAM_BOT_KEY: "bot-client",
      CLIENT_MESSAGING_CONSENT_POLICY_VERSION: "messaging-v1",
      SELARTI_AI_CONSENT_POLICY_VERSION: "selarti-v1",
      TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret-value-0001",
      CLIENT_HYBRID_ROUTING_ENABLED: "true",
      SELARTI_COST_ADMISSION_ENABLED: "true",
      SELARTI_RESPONSE_INGRESS_ENABLED: "true",
      SELARTI_RESPONSE_SHARED_SECRET: "test-only-response-secret-value-0001",
      B2_TELEGRAM_DISPATCH_ENABLED: "true",
      B2_SENSITIVE_RETENTION_ENABLED: "true",
    } satisfies NodeJS.ProcessEnv;

    expect(() =>
      loadEnv(
        localEnv({ ...residual, WORKER_OUTBOX_DELIVERY_ENABLED: "true" }),
      ),
    ).toThrow("test_expert_residual_configuration_incomplete");
    expect(() =>
      loadEnv(
        localEnv({
          ...residual,
          TEST_EXPERT_RECONCILIATION_ENABLED: "true",
        }),
      ),
    ).toThrow("test_expert_residual_configuration_incomplete");
  });

  it("defaults worker outbox delivery off and accepts only exact booleans", () => {
    expect(loadEnv(localEnv()).features.workerOutboxDelivery).toBe(false);
    expect(
      loadEnv(localEnv({ WORKER_OUTBOX_DELIVERY_ENABLED: "false" })).features
        .workerOutboxDelivery,
    ).toBe(false);
    expect(
      loadEnv(localEnv({ WORKER_OUTBOX_DELIVERY_ENABLED: "true" })).features
        .workerOutboxDelivery,
    ).toBe(true);
    expect(() =>
      loadEnv(localEnv({ WORKER_OUTBOX_DELIVERY_ENABLED: "TRUE" })),
    ).toThrow();
    expect(() =>
      loadEnv(localEnv({ WORKER_OUTBOX_DELIVERY_ENABLED: "1" })),
    ).toThrow();
  });

  it("defaults client catalog off and accepts only exact booleans", () => {
    expect(loadEnv(localEnv()).features.clientCatalog).toBe(false);
    expect(
      loadEnv(localEnv({ CLIENT_CATALOG_ENABLED: "false" })).features
        .clientCatalog,
    ).toBe(false);
    expect(
      loadEnv(localEnv({ CLIENT_CATALOG_ENABLED: "true" })).features
        .clientCatalog,
    ).toBe(true);
    expect(() =>
      loadEnv(localEnv({ CLIENT_CATALOG_ENABLED: "TRUE" })),
    ).toThrow();
    expect(() => loadEnv(localEnv({ CLIENT_CATALOG_ENABLED: "1" }))).toThrow();
  });

  it("defaults client sessions off and accepts only exact booleans", () => {
    expect(loadEnv(localEnv()).features.clientSession).toBe(false);
    expect(
      loadEnv(localEnv({ CLIENT_SESSION_ENABLED: "true" })).features
        .clientSession,
    ).toBe(true);
    expect(() =>
      loadEnv(localEnv({ CLIENT_SESSION_ENABLED: "TRUE" })),
    ).toThrow();
    expect(() => loadEnv(localEnv({ CLIENT_SESSION_ENABLED: "1" }))).toThrow();
  });

  it("requires safe key metadata only when expert referrals are enabled", () => {
    const enabled = loadEnv(
      localEnv({
        EXPERT_REFERRAL_ENABLED: "true",
        EXPERT_REFERRAL_HMAC_KEY_VERSION: "v1",
        EXPERT_REFERRAL_HMAC_KEY_REF: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
        EXPERT_REFERRAL_HMAC_KEYS_JSON: '{"v1":"must-not-enter-config"}',
      }),
    );
    expect(enabled.features.expertReferral).toBe(true);
    expect(enabled.expertReferralKey).toEqual({
      currentVersion: "v1",
      reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
    });
    expect(JSON.stringify(enabled)).not.toContain("must-not-enter-config");
    expect(() =>
      loadEnv(localEnv({ EXPERT_REFERRAL_ENABLED: "true" })),
    ).toThrow("expert_referral_key_unavailable");
  });

  it("tolerates unrelated OS variables while rejecting every owned live flag", () => {
    expect(
      loadEnv(localEnv({ USERPROFILE: "C:\\Users\\Dmitry" })).databaseUrl,
    ).toBe(databaseUrl);
    expect(() =>
      loadEnv(localEnv({ MINOR_ONBOARDING_ENABLED: "true" })),
    ).toThrow();
    expect(() => loadEnv(localEnv({ PAYMENTS_ENABLED: "true" }))).toThrow();
  });

  it("defaults expert Telegram queries off and exposes only a capability flag", () => {
    expect(loadEnv(localEnv()).features.expertTelegramQueries).toBe(false);
    expect(
      loadEnv(localEnv({ EXPERT_TELEGRAM_QUERIES_ENABLED: "true" })).features
        .expertTelegramQueries,
    ).toBe(true);
  });

  it("validates the maturity worker flag instead of letting a typo mean off", () => {
    expect(loadEnv(localEnv()).features.expertReferralMaturityWorker).toBe(
      false,
    );
    expect(
      loadEnv(localEnv({ EXPERT_REFERRAL_MATURITY_WORKER_ENABLED: "true" }))
        .features.expertReferralMaturityWorker,
    ).toBe(true);
    for (const value of ["1", "TRUE", "yes", ""]) {
      expect(
        () =>
          loadEnv(localEnv({ EXPERT_REFERRAL_MATURITY_WORKER_ENABLED: value })),
        value,
      ).toThrow();
    }
  });

  it("defaults expert Telegram financial views off and exposes an independent flag", () => {
    expect(loadEnv(localEnv()).features.expertTelegramFinancialViews).toBe(
      false,
    );
    expect(
      loadEnv(localEnv({ EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED: "true" }))
        .features.expertTelegramFinancialViews,
    ).toBe(true);
  });

  it("keeps expert AI ingress off unless explicitly requested", () => {
    expect(loadEnv(localEnv()).features.expertAiIngress).toBe(false);
    expect(
      loadEnv(localEnv({ EXPERT_AI_INGRESS_ENABLED: "true" })).features
        .expertAiIngress,
    ).toBe(true);
  });

  it("defaults expert Telegram referral mutations off", () => {
    expect(loadEnv(localEnv()).features.expertTelegramReferral).toBe(false);
    expect(
      loadEnv(localEnv({ EXPERT_TELEGRAM_REFERRAL_ENABLED: "true" })).features
        .expertTelegramReferral,
    ).toBe(true);
  });

  it("defaults expert Telegram checkout readiness off", () => {
    expect(loadEnv(localEnv()).features.expertTelegramCheckout).toBe(false);
    expect(
      loadEnv(localEnv({ EXPERT_TELEGRAM_CHECKOUT_ENABLED: "true" })).features
        .expertTelegramCheckout,
    ).toBe(true);
  });

  it("accepts only the exact Postgres URL protocols", () => {
    expect(
      loadEnv(
        localEnv({
          DATABASE_URL: "postgres://user:password@localhost:5432/database",
        }),
      ).databaseUrl,
    ).toContain("postgres://");
    expect(
      loadEnv(
        localEnv({
          DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        }),
      ).databaseUrl,
    ).toContain("postgresql://");
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresx://user:password@localhost:5432/database",
      }),
    ).toThrow();
  });

  it("requires TLS for every non-local Postgres endpoint", () => {
    expect(
      loadEnv({
        DATABASE_URL:
          "postgresql://user:password@db.example.test:5432/database?sslmode=require",
      }).databaseUrl,
    ).toContain("sslmode=require");
    expect(() =>
      loadEnv({
        DATABASE_URL:
          "postgresql://user:password@db.example.test:5432/database",
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        DATABASE_URL:
          "postgresql://user:password@db.example.test:5432/database?sslmode=disable",
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgresql://user:password@postgres:5432/database",
      }),
    ).toThrow();
    expect(
      loadEnv(
        localEnv({
          DATABASE_URL: "postgresql://user:password@postgres:5432/database",
        }),
      ).databaseUrl,
    ).toContain("@postgres:");
    expect(() =>
      loadEnv({
        DATABASE_URL:
          "postgresql://user:password@db.example.test:5432/database?sslmode=require&sslmode=disable",
      }),
    ).toThrow();
  });

  it.each([
    "postgres:opaque",
    "postgresql:opaque",
    "postgres://user:password@localhost:5432",
    "postgres:///database",
    "postgres://localhost/",
  ])(
    "rejects a non-hierarchical or pathless database URL: %s",
    (invalidDatabaseUrl) => {
      expect(() => loadEnv({ DATABASE_URL: invalidDatabaseUrl })).toThrow();
    },
  );

  it("rejects every project-owned enable flag when set to true", () => {
    const ownedEnableFlags = [
      "SELARTI_ENABLED",
      "PLANERKA_ENABLED",
      "TELEGRAM_ENABLED",
      "PAYMENTS_ENABLED",
      "LLM_ENABLED",
      "INTENT_MODEL_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "GOOGLE_SHEETS_PROJECTION_ENABLED",
      "MINOR_ONBOARDING_ENABLED",
    ] as const;

    for (const flag of ownedEnableFlags) {
      expect(() => loadEnv(localEnv({ [flag]: "true" })), flag).toThrow();
    }
  });

  it("requires owned provider selectors to remain disabled", () => {
    expect(
      loadEnv(
        localEnv({
          PAYMENT_PROVIDER: "disabled",
          LLM_PROVIDER: "disabled",
        }),
      ).databaseUrl,
    ).toBe(databaseUrl);
    expect(() => loadEnv(localEnv({ PAYMENT_PROVIDER: "stripe" }))).toThrow();
    expect(() => loadEnv(localEnv({ LLM_PROVIDER: "openai" }))).toThrow();
    expect(() =>
      loadEnv(
        localEnv({
          SELARTI_OUTBOUND_BILLING_MODE: "delivery",
        }),
      ),
    ).toThrow();
  });
});
