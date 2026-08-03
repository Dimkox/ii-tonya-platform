import type { AdminPrincipal } from "./admin-service.js";

export const expertReferralAdminActions = [
  "expert_referral.batch_generate",
  "expert_referral.code_revoke",
  "expert_referral.issuance_override",
  "expert_referral.abuse_hold_open",
  "expert_referral.abuse_hold_close",
  "expert_residency.tariff_create",
  "expert_residency.tariff_retire",
  "expert_referral.hold_replay",
  "expert_referral.feature_switch",
] as const;
export type ExpertReferralAdminAction = typeof expertReferralAdminActions[number];
export const EXPERT_REFERRAL_ADMIN_FEATURE_CONTROL_ID = "00000000-0000-0000-0000-000000000041";
export interface ExpertReferralEnvironmentCeilings { expertReferral: boolean; expertResidencyBilling: boolean }
export type ExpertReferralAdminPayload = Readonly<Record<string, string | number | boolean | undefined>>;
export interface ExpertReferralAdminCommand {
  action: ExpertReferralAdminAction;
  objectId: string;
  approvalId: string;
  secondApprovalId?: string;
  nonce: string;
  secondNonce?: string;
  correlationId: string;
  payload: ExpertReferralAdminPayload;
  environmentCeilings: ExpertReferralEnvironmentCeilings;
}
export interface ExpertReferralAdminWorkflowCommand extends ExpertReferralAdminCommand {
  sessionIdHash: string;
  expectedVersion?: number;
}
export type ExpertReferralAdminWorkflowResult =
  | ({ allowed: true; replayed: boolean } & Record<string, unknown>)
  | { allowed: false; reasonCode: "approval_denied" };
export interface MaskedExpertReferralInventory {
  batchId: string;
  status: string;
  maskedSuffix: string;
  createdAt: Date;
}
export interface ExpertReferralAdminWorkflowPort {
  execute(command: ExpertReferralAdminWorkflowCommand): Promise<ExpertReferralAdminWorkflowResult>;
  inventory(inviterExpertId: string): Promise<MaskedExpertReferralInventory[]>;
}

const invalid = (): never => { throw new Error("invalid_admin_command"); };
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const bounded = (value: unknown, min = 1, max = 128): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const uuid = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const canonicalInstant = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const validInstant = (value: unknown): value is string => {
  if (typeof value !== "string" || !canonicalInstant.test(value)) return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
};

function validate(command: ExpertReferralAdminCommand): void {
  const p = command.payload;
  if (command.objectId !== EXPERT_REFERRAL_ADMIN_FEATURE_CONTROL_ID && !uuid.test(command.objectId)) invalid();
  if (!uuid.test(command.approvalId) || (command.secondApprovalId !== undefined && !uuid.test(command.secondApprovalId))) invalid();
  for (const [key, value] of Object.entries(p)) if (key.endsWith("Id") && (typeof value !== "string" || !uuid.test(value))) invalid();
  if (["expert_referral.batch_generate", "expert_referral.code_revoke", "expert_referral.issuance_override"].includes(command.action) && !command.environmentCeilings.expertReferral) invalid();
  if (["expert_residency.tariff_create", "expert_residency.tariff_retire"].includes(command.action) && !command.environmentCeilings.expertResidencyBilling) invalid();
  if (command.action === "expert_referral.batch_generate") {
    if (!integer(p.count, 1, 1000) || !uuid.test(String(p.inviterExpertId)) || (p.overrideId !== undefined && !uuid.test(String(p.overrideId)))) invalid();
  } else if (command.action === "expert_referral.issuance_override") {
    if (!integer(p.additionalQuota, 1, 1000) || !bounded(p.reasonCode) || !validInstant(p.validFrom) || !validInstant(p.validUntil) || p.validUntil <= p.validFrom || !bounded(command.secondApprovalId) || !bounded(command.secondNonce)) invalid();
  } else if (command.action === "expert_referral.abuse_hold_open" || command.action === "expert_referral.abuse_hold_close") {
    if (!bounded(p.reasonCode, 1, 128)) invalid();
  } else if (command.action === "expert_residency.tariff_create") {
    if (!bounded(p.tariffKey) || !bounded(p.displayName) || !integer(p.priceMinor, 1, Number.MAX_SAFE_INTEGER) || !integer(p.durationSeconds, 1, Number.MAX_SAFE_INTEGER) || !validInstant(p.activeFrom) || !validInstant(p.activeTo) || p.activeTo <= p.activeFrom) invalid();
  } else if (command.action === "expert_residency.tariff_retire") {
    if (!validInstant(p.retiredAt)) invalid();
  } else if (command.action === "expert_referral.feature_switch") {
    if (command.objectId !== EXPERT_REFERRAL_ADMIN_FEATURE_CONTROL_ID) invalid();
    if (!integer(p.expectedVersion, 0, Number.MAX_SAFE_INTEGER) || typeof p.newCommandsEnabled !== "boolean" || typeof p.rewardGrantsEnabled !== "boolean") invalid();
    if (p.newCommandsEnabled && !command.environmentCeilings.expertReferral) invalid();
    if (p.rewardGrantsEnabled && (!command.environmentCeilings.expertReferral || !command.environmentCeilings.expertResidencyBilling)) invalid();
  }
}

export interface ExpertReferralAdminService {
  execute(principal: AdminPrincipal, command: ExpertReferralAdminCommand): Promise<ExpertReferralAdminWorkflowResult>;
  inventory(principal: AdminPrincipal, inviterExpertId: string): Promise<MaskedExpertReferralInventory[]>;
}
export const createExpertReferralAdminService = ({ workflows }: { workflows: ExpertReferralAdminWorkflowPort }): ExpertReferralAdminService => ({
  async execute(principal, command) {
    validate(command);
    return workflows.execute({ ...command, sessionIdHash: principal.sessionIdHash, ...(typeof command.payload.expectedVersion === "number" ? { expectedVersion: command.payload.expectedVersion } : {}) });
  },
  async inventory(principal, inviterExpertId) {
    if (!principal.roles.includes("security_admin") && !principal.roles.includes("entitlement_admin")) invalid();
    if (!uuid.test(inviterExpertId)) invalid();
    return workflows.inventory(inviterExpertId);
  },
});
