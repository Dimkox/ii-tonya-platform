import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  PostgresAdminApprovalRepository,
  type AdminPayload,
  type ApprovalAdminAction,
  type ConsumedAdminApproval,
} from "./admin-approval-repository.js";

export interface WorkflowAuthorization {
  readonly sessionIdHash: string;
  readonly approvalId: string;
  readonly nonce: string;
  readonly correlationId: string;
}
export interface ClientAdminCommand extends WorkflowAuthorization { readonly userId: string; }
export interface GrantAdminPackageCommand extends WorkflowAuthorization {
  readonly userId: string;
  readonly units: 500 | 1000 | 1500 | 2000;
  readonly idempotencyKey: string;
}
export interface GrantIntroPackageCommand extends WorkflowAuthorization {
  readonly userId: string;
  readonly units: 100;
  readonly idempotencyKey: string;
}
export interface RevokeAdminPackageCommand extends WorkflowAuthorization {
  readonly userId: string;
  readonly packageId: string;
  readonly idempotencyKey: string;
}
export interface ExpertAdminCommand extends WorkflowAuthorization { readonly expertId: string; }
export interface ServiceAdminCommand extends WorkflowAuthorization { readonly serviceId: string; }
export interface IntegrationErrorAdminCommand extends WorkflowAuthorization { readonly errorId: string; }
export interface AlertAdminCommand extends WorkflowAuthorization { readonly alertId: string; }

export type AdminWorkflowResult<T extends Record<string, unknown> = Record<string, never>> =
  | ({ readonly allowed: true; readonly replayed: boolean } & T)
  | { readonly allowed: false; readonly reasonCode: "approval_denied" };

export class AdminWorkflowConflictError extends Error {
  readonly code = "ADMIN_WORKFLOW_CONFLICT";
  constructor() {
    super("Admin workflow idempotency key conflicts with its original request");
    this.name = "AdminWorkflowConflictError";
  }
}
export class AdminTargetNotFoundError extends Error {
  readonly code = "ADMIN_TARGET_NOT_FOUND";
  constructor() {
    super("Admin workflow target was not found");
    this.name = "AdminTargetNotFoundError";
  }
}

type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
type MutationResult = Record<string, unknown>;

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const objectTypes: Readonly<Record<ApprovalAdminAction, string>> = {
  "client.create": "user",
  "client.deactivate": "user",
  "package.grant": "user",
  "package.intro_grant": "user",
  "package.revoke": "user",
  "expert.verify": "expert",
  "expert.suspend": "expert",
  "service.activate": "service",
  "service.deactivate": "service",
  "integration_error.resolve": "integration_error",
  "safety.read": "safety_case",
  "safety.resolve": "safety_case",
  "feedback.read": "feedback_queue",
  "feedback.resolve": "feedback_queue",
};

export class PostgresAdminRepository {
  constructor(private readonly db: DrizzleDb) {}

  private async appendAudit(
    executor: DrizzleDb | Transaction,
    input: {
      actorId: string;
      sessionIdHash: string;
      action: ApprovalAdminAction;
      objectId: string;
      decision: "allowed" | "denied";
      reasonCode: string;
      correlationId: string;
      approvalId: string;
    },
  ): Promise<void> {
    await executor.execute(sql`
      insert into audit_events (
        actor_type, actor_id, authenticated_session_id_hash, action,
        object_type, object_id, decision, reason_code, correlation_id,
        occurred_at, metadata_hash
      ) values (
        'admin', ${input.actorId}::uuid, ${input.sessionIdHash},
        ${`${input.action}.${input.decision}`}, ${objectTypes[input.action]},
        ${input.objectId}::uuid, ${input.decision}, ${input.reasonCode},
        ${input.correlationId}, clock_timestamp(),
        ${digest(`${input.approvalId}:${input.action}:${input.objectId}:${input.decision}:${input.reasonCode}`)}
      )
    `);
  }

  private async appendDenied(
    command: WorkflowAuthorization,
    action: ApprovalAdminAction,
    objectId: string,
    reasonCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await tx.execute<{ actorId: string }>(sql`
        select admin_id as "actorId"
        from admin_sessions
        where session_id_hash = ${command.sessionIdHash}
      `);
      await this.appendAudit(tx, {
        actorId: actor.rows[0]?.actorId ?? "00000000-0000-0000-0000-000000000000",
        sessionIdHash: command.sessionIdHash,
        action,
        objectId,
        decision: "denied",
        reasonCode,
        correlationId: command.correlationId,
        approvalId: command.approvalId,
      });
    });
  }

  private async executeApproved<T extends MutationResult>(
    command: WorkflowAuthorization,
    binding: {
      action: ApprovalAdminAction;
      objectId: string;
      payload: AdminPayload;
    },
    mutate: (tx: Transaction, approval: ConsumedAdminApproval) => Promise<T>,
    replay?: () => Promise<T | null>,
  ): Promise<AdminWorkflowResult<T>> {
    try {
      const result = await this.db.transaction(async (tx) => {
        const approval = await new PostgresAdminApprovalRepository(
          tx as unknown as DrizzleDb,
        ).consumeApproval({
          approvalId: command.approvalId,
          sessionIdHash: command.sessionIdHash,
          action: binding.action,
          objectType: objectTypes[binding.action],
          objectId: binding.objectId,
          payload: binding.payload,
          nonce: command.nonce,
        });
        if (approval === null) return null;
        const mutated = await mutate(tx, approval);
        await this.appendAudit(tx, {
          actorId: approval.requesterId,
          sessionIdHash: command.sessionIdHash,
          action: binding.action,
          objectId: binding.objectId,
          decision: "allowed",
          reasonCode: "approved_dual_control",
          correlationId: command.correlationId,
          approvalId: approval.approvalId,
        });
        return mutated;
      });
      if (result !== null) return { allowed: true, replayed: false, ...result };
      const replayed = await replay?.();
      if (replayed !== undefined && replayed !== null) {
        return { allowed: true, replayed: true, ...replayed };
      }
      await this.appendDenied(command, binding.action, binding.objectId, "approval_denied");
      return { allowed: false, reasonCode: "approval_denied" };
    } catch (error) {
      await this.appendDenied(command, binding.action, binding.objectId, "workflow_failed");
      throw error;
    }
  }

  async createClient(command: ClientAdminCommand): Promise<AdminWorkflowResult<{ userId: string }>> {
    return this.executeApproved(command, {
      action: "client.create",
      objectId: command.userId,
      payload: { userId: command.userId },
    }, async (tx) => {
      const inserted = await tx.execute<{ userId: string }>(sql`
        insert into users (id, active) values (${command.userId}::uuid, true)
        on conflict (id) do nothing returning id as "userId"
      `);
      if (inserted.rows[0] === undefined) throw new AdminWorkflowConflictError();
      return inserted.rows[0];
    });
  }

  async deactivateClient(command: ClientAdminCommand): Promise<AdminWorkflowResult<{ userId: string }>> {
    return this.executeApproved(command, {
      action: "client.deactivate",
      objectId: command.userId,
      payload: { userId: command.userId },
    }, async (tx) => {
      const changed = await tx.execute<{ userId: string }>(sql`
        update users set active = false, updated_at = clock_timestamp()
        where id = ${command.userId}::uuid and active = true
        returning id as "userId"
      `);
      if (changed.rows[0] === undefined) throw new AdminTargetNotFoundError();
      return changed.rows[0];
    });
  }

  private async findGrantReplay(input: {
    userId: string;
    units: number;
    kind: "admin" | "intro";
    idempotencyKey: string;
    approvalId: string;
    sessionIdHash: string;
  }): Promise<{ packageId: string } | null> {
    const stored = await this.db.execute<{
      packageId: string;
      userId: string;
      units: number;
      kind: string;
      expiresAt: Date | null;
      ledgerDelta: number;
      approvalId: string | null;
      sessionIdHash: string | null;
      requesterId: string | null;
    }>(sql`
      select p.id as "packageId", p.user_id as "userId",
        p.granted_messages as units, p.kind, p.expires_at as "expiresAt",
        l.delta as "ledgerDelta", p.admin_approval_id as "approvalId",
        p.admin_requester_session_id_hash as "sessionIdHash",
        a.requester_id as "requesterId"
      from message_packages p
      join message_ledger_entries l
        on l.package_id = p.id and l.entry_kind = 'grant'
      left join admin_approvals a on a.id = p.admin_approval_id
      where p.grant_idempotency_key = ${input.idempotencyKey}
    `);
    const row = stored.rows[0];
    if (row === undefined) return null;
    const principal = await new PostgresAdminApprovalRepository(this.db)
      .resolvePrincipal(input.sessionIdHash);
    if (principal === null || row.requesterId !== principal.id) return null;
    if (
      row.userId !== input.userId ||
      Number(row.units) !== input.units ||
      row.kind !== input.kind ||
      Number(row.ledgerDelta) !== input.units ||
      row.approvalId !== input.approvalId ||
      row.sessionIdHash !== input.sessionIdHash ||
      (input.kind === "admin" ? row.expiresAt === null : row.expiresAt !== null)
    ) throw new AdminWorkflowConflictError();
    return { packageId: row.packageId };
  }

  private async executeGrant(
    command: GrantAdminPackageCommand | GrantIntroPackageCommand,
    action: "package.grant" | "package.intro_grant",
    kind: "admin" | "intro",
  ): Promise<AdminWorkflowResult<{ packageId: string }>> {
    const payload = {
      userId: command.userId,
      units: command.units,
      idempotencyKey: command.idempotencyKey,
    };
    return this.executeApproved(command, {
      action,
      objectId: command.userId,
      payload,
    }, async (tx, approval) => {
      const packageRow = await tx.execute<{ packageId: string }>(sql`
        insert into message_packages (
          user_id, granted_messages, grant_idempotency_key, kind,
          admin_approval_id, admin_requester_session_id_hash,
          expires_at, granted_at
        )
        select
          ${command.userId}::uuid, ${command.units}, ${command.idempotencyKey},
          ${kind}, ${approval.approvalId}::uuid, ${command.sessionIdHash},
          case when ${kind} = 'admin'
            then c.db_now + interval '60 days' else null end,
          c.db_now
        from (select clock_timestamp() as db_now) c
        on conflict (grant_idempotency_key) do nothing
        returning id as "packageId"
      `);
      const packageId = packageRow.rows[0]?.packageId;
      if (packageId === undefined) throw new AdminWorkflowConflictError();
      await tx.execute(sql`
        insert into message_ledger_entries (
          package_id, entry_kind, delta, idempotency_key,
          admin_approval_id, admin_requester_session_id_hash
        ) values (
          ${packageId}::uuid, 'grant', ${command.units},
          ${`admin:${command.idempotencyKey}:grant`},
          ${approval.approvalId}::uuid, ${command.sessionIdHash}
        )
      `);
      return { packageId };
    }, () => this.findGrantReplay({
      ...payload,
      kind,
      approvalId: command.approvalId,
      sessionIdHash: command.sessionIdHash,
    }));
  }

  async grantPackage(command: GrantAdminPackageCommand): Promise<AdminWorkflowResult<{ packageId: string }>> {
    return this.executeGrant(command, "package.grant", "admin");
  }

  async grantIntroPackage(command: GrantIntroPackageCommand): Promise<AdminWorkflowResult<{ packageId: string }>> {
    return this.executeGrant(command, "package.intro_grant", "intro");
  }

  private async findRevokeReplay(command: RevokeAdminPackageCommand): Promise<{ packageId: string; delta: number; originalEntryId: string } | null> {
    const stored = await this.db.execute<{
      packageId: string;
      userId: string;
      delta: number;
      originalEntryId: string;
      approvalId: string | null;
      sessionIdHash: string | null;
      requesterId: string | null;
    }>(sql`
      select l.package_id as "packageId", p.user_id as "userId",
        l.delta, l.original_entry_id as "originalEntryId",
        l.admin_approval_id as "approvalId",
        l.admin_requester_session_id_hash as "sessionIdHash",
        a.requester_id as "requesterId"
      from message_ledger_entries l
      join message_packages p on p.id = l.package_id
      left join admin_approvals a on a.id = l.admin_approval_id
      where l.idempotency_key = ${command.idempotencyKey}
        and l.entry_kind = 'revocation'
    `);
    const row = stored.rows[0];
    if (row === undefined) return null;
    const principal = await new PostgresAdminApprovalRepository(this.db)
      .resolvePrincipal(command.sessionIdHash);
    if (principal === null || row.requesterId !== principal.id) return null;
    if (
      row.packageId !== command.packageId ||
      row.userId !== command.userId ||
      row.approvalId !== command.approvalId ||
      row.sessionIdHash !== command.sessionIdHash
    ) {
      throw new AdminWorkflowConflictError();
    }
    return { packageId: row.packageId, delta: Number(row.delta), originalEntryId: row.originalEntryId };
  }

  async revokePackage(command: RevokeAdminPackageCommand): Promise<AdminWorkflowResult<{ packageId: string; delta: number; originalEntryId: string }>> {
    const payload = {
      userId: command.userId,
      packageId: command.packageId,
      idempotencyKey: command.idempotencyKey,
    };
    return this.executeApproved(command, {
      action: "package.revoke",
      objectId: command.userId,
      payload,
    }, async (tx, approval) => {
      const locked = await tx.execute<{ packageId: string; userId: string; originalEntryId: string }>(sql`
        select p.id as "packageId", p.user_id as "userId",
          g.id as "originalEntryId"
        from message_packages p
        join message_ledger_entries g
          on g.package_id = p.id and g.entry_kind = 'grant'
        where p.id = ${command.packageId}::uuid
          and p.user_id = ${command.userId}::uuid
        for update of p, g
      `);
      const row = locked.rows[0];
      if (row === undefined) throw new AdminTargetNotFoundError();
      const balance = await tx.execute<{ balance: number }>(sql`
        select coalesce(sum(delta), 0)::integer as balance
        from message_ledger_entries
        where package_id = ${command.packageId}::uuid
      `);
      const remaining = Math.max(0, Number(balance.rows[0]?.balance ?? 0));
      const inserted = await tx.execute<{ delta: number }>(sql`
        insert into message_ledger_entries (
          package_id, entry_kind, delta, original_entry_id, idempotency_key,
          admin_approval_id, admin_requester_session_id_hash
        ) values (
          ${command.packageId}::uuid, 'revocation', ${-remaining},
          ${row.originalEntryId}::uuid, ${command.idempotencyKey},
          ${approval.approvalId}::uuid, ${command.sessionIdHash}
        )
        returning delta
      `);
      return { packageId: row.packageId, delta: Number(inserted.rows[0]!.delta), originalEntryId: row.originalEntryId };
    }, () => this.findRevokeReplay(command));
  }

  private async mutateBooleanTarget(
    command: WorkflowAuthorization,
    binding: { action: ApprovalAdminAction; objectId: string; payload: AdminPayload; table: "experts" | "expert_services"; column: "verified" | "active"; value: boolean },
  ): Promise<AdminWorkflowResult<{ objectId: string }>> {
    return this.executeApproved(command, binding, async (tx) => {
      const changed = binding.table === "experts"
        ? await tx.execute<{ objectId: string }>(sql`
            update experts set ${sql.identifier(binding.column)} = ${binding.value},
              updated_at = clock_timestamp()
            where id = ${binding.objectId}::uuid
            returning id as "objectId"
          `)
        : await tx.execute<{ objectId: string }>(sql`
            update expert_services set active = ${binding.value},
              updated_at = clock_timestamp()
            where id = ${binding.objectId}::uuid
            returning id as "objectId"
          `);
      if (changed.rows[0] === undefined) throw new AdminTargetNotFoundError();
      return changed.rows[0];
    });
  }

  async verifyExpert(command: ExpertAdminCommand) {
    return this.mutateBooleanTarget(command, { action: "expert.verify", objectId: command.expertId, payload: { expertId: command.expertId, verified: true }, table: "experts", column: "verified", value: true });
  }
  async suspendExpert(command: ExpertAdminCommand) {
    return this.mutateBooleanTarget(command, { action: "expert.suspend", objectId: command.expertId, payload: { expertId: command.expertId, verified: false }, table: "experts", column: "verified", value: false });
  }
  async activateService(command: ServiceAdminCommand) {
    return this.mutateBooleanTarget(command, { action: "service.activate", objectId: command.serviceId, payload: { serviceId: command.serviceId, active: true }, table: "expert_services", column: "active", value: true });
  }
  async deactivateService(command: ServiceAdminCommand) {
    return this.mutateBooleanTarget(command, { action: "service.deactivate", objectId: command.serviceId, payload: { serviceId: command.serviceId, active: false }, table: "expert_services", column: "active", value: false });
  }

  async resolveIntegrationError(command: IntegrationErrorAdminCommand): Promise<AdminWorkflowResult<{ errorId: string }>> {
    return this.executeApproved(command, {
      action: "integration_error.resolve",
      objectId: command.errorId,
      payload: { errorId: command.errorId },
    }, async (tx) => {
      const changed = await tx.execute<{ errorId: string }>(sql`
        update integration_errors
        set status = 'resolved', resolved_at = clock_timestamp(),
          updated_at = clock_timestamp()
        where id = ${command.errorId}::uuid and status = 'open'
        returning id as "errorId"
      `);
      if (changed.rows[0] === undefined) throw new AdminTargetNotFoundError();
      const serializedPayload = JSON.stringify({ errorId: command.errorId });
      await tx.execute(sql`
        insert into integration_outbox (
          idempotency_key, topic, payload, correlation_id,
          reconciliation_key, payload_hash
        ) values (
          ${`admin:integration-error:${command.errorId}:resolved`},
          'admin.integration_error_resolved', ${serializedPayload}::jsonb,
          ${command.correlationId},
          ${`integration-error:${command.errorId}`},
          ${digest(serializedPayload)}
        )
      `);
      return changed.rows[0];
    });
  }

  private async recordCaseAction(
    command: AlertAdminCommand,
    input: {
      approvalAction: "safety.resolve" | "feedback.resolve";
      objectType: "safety_alert" | "negative_feedback";
      action: "acknowledge" | "resolve";
    },
  ): Promise<AdminWorkflowResult<{ alertId: string }>> {
    return this.executeApproved(command, {
      action: input.approvalAction,
      objectId: command.alertId,
      payload: { alertId: command.alertId, resolution: input.action },
    }, async (tx, approval) => {
      const target = input.objectType === "safety_alert"
        ? await tx.execute(sql`select 1 from human_escalations where id = ${command.alertId}::uuid`)
        : await tx.execute(sql`select 1 from feedback where id = ${command.alertId}::uuid and escalation_status = 'escalated'`);
      if (target.rows.length !== 1) throw new AdminTargetNotFoundError();
      const inserted = await tx.execute<{ alertId: string }>(sql`
        insert into admin_case_actions (
          object_type, object_id, action, actor_id, approval_id
        ) values (
          ${input.objectType}, ${command.alertId}::uuid, ${input.action},
          ${approval.requesterId}::uuid, ${approval.approvalId}::uuid
        )
        returning object_id as "alertId"
      `);
      return inserted.rows[0]!;
    });
  }

  async acknowledgeSafetyAlert(command: AlertAdminCommand) {
    return this.recordCaseAction(command, { approvalAction: "safety.resolve", objectType: "safety_alert", action: "acknowledge" });
  }
  async resolveSafetyAlert(command: AlertAdminCommand) {
    return this.recordCaseAction(command, { approvalAction: "safety.resolve", objectType: "safety_alert", action: "resolve" });
  }
  async acknowledgeNegativeFeedback(command: AlertAdminCommand) {
    return this.recordCaseAction(command, { approvalAction: "feedback.resolve", objectType: "negative_feedback", action: "acknowledge" });
  }
  async resolveNegativeFeedback(command: AlertAdminCommand) {
    return this.recordCaseAction(command, { approvalAction: "feedback.resolve", objectType: "negative_feedback", action: "resolve" });
  }
}
