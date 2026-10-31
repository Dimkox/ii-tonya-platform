import { expect, it } from "vitest";
import { createEarlyBirdDeferredRuntime } from "./expert-early-bird-deferred-runtime.js";

it("leaves deferred payments unavailable until explicitly configured", () => {
  expect(createEarlyBirdDeferredRuntime()).toBeUndefined();
  expect(
    createEarlyBirdDeferredRuntime({ enabled: false } as never),
  ).toBeUndefined();
});
