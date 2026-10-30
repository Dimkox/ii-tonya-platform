import { expect, it } from "vitest";
import { deferredId } from "./early-bird-deferred-id.js";

it("derives the same account for approval and callback while separating payment stages", () => {
  const key = Buffer.alloc(32, 9),
    user = crypto.randomUUID(),
    choice = crypto.randomUUID();
  expect(deferredId(key, "account", user, choice)).toBe(
    deferredId(key, "account", user, choice),
  );
  expect(deferredId(key, "onboarding-invoice", user, choice)).not.toBe(
    deferredId(key, "subscription-invoice", user, choice),
  );
  expect(() => deferredId(key, "account", user, "not-a-uuid")).toThrow();
});
