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
    expect(config.features).toEqual({ expertReferral: false, expertResidencyBilling: false });
    expect(config.selartiOutboundBillingMode).toBe("disabled");
    expect(() =>
      loadEnv(localEnv({ RAW_CONVERSATION_LOGGING: "true" })),
    ).toThrow("Raw conversation logging is prohibited");
    expect(() => loadEnv(localEnv({ SELARTI_ENABLED: "true" }))).toThrow();
  });

  it("requires safe key metadata only when expert referrals are enabled", () => {
    const enabled = loadEnv(localEnv({
      EXPERT_REFERRAL_ENABLED: "true",
      EXPERT_REFERRAL_HMAC_KEY_VERSION: "v1",
      EXPERT_REFERRAL_HMAC_KEY_REF: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      EXPERT_REFERRAL_HMAC_KEYS_JSON: '{"v1":"must-not-enter-config"}',
    }));
    expect(enabled.features.expertReferral).toBe(true);
    expect(enabled.expertReferralKey).toEqual({ currentVersion: "v1", reference: "env://EXPERT_REFERRAL_HMAC_KEYS_JSON" });
    expect(JSON.stringify(enabled)).not.toContain("must-not-enter-config");
    expect(() => loadEnv(localEnv({ EXPERT_REFERRAL_ENABLED: "true" }))).toThrow("expert_referral_key_unavailable");
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
