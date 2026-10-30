import type { ExpertReferralTestDatabase } from "./expert-referral.js";

/** Synthetic dual approval; only used by DB integration fixtures. */
export async function ownerPricingApproval(
  fixture: ExpertReferralTestDatabase,
  input: {
    action: "grant" | "revoke";
    target: string;
    adminId: string;
    sessionIdHash: string;
  },
): Promise<string> {
  const isGrant = input.action === "grant";
  const approval = await fixture.createAdminAudit({
    action: `owner_test_pricing.${input.action}`,
    objectType: isGrant ? "user" : "owner_test_pricing_grant",
    objectId: input.target,
    adminId: input.adminId,
    sessionIdHash: input.sessionIdHash,
    payload: isGrant ? { userId: input.target } : { grantId: input.target },
    consumed: true,
  });
  return approval.approvalId;
}
