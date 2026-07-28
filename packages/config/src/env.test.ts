import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const databaseUrl = "postgres://ii_tonya:__PLACEHOLDER_DB_PASSWORD__@localhost:5432/ii_tonya";

describe("loadEnv", () => {
  it("defaults dangerous integrations to disabled and rejects raw transcript logging", () => {
    const config = loadEnv({ DATABASE_URL: databaseUrl });

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
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, RAW_CONVERSATION_LOGGING: "true" })).toThrow(
      "Raw conversation logging is prohibited",
    );
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, SELARTI_ENABLED: "true" })).toThrow();
  });

  it("tolerates unrelated OS variables while rejecting every owned live flag", () => {
    expect(loadEnv({ DATABASE_URL: databaseUrl, USERPROFILE: "C:\\Users\\Dmitry" }).databaseUrl).toBe(databaseUrl);
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, MINOR_ONBOARDING_ENABLED: "true" })).toThrow();
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, PAYMENTS_ENABLED: "true" })).toThrow();
  });

  it("accepts only the exact Postgres URL protocols", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://user:password@localhost:5432/database" }).databaseUrl).toContain(
      "postgres://",
    );
    expect(loadEnv({ DATABASE_URL: "postgresql://user:password@localhost:5432/database" }).databaseUrl).toContain(
      "postgresql://",
    );
    expect(() => loadEnv({ DATABASE_URL: "postgresx://user:password@localhost:5432/database" })).toThrow();
  });

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
      expect(() => loadEnv({ DATABASE_URL: databaseUrl, [flag]: "true" }), flag).toThrow();
    }
  });

  it("requires owned provider selectors to remain disabled", () => {
    expect(loadEnv({
      DATABASE_URL: databaseUrl,
      PAYMENT_PROVIDER: "disabled",
      LLM_PROVIDER: "disabled",
    }).databaseUrl).toBe(databaseUrl);
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, PAYMENT_PROVIDER: "stripe" })).toThrow();
    expect(() => loadEnv({ DATABASE_URL: databaseUrl, LLM_PROVIDER: "openai" })).toThrow();
  });
});
