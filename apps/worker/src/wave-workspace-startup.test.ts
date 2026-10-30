import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import * as db from "@ii-tonya/db";
import {
  createProductionWorkerRuntimeFactory,
  productionWorkerOutboxRegistryFactory,
} from "./main.js";
vi.mock("@ii-tonya/db", async (original) => {
  const actual = await original<typeof db>();
  return {
    ...actual,
    createDb: vi.fn(actual.createDb),
    PostgresCatalogRepository: vi.fn(function () {
      return {
        listPublicServices: vi.fn(),
        findEligible: vi.fn(),
        findNearest: vi.fn(),
      };
    }),
  };
});
it("fails worker startup and closes its pool when wave DB grants are unavailable", async () => {
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
    TELEGRAM_WEBHOOK_SECRET: "synthetic_work_secret_123456789012",
  });
  const end = vi.fn(async () => {});
  const execute = vi.fn(async () => ({ rows: [{ available: false }] }));
  vi.mocked(db.createDb).mockReturnValue({
    execute,
    $client: { end },
  } as never);
  await expect(
    createProductionWorkerRuntimeFactory().create(config),
  ).rejects.toThrow("wave_workspace_capability_unavailable");
  expect(end).toHaveBeenCalledOnce();
});

it("propagates wave visibility to the production worker catalog factory", () => {
  const config = loadEnv({
    DATABASE_URL: "postgresql://local:local@localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
  });
  config.features.clientCatalog = true;
  config.features.waveWorkspace = true;
  const database = {} as never;
  productionWorkerOutboxRegistryFactory(database, config);
  expect(db.PostgresCatalogRepository).toHaveBeenCalledWith(database, {
    waveCoverage: true,
  });
});
