import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import { createDefaultLifecycle } from "./server.js";
const SYNTHETIC_FIXTURE_VALUE_1 = "synthetic_work_secret_123456789012";

it("refuses API startup before exposing wave card routes if database capabilities are unavailable", async () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    WAVE_WORKSPACE_ENABLED: "true",
    EXPERT_CARD_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: "123456",
    EXPERT_CARD_WORK_BOT_KEY: "expert-work",
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
  });
  const execute = vi.fn(async () => ({ rows: [{ available: false }] }));
  const db = {
    execute,
    transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
  };
  await expect(
    createDefaultLifecycle().dependencies(config, db as never),
  ).rejects.toThrow("wave_workspace_capability_unavailable");
  expect(execute).toHaveBeenCalled();
});
it("passes the shared wave capability into the public catalog factory", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    WAVE_WORKSPACE_ENABLED: "true",
    EXPERT_CARD_ENABLED: "true",
    EXPERT_CARD_PAYMENT_MODE: "test",
    EXPERT_CARD_WORK_BOT_ID: "123456",
    EXPERT_CARD_WORK_BOT_KEY: "expert-work",
    EXPERT_CARD_WORK_BOT_USERNAME: "synthetic_work_bot",
    EXPERT_CARD_MESSAGING_CONSENT_POLICY_VERSION: "policy-v1",
    TELEGRAM_WEBHOOK_SECRET: SYNTHETIC_FIXTURE_VALUE_1,
  });
  const statements: string[] = [];
  const execute = vi.fn(async (query: unknown) => {
    const statement = dialect.sqlToQuery(query as never).sql;
    statements.push(statement);
    return {
      rows: statement.includes("has_function_privilege")
        ? [{ available: true }]
        : [],
    };
  });
  const db = {
    execute,
    transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }),
  };
  const deps = await createDefaultLifecycle().dependencies(config, db as never);
  await deps.publicCatalog!.listPublicServices({ limit: 10 });
  expect(
    statements.some(
      (statement) =>
        statement.includes("from expert_services") &&
        statement.includes("early_bird_current_publication_valid"),
    ),
  ).toBe(true);
});
