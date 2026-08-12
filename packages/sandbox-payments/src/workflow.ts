import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSerializableRetry, type DrizzleDb, type PostgresAdminApprovalRepository } from "@ii-tonya/db";
import type { SandboxProviderEvent } from "./contracts.js";
import type { PostgresSandboxPaymentRepository } from "./repository.js";

export const sandboxAdminActions = ["expert_residency.sandbox_settle", "expert_residency.sandbox_refund"] as const;
export interface SandboxTransitionWorkflowCommand { action: (typeof sandboxAdminActions)[number]; paymentId: string; approvalId: string; nonce: string; sessionIdHash: string; expectedVersion: number; idempotencyKey: string; correlationId: string; }
export type SandboxTransitionWorkflowResult = { allowed: true; replayed: boolean; event: SandboxProviderEvent } | { allowed: false; reasonCode: "approval_denied" };
const digest = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const sandboxApprovalObjectId = (paymentId: string): string => {
  const hex = createHash("sha256").update(`sandbox-payment:${paymentId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export class SandboxTransitionWorkflow {
  constructor(private readonly db: DrizzleDb, private readonly approvals: PostgresAdminApprovalRepository, private readonly payments: PostgresSandboxPaymentRepository) {}
  async execute(command: SandboxTransitionWorkflowCommand): Promise<SandboxTransitionWorkflowResult> {
    const transition = command.action === "expert_residency.sandbox_settle" ? "settled" : "refunded";
    const objectId = sandboxApprovalObjectId(command.paymentId);
    const approvalInput = { approvalId: command.approvalId, sessionIdHash: command.sessionIdHash, action: command.action, objectType: "sandbox_expert_residency_payment", objectId, payload: { paymentId: command.paymentId, transition, expectedVersion: command.expectedVersion, idempotencyKey: command.idempotencyKey }, nonce: command.nonce } as const;
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const consumed = await this.approvals.consumeApprovalInTransaction(tx, approvalInput);
      const replay = consumed ? null : await this.approvals.validateConsumedApprovalReplayInTransaction(tx, approvalInput);
      if (!consumed && !replay) return { allowed: false, reasonCode: "approval_denied" } as const;
      const result = await this.payments.transitionInTransaction(tx, { paymentId: command.paymentId, transition, expectedVersion: command.expectedVersion, idempotencyKey: command.idempotencyKey, correlationId: command.correlationId });
      if (consumed) await tx.execute(sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('admin',${consumed.requesterId}::uuid,${command.sessionIdHash},${command.action},'sandbox_expert_residency_payment',${objectId}::uuid,'allowed','approved_sandbox_transition',${command.correlationId}::uuid,transaction_timestamp(),${digest(`${command.approvalId}:${command.action}:${command.paymentId}:${command.expectedVersion}:${command.idempotencyKey}`)})`);
      return { allowed: true, replayed: !consumed || result.replayed, event: result.event } as const;
    }));
  }
}
