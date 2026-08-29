import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import { composeB2TelegramDelivery } from "./main.js";

describe("B2 Telegram worker composition", () => {
  it("is default-off and fails closed without a provider capability", () => {
    const db = {} as DrizzleDb;
    expect(composeB2TelegramDelivery(db, false)).toBeUndefined();
    expect(() => composeB2TelegramDelivery(db, true)).toThrow(
      "b2_telegram_delivery_capability_unavailable",
    );
  });
});
