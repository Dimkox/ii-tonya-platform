export type AdminRole =
  "support" | "catalog_admin" | "entitlement_admin" | "security_admin";
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
export interface ClientLifecycleCommand extends AdminCommandAuthorization {
  readonly userId: string;
}
export interface GrantPackageCommand extends AdminCommandAuthorization {
  readonly userId: string;
  readonly units: number;
  readonly idempotencyKey: string;
}
export interface RevokePackageCommand extends AdminCommandAuthorization {
  readonly userId: string;
  readonly packageId: string;
  readonly idempotencyKey: string;
}
export interface ExpertVerificationCommand extends AdminCommandAuthorization {
  readonly expertId: string;
  readonly verified: boolean;
}
export interface ServiceAdminCommand extends AdminCommandAuthorization {
  readonly serviceId: string;
  readonly active: boolean;
}
export interface ResolveIntegrationErrorCommand extends AdminCommandAuthorization {
  readonly errorId: string;
}
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
export type AdminWorkflowResult<T extends Record<string, unknown>> =
  | ({ readonly allowed: true; readonly replayed: boolean } & T)
  | { readonly allowed: false; readonly reasonCode: "approval_denied" };
export type ClientWorkflowResult = AdminWorkflowResult<{
  readonly userId: string;
}>;
export type PackageGrantWorkflowResult = AdminWorkflowResult<{
  readonly packageId: string;
}>;
export type PackageRevokeWorkflowResult = AdminWorkflowResult<{
  readonly packageId: string;
  readonly delta: number;
  readonly originalEntryId: string;
}>;
export type ObjectWorkflowResult = AdminWorkflowResult<{
  readonly objectId: string;
}>;
export type IntegrationWorkflowResult = AdminWorkflowResult<{
  readonly errorId: string;
}>;
export type AlertWorkflowResult = AdminWorkflowResult<{
  readonly alertId: string;
}>;
export interface AdminWorkflowPort {
  createClient(
    command: WorkflowAuthorization & { readonly userId: string },
  ): Promise<ClientWorkflowResult>;
  deactivateClient(
    command: WorkflowAuthorization & { readonly userId: string },
  ): Promise<ClientWorkflowResult>;
  grantPackage(
    command: WorkflowAuthorization & {
      readonly userId: string;
      readonly units: 500 | 1000 | 1500 | 2000;
      readonly idempotencyKey: string;
    },
  ): Promise<PackageGrantWorkflowResult>;
  grantIntroPackage(
    command: WorkflowAuthorization & {
      readonly userId: string;
      readonly units: 100;
      readonly idempotencyKey: string;
    },
  ): Promise<PackageGrantWorkflowResult>;
  revokePackage(
    command: WorkflowAuthorization & {
      readonly userId: string;
      readonly packageId: string;
      readonly idempotencyKey: string;
    },
  ): Promise<PackageRevokeWorkflowResult>;
  verifyExpert(
    command: WorkflowAuthorization & { readonly expertId: string },
  ): Promise<ObjectWorkflowResult>;
  suspendExpert(
    command: WorkflowAuthorization & { readonly expertId: string },
  ): Promise<ObjectWorkflowResult>;
  activateService(
    command: WorkflowAuthorization & { readonly serviceId: string },
  ): Promise<ObjectWorkflowResult>;
  deactivateService(
    command: WorkflowAuthorization & { readonly serviceId: string },
  ): Promise<ObjectWorkflowResult>;
  resolveIntegrationError(
    command: WorkflowAuthorization & { readonly errorId: string },
  ): Promise<IntegrationWorkflowResult>;
  acknowledgeSafetyAlert(
    command: WorkflowAuthorization & { readonly alertId: string },
  ): Promise<AlertWorkflowResult>;
  resolveSafetyAlert(
    command: WorkflowAuthorization & { readonly alertId: string },
  ): Promise<AlertWorkflowResult>;
  acknowledgeNegativeFeedback(
    command: WorkflowAuthorization & { readonly alertId: string },
  ): Promise<AlertWorkflowResult>;
  resolveNegativeFeedback(
    command: WorkflowAuthorization & { readonly alertId: string },
  ): Promise<AlertWorkflowResult>;
}

export interface LatePaymentSummary {
  readonly id: string;
  readonly reasonCode: string;
  readonly status: "open" | "resolved";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
}
export interface LatePaymentDetail extends LatePaymentSummary {
  readonly inboxId: string;
  readonly orderId: string;
  readonly provider: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: string;
}
export interface LatePaymentQuery {
  readonly limit: number;
  readonly status?: string;
  readonly beforeCreatedAt?: string;
  readonly beforeId?: string;
}
export type AdminReadResult<T> =
  | ({ readonly allowed: true } & T)
  | {
      readonly allowed: false;
      readonly reasonCode: "forbidden" | "unavailable";
    };
export interface AdminQueryPort {
  listLatePayments(
    input: LatePaymentQuery & { sessionIdHash: string },
  ): Promise<AdminReadResult<{ items: LatePaymentSummary[] }>>;
  getLatePayment(input: {
    sessionIdHash: string;
    errorId: string;
  }): Promise<AdminReadResult<{ item: LatePaymentDetail | null }>>;
}
export interface AdminDependencies {
  readonly workflows: AdminWorkflowPort;
  readonly queries?: AdminQueryPort;
}
export interface AdminService {
  listLatePayments?(
    principal: AdminPrincipal,
    input: LatePaymentQuery,
  ): Promise<AdminReadResult<{ items: LatePaymentSummary[] }>>;
  getLatePayment?(
    principal: AdminPrincipal,
    input: { errorId: string },
  ): Promise<AdminReadResult<{ item: LatePaymentDetail | null }>>;
  createClient(
    principal: AdminPrincipal,
    command: ClientLifecycleCommand,
  ): Promise<ClientWorkflowResult>;
  deactivateClient(
    principal: AdminPrincipal,
    command: ClientLifecycleCommand,
  ): Promise<ClientWorkflowResult>;
  grantPackage(
    principal: AdminPrincipal,
    command: GrantPackageCommand,
  ): Promise<PackageGrantWorkflowResult>;
  grantIntroPackage(
    principal: AdminPrincipal,
    command: GrantPackageCommand,
  ): Promise<PackageGrantWorkflowResult>;
  revokePackage(
    principal: AdminPrincipal,
    command: RevokePackageCommand,
  ): Promise<PackageRevokeWorkflowResult>;
  updateExpertVerification(
    principal: AdminPrincipal,
    command: ExpertVerificationCommand,
  ): Promise<ObjectWorkflowResult>;
  updateService(
    principal: AdminPrincipal,
    command: ServiceAdminCommand,
  ): Promise<ObjectWorkflowResult>;
  resolveIntegrationError(
    principal: AdminPrincipal,
    command: ResolveIntegrationErrorCommand,
  ): Promise<IntegrationWorkflowResult>;
  resolveAlert(
    principal: AdminPrincipal,
    command: ResolveAlertCommand,
  ): Promise<AlertWorkflowResult>;
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

export const createAdminService = ({
  workflows,
  queries,
}: AdminDependencies): AdminService => ({
  async listLatePayments(principal, input) {
    if (!principal.roles.includes("support"))
      return { allowed: false, reasonCode: "forbidden" };
    if (!queries) return { allowed: false, reasonCode: "unavailable" };
    return queries.listLatePayments({
      ...input,
      sessionIdHash: principal.sessionIdHash,
    });
  },
  async getLatePayment(principal, input) {
    if (!principal.roles.includes("support"))
      return { allowed: false, reasonCode: "forbidden" };
    if (!queries) return { allowed: false, reasonCode: "unavailable" };
    return queries.getLatePayment({
      ...input,
      sessionIdHash: principal.sessionIdHash,
    });
  },
  async createClient(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    return workflows.createClient({
      ...authorization(principal, command),
      userId: command.userId,
    });
  },
  async deactivateClient(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    return workflows.deactivateClient({
      ...authorization(principal, command),
      userId: command.userId,
    });
  },
  async grantPackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    if (![500, 1000, 1500, 2000].includes(command.units))
      throw new Error("Package size is not allowed");
    return workflows.grantPackage({
      ...authorization(principal, command),
      userId: command.userId,
      units: command.units as 500 | 1000 | 1500 | 2000,
      idempotencyKey: command.idempotencyKey,
    });
  },
  async grantIntroPackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    if (command.units !== 100)
      throw new Error("Intro package must contain exactly 100 units");
    return workflows.grantIntroPackage({
      ...authorization(principal, command),
      userId: command.userId,
      units: 100,
      idempotencyKey: command.idempotencyKey,
    });
  },
  async revokePackage(principal, command) {
    exactTarget(command.routeObjectId, command.userId);
    return workflows.revokePackage({
      ...authorization(principal, command),
      userId: command.userId,
      packageId: command.packageId,
      idempotencyKey: command.idempotencyKey,
    });
  },
  async updateExpertVerification(principal, command) {
    exactTarget(command.routeObjectId, command.expertId);
    const input = {
      ...authorization(principal, command),
      expertId: command.expertId,
    };
    return command.verified
      ? workflows.verifyExpert(input)
      : workflows.suspendExpert(input);
  },
  async updateService(principal, command) {
    exactTarget(command.routeObjectId, command.serviceId);
    const input = {
      ...authorization(principal, command),
      serviceId: command.serviceId,
    };
    return command.active
      ? workflows.activateService(input)
      : workflows.deactivateService(input);
  },
  async resolveIntegrationError(principal, command) {
    exactTarget(command.routeObjectId, command.errorId);
    return workflows.resolveIntegrationError({
      ...authorization(principal, command),
      errorId: command.errorId,
    });
  },
  async resolveAlert(principal, command) {
    exactTarget(command.routeObjectId, command.alertId);
    const input = {
      ...authorization(principal, command),
      alertId: command.alertId,
    };
    if (command.alertType === "safety" && command.resolution === "acknowledge")
      return workflows.acknowledgeSafetyAlert(input);
    if (command.alertType === "safety")
      return workflows.resolveSafetyAlert(input);
    if (command.resolution === "acknowledge")
      return workflows.acknowledgeNegativeFeedback(input);
    return workflows.resolveNegativeFeedback(input);
  },
});
