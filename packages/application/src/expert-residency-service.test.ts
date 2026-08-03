import { describe, expect, it, vi } from "vitest";
import { createExpertResidencyService } from "./expert-residency-service.js";
import { owner } from "./expert-referral-service.testkit.js";
import { quote } from "./expert-residency-service.testkit.js";

describe("expert residency service", () => {
  it("returns the 50/50 quote and keeps reconciliation callable below the ceiling", async () => {
    const settle = vi.fn(async () => ({ kind: "settled" }));
    const reconciliation = { settle, reverse: vi.fn(), replayHeldReward: vi.fn(), releaseExpiredOrders: vi.fn() };
    const deps = { environmentEnabled: true, commands: { quote: async () => quote, checkout: vi.fn() }, queries: { ownerUserId: async () => "user-1" }, reconciliation };
    expect(await createExpertResidencyService(deps).quote(owner, "tariff-1")).toEqual(quote);
    const disabled = createExpertResidencyService({ ...deps, environmentEnabled: false });
    expect(await disabled.quote(owner, "tariff-1")).toEqual({ kind: "disabled" });
    await disabled.reconciliation.settle({});
    expect(settle).toHaveBeenCalledOnce();
  });
});
