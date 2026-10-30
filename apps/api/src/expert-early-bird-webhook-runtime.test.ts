import { expect, it } from "vitest";
import { createExpertEarlyBirdWebhookRuntime } from "./expert-early-bird-webhook-runtime.js";
it("rejects missing isolated capabilities before enabling routing", () => {
  expect(() => createExpertEarlyBirdWebhookRuntime({} as never)).toThrow(
    "early_bird_webhook_configuration_invalid",
  );
});
