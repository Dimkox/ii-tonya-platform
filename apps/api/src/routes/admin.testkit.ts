import type { AdminApprovalRepository, ApprovalConsumption, BoundApproval } from "./admin.js";
import { vi } from "vitest";

export function fakeApprovalRepository(input: { case?: "forged" | "stale" | "cross_object" | "same_actor" | "valid" } = {}): AdminApprovalRepository & { consumeIfValid: ReturnType<typeof vi.fn> } {
  const approvalCase = input.case ?? "valid";
  return {
    async request() { return { approvalId: "approval-requested" }; },
    async approve() {},
    consumeIfValid: vi.fn(async (command: ApprovalConsumption): Promise<BoundApproval | null> => {
      if (approvalCase === "forged") return null;
      if (approvalCase === "stale") return { approvalId: command.approvalId, action: command.action, objectType: "user", objectId: command.objectId, requesterId: command.principal.id, approverId: "admin-2", expiresAt: new Date(command.now.getTime() - 1), payloadHash: command.payloadHash, nonce: "n" };
      if (approvalCase === "cross_object") return { approvalId: command.approvalId, action: command.action, objectType: "user", objectId: "other-object", requesterId: command.principal.id, approverId: "admin-2", expiresAt: new Date(command.now.getTime() + 60_000), payloadHash: command.payloadHash, nonce: "n" };
      if (approvalCase === "same_actor") return { approvalId: command.approvalId, action: command.action, objectType: "user", objectId: command.objectId, requesterId: command.principal.id, approverId: command.principal.id, expiresAt: new Date(command.now.getTime() + 60_000), payloadHash: command.payloadHash, nonce: "n" };
      return { approvalId: command.approvalId, action: command.action, objectType: "user", objectId: command.objectId, requesterId: command.principal.id, approverId: "admin-approver", expiresAt: new Date(command.now.getTime() + 60_000), payloadHash: command.payloadHash, nonce: "n" };
    }),
  };
}
