import { describe, expect, it } from "vitest";
import { executeOpaqueTokenOperation } from "./early-bird-token-error.js";

describe("opaque dispatch capability errors", () => {
  it("does not expose the token through an error, cause, stack or JSON", async () => {
    const canary = "dispatch-token-canary-7f9d";
    const unsafe = new Error(`database parameters ${canary}`, {
      cause: { token: canary },
    });
    let caught: unknown;
    try {
      await executeOpaqueTokenOperation(async () => {
        throw unsafe;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("early_bird_dispatch_unavailable");
    expect((caught as Error).cause).toBeUndefined();
    expect(
      `${String(caught)} ${String((caught as Error).stack)} ${JSON.stringify(caught)}`,
    ).not.toContain(canary);
  });
  it("preserves successful results", async () => {
    await expect(executeOpaqueTokenOperation(async () => 7)).resolves.toBe(7);
  });
});
