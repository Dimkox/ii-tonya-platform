import { describe, expect, it, vi } from "vitest";
import { buildExpertReferralAdminApi } from "./expert-referral-admin.js";

const token = "a".repeat(32);
const principal = { id: "00000000-0000-4000-8000-000000000001", sessionIdHash: "sha256:bound", roles: ["security_admin" as const], mfaVerifiedAt: new Date() };

describe("expert referral admin routes", () => {
  it("rejects batch_generate count 1001 with a non-enumerable error", async () => {
    const approvals = { resolvePrincipal: vi.fn(async () => principal), requestApproval: vi.fn(), approveApproval: vi.fn() };
    const admin = { execute: vi.fn(), inventory: vi.fn() };
    const app = await buildExpertReferralAdminApi({ approvals, admin, sessionTokenHash: () => principal.sessionIdHash, environmentCeilings: { expertReferral: true, expertResidencyBilling: true } });
    const response = await app.inject({ method: "POST", url: "/v1/admin/actions/expert_referral.batch_generate/00000000-0000-4000-8000-000000000010/approvals", headers: { authorization: `Bearer ${token}` }, payload: { nonce: "nonce-task9-0001", command: { count: 1001 } } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_command" });
    expect(approvals.requestApproval).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns plaintext codes once from execution but never from inventory", async () => {
    const approvals = { resolvePrincipal: vi.fn(async () => principal), requestApproval: vi.fn(), approveApproval: vi.fn() };
    const admin = {
      execute: vi.fn(async () => ({ allowed: true as const, replayed: false, batchId: "batch", codes: ["SECRET-A", "SECRET-B"] })),
      inventory: vi.fn(async () => [{ batchId: "batch", status: "issued", maskedSuffix: "ET-A", createdAt: new Date("2026-08-04T10:00:00Z") }]),
    };
    const app = await buildExpertReferralAdminApi({ approvals, admin, sessionTokenHash: () => principal.sessionIdHash, environmentCeilings: { expertReferral: true, expertResidencyBilling: true } });
    const execution = await app.inject({ method: "POST", url: "/v1/admin/actions/expert_referral.batch_generate/00000000-0000-4000-8000-000000000010/execute", headers: { authorization: `Bearer ${token}` }, payload: { approvalId: "00000000-0000-4000-8000-000000000020", nonce: "nonce-task9-0002", correlationId: "correlation-task9-0002", command: { count: 2 } } });
    expect(execution.json().codes).toHaveLength(2);
    const inventory = await app.inject({ method: "GET", url: "/v1/admin/expert-referrals/inventory?inviterExpertId=00000000-0000-4000-8000-000000000010", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.stringify(inventory.json())).not.toContain("SECRET-A");
    expect(inventory.json()[0]).toEqual({ batchId: "batch", status: "issued", maskedSuffix: "ET-A", createdAt: "2026-08-04T10:00:00.000Z" });
    await app.close();
  });

  it("maps a stale feature control version to a non-enumerable conflict", async () => {
    const approvals = { resolvePrincipal: vi.fn(async () => principal), requestApproval: vi.fn(), approveApproval: vi.fn() };
    const conflict = Object.assign(new Error("stale"), { code: "FEATURE_CONTROL_CONFLICT" });
    const admin = { execute: vi.fn(async () => { throw conflict; }), inventory: vi.fn() };
    const app = await buildExpertReferralAdminApi({ approvals, admin, sessionTokenHash: () => principal.sessionIdHash, environmentCeilings: { expertReferral: false, expertResidencyBilling: false } });
    const response = await app.inject({ method: "POST", url: "/v1/admin/actions/expert_referral.feature_switch/00000000-0000-0000-0000-000000000041/execute", headers: { authorization: `Bearer ${token}` }, payload: { approvalId: "00000000-0000-4000-8000-000000000020", nonce: "nonce-task9-0003", correlationId: "correlation-task9-0003", command: { expectedVersion: 4, newCommandsEnabled: false, rewardGrantsEnabled: false } } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "conflict" });
    await app.close();
  });

  it("normalizes override timestamps and maps dual-control denial to 403", async () => {
    const approvals = { resolvePrincipal: vi.fn(async () => principal), requestApproval: vi.fn(), approveApproval: vi.fn() };
    const admin = { execute: vi.fn(async () => ({ allowed: false as const, reasonCode: "approval_denied" as const })), inventory: vi.fn() };
    const app = await buildExpertReferralAdminApi({ approvals, admin, sessionTokenHash: () => principal.sessionIdHash, environmentCeilings: { expertReferral: true, expertResidencyBilling: true } });
    const response = await app.inject({ method: "POST", url: "/v1/admin/actions/expert_referral.issuance_override/00000000-0000-4000-8000-000000000030/execute", headers: { authorization: `Bearer ${token}` }, payload: { approvalId: "00000000-0000-4000-8000-000000000020", secondApprovalId: "00000000-0000-4000-8000-000000000021", nonce: "nonce-task9-0004", secondNonce: "nonce-task9-0005", correlationId: "correlation-task9-0004", command: { inviterExpertId: "00000000-0000-4000-8000-000000000010", additionalQuota: 1, reasonCode: "approved", validFrom: "2026-08-04T12:00:00+03:00", validUntil: "2026-08-04T13:00:00+03:00" } } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "approval_denied" });
    expect(admin.execute).toHaveBeenCalledWith(principal, expect.objectContaining({ payload: expect.objectContaining({ validFrom: "2026-08-04T09:00:00.000Z", validUntil: "2026-08-04T10:00:00.000Z", requesterId: principal.id, requesterSessionIdHash: principal.sessionIdHash }) }));
    await app.close();
  });
});
