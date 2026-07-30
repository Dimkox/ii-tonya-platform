export type AdminRole = "support" | "catalog_admin" | "entitlement_admin" | "security_admin";
export interface AdminPrincipal { readonly id: string; readonly sessionIdHash: string; readonly roles: readonly AdminRole[]; readonly mfaVerifiedAt: Date; }
export interface ClientLifecycleCommand { readonly userId: string; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface GrantPackageCommand { readonly userId: string; readonly units: number; readonly idempotencyKey: string; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface RevokePackageCommand { readonly userId: string; readonly packageId: string; readonly idempotencyKey: string; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface ExpertVerificationCommand { readonly expertId: string; readonly verified: boolean; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface ServiceAdminCommand { readonly serviceId: string; readonly active: boolean; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface ResolveIntegrationErrorCommand { readonly errorId: string; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface ResolveAlertCommand { readonly alertId: string; readonly approvalId: string; readonly now: Date; readonly correlationId: string; }
export interface LedgerFact { readonly id: string; readonly packageId: string; readonly kind: "grant" | "revocation"; readonly delta: number; readonly originalEntryId: string | null; readonly packageKind: "admin" | "intro"; readonly expiresAt: Date | null; }
export interface AdminDependencies { readonly principal: AdminPrincipal; readonly approvals: { authorize(input: { action: string; objectId: string; approvalId: string; principal: AdminPrincipal; now: Date; correlationId: string }): Promise<boolean> }; readonly audit: { append(input: { action: string; objectId: string; correlationId: string }): Promise<void> }; readonly ledger: { facts(): readonly LedgerFact[]; grant(input: { packageId: string; userId: string; units: number; packageKind: "admin" | "intro"; expiresAt: Date | null; idempotencyKey: string }): Promise<void>; revoke(input: { packageId: string; originalEntryId: string; idempotencyKey: string }): Promise<void> }; readonly workflow: { grant(input: { principal: AdminPrincipal; action: "package.grant" | "package.intro_grant"; command: GrantPackageCommand; packageKind: "admin" | "intro"; expiresAt: Date | null }): Promise<void> }; readonly admin: { mutate(input: { action: string; objectId: string }): Promise<void> }; }
export interface AdminFixture extends AdminDependencies { readonly principal: AdminPrincipal; readonly ledger: AdminDependencies["ledger"]; }
export interface AdminService { createClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>; deactivateClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>; grantPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>; grantIntroPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>; revokePackage(principal: AdminPrincipal, command: RevokePackageCommand): Promise<void>; updateExpertVerification(principal: AdminPrincipal, command: ExpertVerificationCommand): Promise<void>; updateService(principal: AdminPrincipal, command: ServiceAdminCommand): Promise<void>; resolveIntegrationError(principal: AdminPrincipal, command: ResolveIntegrationErrorCommand): Promise<void>; resolveAlert(principal: AdminPrincipal, command: ResolveAlertCommand): Promise<void>; }

const normalSizes = new Set([500, 1000, 1500, 2000]);
const sixtyDays = (now: Date): Date => new Date(now.getTime() + 60 * 24 * 60 * 60 * 1_000);

export const createAdminService = (deps: AdminDependencies): AdminService => {
  const allowed = async (principal: AdminPrincipal, action: string, objectId: string, approvalId: string, now: Date, correlationId: string): Promise<void> => {
    if (principal.id !== deps.principal.id || !(await deps.approvals.authorize({ action, objectId, approvalId, principal, now, correlationId }))) throw new Error("Admin action denied");
  };
  const mutate = async (principal: AdminPrincipal, action: string, objectId: string, approvalId: string, now: Date, correlationId: string): Promise<void> => { await allowed(principal, action, objectId, approvalId, now, correlationId); await deps.admin.mutate({ action, objectId }); await deps.audit.append({ action: `${action}.allowed`, objectId, correlationId }); };
  const grant = async (principal: AdminPrincipal, command: GrantPackageCommand, intro: boolean): Promise<void> => {
    if (intro ? command.units !== 100 : !normalSizes.has(command.units)) throw new Error(intro ? "Intro package size is not allowed" : "Package size is not allowed");
    const action = intro ? "package.intro_grant" : "package.grant";
    await deps.workflow.grant({ principal, action, command, packageKind: intro ? "intro" : "admin", expiresAt: intro ? null : sixtyDays(command.now) });
  };
  return {
    createClient: (p, c) => mutate(p, "client.create", c.userId, c.approvalId, c.now, c.correlationId), deactivateClient: (p, c) => mutate(p, "client.deactivate", c.userId, c.approvalId, c.now, c.correlationId),
    grantPackage: (p, c) => grant(p, c, false), grantIntroPackage: (p, c) => grant(p, c, true),
    async revokePackage(p, c) { await allowed(p, "package.revoke", c.userId, c.approvalId, c.now, c.correlationId); const grant = deps.ledger.facts().find((fact) => fact.packageId === c.packageId && fact.kind === "grant"); if (grant === undefined) throw new Error("Package grant not found"); await deps.ledger.revoke({ packageId: c.packageId, originalEntryId: grant.id, idempotencyKey: c.idempotencyKey }); await deps.audit.append({ action: "package.revoke.allowed", objectId: c.userId, correlationId: c.correlationId }); },
    updateExpertVerification: (p, c) => mutate(p, c.verified ? "expert.verify" : "expert.suspend", c.expertId, c.approvalId, c.now, c.correlationId), updateService: (p, c) => mutate(p, c.active ? "service.activate" : "service.deactivate", c.serviceId, c.approvalId, c.now, c.correlationId), resolveIntegrationError: (p, c) => mutate(p, "integration_error.resolve", c.errorId, c.approvalId, c.now, c.correlationId), resolveAlert: (p, c) => mutate(p, "safety.resolve", c.alertId, c.approvalId, c.now, c.correlationId),
  };
};
