import { createHash } from "node:crypto";

export type AdminRole = "support" | "catalog_admin" | "entitlement_admin" | "security_admin";
export interface AdminPrincipal { readonly id: string; readonly sessionIdHash: string; readonly roles: readonly AdminRole[]; readonly mfaVerifiedAt: Date; }
export type AdminAction = "client.create" | "client.deactivate" | "package.grant" | "package.intro_grant" | "package.revoke" | "expert.verify" | "expert.suspend" | "service.activate" | "service.deactivate" | "integration_error.resolve" | "safety.read" | "safety.resolve" | "feedback.read" | "feedback.resolve";
export interface BoundApprovalRequest { readonly action: AdminAction; readonly objectType: string; readonly objectId: string; readonly payloadHash: string; readonly requesterSessionIdHash: string; readonly nonce: string; readonly expiresAt: Date; }
export interface AuthenticatedApproval { readonly approvalId: string; readonly approverSessionIdHash: string; }
export interface BoundApproval { readonly approvalId: string; readonly action: AdminAction; readonly objectType: string; readonly objectId: string; readonly requesterId: string; readonly approverId: string; readonly expiresAt: Date; readonly payloadHash: string; readonly nonce: string; }
export interface ApprovalConsumption { readonly approvalId: string; readonly action: AdminAction; readonly objectId: string; readonly payloadHash: string; readonly principal: AdminPrincipal; readonly now: Date; }
export interface AdminApprovalRepository { request(input: BoundApprovalRequest): Promise<{ approvalId: string }>; approve(input: AuthenticatedApproval): Promise<void>; consumeIfValid(input: ApprovalConsumption): Promise<BoundApproval | null>; }
export interface AuditPort { append(fact: { actorType: "admin" | "system"; actorId: string; sessionIdHash: string; action: string; objectType: string; objectId: string; decision: "allowed" | "denied"; reasonCode: string; correlationId: string; occurredAt: Date; metadataHash: string }): Promise<void>; }
export interface AdminAuthorizationInput { readonly principal: AdminPrincipal; readonly action: AdminAction; readonly routeObjectId: string; readonly commandObjectId: string; readonly approvalId?: string; readonly payloadHash?: string; readonly now: Date; readonly correlationId: string; }

const objectType = (action: AdminAction): string => action.startsWith("expert.") ? "expert" : action.startsWith("service.") ? "service" : action.startsWith("safety.") ? "safety_case" : action.startsWith("feedback.") ? "feedback" : action.startsWith("integration_error.") ? "integration_error" : "user";
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

// This file intentionally exposes no HTTP registration and cannot authorize an
// action until Task 17 wires server-resolved sessions, assignments, approvals,
// and domain mutation into one concrete transaction.
export async function authorizeAdminAction(input: AdminAuthorizationInput, _approvals: AdminApprovalRepository, auditPort: AuditPort): Promise<"deny"> {
  await auditPort.append({
    actorType: "admin",
    actorId: input.principal.id,
    sessionIdHash: input.principal.sessionIdHash,
    action: `${input.action}.denied`,
    objectType: objectType(input.action),
    objectId: input.commandObjectId,
    decision: "denied",
    reasonCode: "route_unregistered",
    correlationId: input.correlationId,
    occurredAt: input.now,
    metadataHash: hash(`${input.action}:${input.commandObjectId}:route_unregistered`),
  });
  return "deny";
}
