import { loadEnv } from "@ii-tonya/config";
import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import {
  composeB2TelegramDelivery,
  createProductionWorkerRuntimeFactory,
} from "./main.js";

describe("B2 Telegram worker composition", () => {
  it("is default-off and fails closed without a provider capability", () => {
    const db = {} as DrizzleDb;
    expect(
      composeB2TelegramDelivery(db, false, { enabled: false }),
    ).toBeUndefined();
    expect(() =>
      composeB2TelegramDelivery(db, true, { enabled: false }),
    ).toThrow("b2_telegram_delivery_capability_unavailable");
  });
  it("refuses an unfenced capability even when an old flag disables the gate", () => {
    expect(() =>
      composeB2TelegramDelivery(
        {} as DrizzleDb,
        true,
        { enabled: false },
        {
          dispatch: async () => ({ kind: "applied" }),
          reconcile: async () => "still_unknown",
        },
      ),
    ).toThrow("b2_telegram_delivery_capability_unavailable");
  });
  it("checks production client capability readiness before opening a database", async () => {
    const config = loadEnv({
      DATABASE_URL: "postgresql://placeholder.invalid/test?sslmode=require",
    });
    config.features.b2TelegramDispatch = true;
    config.features.telegramEgressConsentGate = true;
    await expect(
      createProductionWorkerRuntimeFactory().create(config),
    ).rejects.toThrow("b2_telegram_delivery_capability_unavailable");
  });
});
