import { describe, expect, it } from "vitest";
import { createExpertReferralService } from "./expert-referral-service.js";
import { expertReferralFixture } from "./expert-referral-service.testkit.js";

describe("expert referral application boundary", () => {
  it("returns only an owner summary after fresh identity authorization", async () => {
    const fixture = expertReferralFixture();
    const service = createExpertReferralService(fixture);

    await expect(service.summary(fixture.owner)).resolves.toMatchObject({
      expertId: fixture.owner.expertId,
      spendableBalanceMinor: "100000",
      debtMinor: "0",
    });
    await expect(service.summary(fixture.other)).resolves.toEqual({
      kind: "forbidden",
    });

    fixture.setAuthorized(fixture.owner.expertId, false);
    await expect(service.summary(fixture.owner)).resolves.toEqual({
      kind: "forbidden",
    });
    expect(fixture.authorizationCount(fixture.owner.expertId)).toBe(2);
  });

  it("fails closed instead of exposing a mismatched summary owner", async () => {
    const fixture = expertReferralFixture();
    const ownerSummary = await fixture.queries.summary(fixture.owner.expertId);
    const service = createExpertReferralService({
      ...fixture,
      queries: {
        async summary() {
          return { ...ownerSummary, expertId: fixture.other.expertId };
        },
      },
    });

    await expect(service.summary(fixture.owner)).rejects.toThrow(
      "expert_referral_summary_ownership_mismatch",
    );
  });

  it("requires the referral environment ceiling before redemption", async () => {
    const fixture = expertReferralFixture({ referralEnabled: false });
    const service = createExpertReferralService(fixture);

    await expect(
      service.redeemCode(fixture.owner, fixture.code, fixture.idempotencyKey),
    ).resolves.toEqual({ kind: "disabled" });
    expect(fixture.authorizationCount(fixture.owner.expertId)).toBe(0);
    expect(fixture.controlReadCount()).toBe(0);
    expect(fixture.redemptionCount()).toBe(0);
  });

  it("reads the durable new-command switch on every redemption call", async () => {
    const fixture = expertReferralFixture();
    const service = createExpertReferralService(fixture);

    await expect(
      service.redeemCode(fixture.owner, fixture.code, fixture.idempotencyKey),
    ).resolves.toEqual({
      kind: "redeemed",
      referralId: "00000000-0000-4000-8000-000000000805",
    });

    fixture.setNewCommandsEnabled(false);
    await expect(
      service.redeemCode(fixture.owner, fixture.code, "referral_redeem_802"),
    ).resolves.toEqual({ kind: "disabled" });

    fixture.setNewCommandsEnabled(true);
    await expect(
      service.redeemCode(fixture.owner, fixture.code, "referral_redeem_803"),
    ).resolves.toMatchObject({ kind: "redeemed" });

    expect(fixture.controlReadCount()).toBe(3);
    expect(fixture.redemptionCount()).toBe(2);
  });

  it("rejects a principal that no longer owns the expert identity", async () => {
    const fixture = expertReferralFixture();
    const service = createExpertReferralService(fixture);

    await expect(
      service.redeemCode(fixture.other, fixture.code, fixture.idempotencyKey),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(fixture.controlReadCount()).toBe(0);
    expect(fixture.redemptionCount()).toBe(0);
  });
});
