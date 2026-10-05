import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import { loadEnv } from "../../../packages/config/src/env.js";
import { buildApp } from "./app.js";
import { createDefaultLifecycle } from "./server.js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

it("default production composition reads the real public repository with session/catalog/providers disabled", async () => {
  const statements: string[] = [];
  const execute = vi.fn(async (query: SQL) => {
    statements.push(new PgDialect().sqlToQuery(query).sql.trim());
    return {
      rows: [
        {
          sourceKey: "private",
          displayName: "Эксперт",
          serviceCode: "career",
          language: "ru",
        },
      ],
    };
  });
  const outsideExecute = vi.fn(async () => {
    throw new Error("read escaped transaction");
  });
  const transaction = vi.fn(
    async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute }),
  );
  const config = loadEnv({
    DATABASE_URL: "postgresql://localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  expect(config.features.clientSession).toBe(false);
  expect(config.features.clientCatalog).toBe(false);
  expect(Object.values(config.integrations).every((enabled) => !enabled)).toBe(
    true,
  );
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const deps = await lifecycle.dependencies(config, {
    execute: outsideExecute,
    transaction,
  } as unknown as DrizzleDb);
  deps.logger = deps.logger.child({ level: "silent" });
  const app = await buildApp(deps);
  try {
    expect(execute).not.toHaveBeenCalled();
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        { displayName: "Эксперт", serviceCode: "career", language: "ru" },
      ],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outsideExecute).not.toHaveBeenCalled();
    expect(statements[0]).toBe("SET LOCAL lock_timeout = '1s'");
    expect(statements[1]).toBe("SET LOCAL statement_timeout = '2s'");
    expect(statements[2]).toContain("from expert_services es");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(response.headers["set-cookie"]).toBeUndefined();
  } finally {
    await app.close();
  }
});
