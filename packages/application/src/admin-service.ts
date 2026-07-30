export type AdminRole = "support" | "catalog_admin" | "entitlement_admin" | "security_admin";
export interface AdminPrincipal {
  readonly id: string;
  readonly sessionIdHash: string;
  readonly roles: readonly AdminRole[];
  readonly mfaVerifiedAt: Date;
}

export interface AdminCommandAuthorization {
  readonly routeObjectId: string;
  readonly approvalId: string;
  readonly nonce: string;
  readonly correlationId: string;
}
export interface ClientLifecycleCommand extends AdminCommandAuthorization { readonly userId: string; }
export interface GrantPackageCommand extends AdminCommandAuthorization { readonly userId: string; readonly units: number; readonly idempotencyKey: string; }
export interface RevokePackageCommand extends AdminCommandAuthorization { readonly userId: string; readonly packageId: string; readonly idempotencyKey: string; }
export interface ExpertVerificationCommand extends AdminCommandAuthorization { readonly expertId: string; readonly verified: boolean; }
export interface ServiceAdminCommand extends AdminCommandAuthorization { readonly serviceId: string; readonly active: boolean; }
export interface ResolveIntegrationErrorCommand extends AdminCommandAuthorization { readonly errorId: string; }
export interface ResolveAlertCommand extends AdminCommandAuthorization {
  readonly alertId: string;
  readonly alertType: "safety" | "feedback";
  readonly resolution: "acknowledge" | "resolve";
}

export interface WorkflowAuthorization {
  readonly sessionIdHash: string;
  readonly approvalId: string;
  readonly nonce: string;
  readonly correlationId: string;
}
export interface AdminWorkflowPort {
  createClient(command: WorkflowAuthorization & { readonly userId: string }): Promise<unknown>;
  deactivateClient(command: WorkflowAuthorization & { readonly userId: string }): Promise<unknown>;
  grantPackage(command: WorkflowAuthorization & { readonly userId: string; readonly units: 500 | 1000 | 1500 | 2000; readonly idempotencyKey: string }): Promise<unknown>;
  grantIntroPackage(command: WorkflowAuthorization & { readonly userId: string; readonly units: 100; readonly idempotencyKey: string }): Promise<unknown>;
  revokePackage(command: WorkflowAuthorization & { readonly userId: string; readonly packageId: string; readonly idempotencyKey: string }): Promise<unknown>;
  verifyExpert(command: WorkflowAuthorization & { readonly expertId: string }): Promise<unknown>;
  suspendExpert(command: WorkflowAuthorization & { readonly expertId: string }): Promise<unknown>;
  activateService(command: WorkflowAuthorization & { readonly serviceId: string }): Promise<unknown>;
  deactivateService(command: WorkflowAuthorization & { readonly serviceId: string }): Promise<unknown>;
  resolveIntegrationError(command: WorkflowAuthorization & { readonly errorId: string }): Promise<unknown>;
  acknowledgeSafetyAlert(command: WorkflowAuthorization & { readonly alertId: string }): Promise<unknown>;
  resolveSafetyAlert(command: WorkflowAuthorization & { readonly alertId: string }): Promise<unknown>;
  acknowledgeNegativeFeedback(command: WorkflowAuthorization & { readonly alertId: string }): Promise<unknown>;
  resolveNegativeFeedback(command: WorkflowAuthorization & { readonly alertId: string }): Promise<unknown>;
}

export interface AdminDependencies { readonly workflows: AdminWorkflowPort; }
export interface AdminService {
  createClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>;
  deactivateClient(principal: AdminPrincipal, command: ClientLifecycleCommand): Promise<void>;
  grantPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>;
  grantIntroPackage(principal: AdminPrincipal, command: GrantPackageCommand): Promise<void>;
  revokePackage(principal: AdminPrincipal, command: RevokePackageCommand): Promise<void>;
  updateExpertVerification(principal: AdminPrincipal, command: ExpertVerificationCommand): Promise<void>;
  updateService(principal: AdminPrincipal, command: ServiceAdminCommand): Promise<void>;
  resolveIntegrationError(principal: AdminPrincipal, command: ResolveIntegrationErrorCommand): Promise<void>;
  resolveAlert(principal: AdminPrincipal, command: ResolveAlertCommand): Promise<void>;
}

const exactTarget = (routeObjectId: string, commandObjectId: string): void => {
  if (routeObjectId !== commandObjectId) {
    throw new Error("Admin route object does not match command target");
  }
};
const authorization = (
  principal: AdminPrincipal,
  command: AdminCommandAuthorization,
): WorkflowAuthorization => ({
  sessionIdHash: principal.sessionIdHash,
  approvalId: command.approvalId,
  nonce: command.nonce,
  correlationId: command.correlationId,
});

export const createAdminService = ({ workflows }: AdminDependencies): AdminService => ({
  async createClient(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    await workflows.createClient({ ...authorization(principal, command), userId: command.userId });
  },
  async deactivateClient(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    await workflows.deactivateClient({ ...authorization(principal, command), userId: command.userId });
  },
  async grantPackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    if (![500, 1000, 1500, 2000].includes(command.units)) throw new Error("Package size is not allowed");
    await workflows.grantPackage({ ...authorization(principal, command), userId: command.userId, units: command.units as 500 | 1000 | 1500 | 2000, idempotencyKey: command.idempotencyKey });
  },
  async grantIntroPackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    if (command.units !== 100) throw new Error("Intro package must contain exactly 100 units");
    await workflows.grantIntroPackage({ ...authorization(principal, command), userId: command.userId, units: 100, idempotencyKey: command.idempotencyKey });
  },
  async revokePackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    await workflows.revokePackage({ ...authorization(principal, command), userId: command.userId, packageId: command.packageId, idempotencyKey: command.idempotencyKey });
  },
  async updateExpertVerification(principal, command) {
    exactTarget(command.routeObjectId, command.expertId);
    const input = { ...authorization(principal, command), expertId: command.expertId };
    if (command.verified) await workflows.verifyExpert(input);
    else await workflows.suspendExpert(input);
  },
  async updateService(principal, command) {
    exactTarget(command.routeObjectId, command.serviceId);
    const input = { ...authorization(principal, command), serviceId: command.serviceId };
    if (command.active) await workflows.activateService(input);
    else await workflows.deactivateService(input);
  },
  async resolveIntegrationError(principal, command) {
    exactTarget(command.routeObjectId, command.errorId);
    await workflows.resolveIntegrationError({ ...authorization(principal, command), errorId: command.errorId });
  },
  async resolveAlert(principal, command) {
    exactTarget(command.routeObjectId, command.alertId);
    const input = { ...authorization(principal, command), alertId: command.alertId };
    if (command.alertType === "safety" && command.resolution === "acknowledge") await workflows.acknowledgeSafetyAlert(input);
    else if (command.alertType === "safety") await workflows.resolveSafetyAlert(input);
    else if (command.resolution === "acknowledge") await workflows.acknowledgeNegativeFeedback(input);
    else await workflows.resolveNegativeFeedback(input);
  },
});
