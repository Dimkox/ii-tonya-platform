import { describe, expect, it, vi } from "vitest";
import { createExpertReferralService } from "./expert-referral-service.js";
import { otherExpert, owner, referralSummary } from "./expert-referral-service.testkit.js";

describe("expert referral service", () => {
  it("enforces ownership and the environment ceiling", async () => {
    const redeem = vi.fn(async () => ({ kind: "redeemed" as const, referralId: "r1" }));
    const queries = { ownerUserId: async () => "user-1", summary: async () => referralSummary };
    const enabled = createExpertReferralService({ environmentEnabled: true, commands: { redeem }, queries });
    expect(await enabled.redeemCode(otherExpert, "EXR_code", "id-1")).toEqual({ kind: "forbidden" });
    expect(await enabled.redeemCode(owner, "EXR_code", "id-1")).toEqual({ kind: "redeemed", referralId: "r1" });
    const disabled = createExpertReferralService({ environmentEnabled: false, commands: { redeem }, queries });
    expect(await disabled.redeemCode(owner, "EXR_code", "id-2")).toEqual({ kind: "disabled" });
  });
});
