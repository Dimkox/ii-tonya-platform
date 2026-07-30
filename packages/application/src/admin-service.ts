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
export interface AdminDependencies {
  readonly principal: AdminPrincipal;
  readonly approvals: { authorize(input: { action: string; objectId: string; approvalId: string; principal: AdminPrincipal; now: Date; correlationId: string }): Promise<boolean> };
  readonly audit: { append(input: { action: string; objectId: string; correlationId: string }): Promise<void> };
  readonly ledger: {
    facts(): readonly LedgerFact[];
    grant(input: { packageId: string; userId: string; units: number; packageKind: "admin" | "intro"; expiresAt: Date | null; idempotencyKey: string }): Promise<void>;
    revoke(input: { packageId: string; originalEntryId: string; idempotencyKey: string }): Promise<void>;
  };
  readonly workflow: { grant(input: { principal: AdminPrincipal; action: "package.grant" | "package.intro_grant"; command: GrantPackageCommand; packageKind: "admin" | "intro"; expiresAt: Date | null }): Promise<void> };
  readonly admin: { mutate(input: { action: string; objectId: string }): Promise<void> };
}
export interface AdminFixture extends AdminDependencies { readonly principal: AdminPrincipal; readonly ledger: AdminDependencies["ledger"]; }
export interface AdminService { createClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>; deactivateClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>; grantPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>; grantIntroPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>; revokePackage(principal: AdminPrincipal, command: RevokePackageCommand): Promise<void>; updateExpertVerification(principal: AdminPrincipal, command: ExpertVerificationCommand): Promise<void>; updateService(principal: AdminPrincipal, command: ServiceAdminCommand): Promise<void>; resolveIntegrationError(principal: AdminPrincipal, command: ResolveIntegrationErrorCommand): Promise<void>; resolveAlert(principal: AdminPrincipal, command: ResolveAlertCommand): Promise<void>; }

const unavailable = async (): Promise<never> => {
  throw new Error("Admin workflows are not registered");
};

// These interfaces remain only for later Task 17 transactional wiring. They are
// deliberately not exported from the application barrel and every method fails
// before invoking an injected port.
export const createAdminService = (deps: AdminDependencies): AdminService => {
  void deps;
  return {
    createClient: unavailable,
    deactivateClient: unavailable,
    grantPackage: unavailable,
    grantIntroPackage: unavailable,
    revokePackage: unavailable,
    updateExpertVerification: unavailable,
    updateService: unavailable,
    resolveIntegrationError: unavailable,
    resolveAlert: unavailable,
  };
};
