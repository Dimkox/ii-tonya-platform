import { expect, it } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import { createEarlyBirdOwnerCheckoutComposition } from "./expert-early-bird-checkout-composition.js";
it("is unavailable unless the owner checkout capabilities are explicitly configured", () => {
  expect(
    createEarlyBirdOwnerCheckoutComposition({} as DrizzleDb),
  ).toBeUndefined();
});
