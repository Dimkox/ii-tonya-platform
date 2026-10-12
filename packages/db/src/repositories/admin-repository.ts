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
export interface ClientAdminCommand extends WorkflowAuthorization {
  readonly userId: string;
}
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
export interface ExpertAdminCommand extends WorkflowAuthorization {
  readonly expertId: string;
}
export interface ServiceAdminCommand extends WorkflowAuthorization {
  readonly serviceId: string;
}
export interface IntegrationErrorAdminCommand extends WorkflowAuthorization {
  readonly errorId: string;
}
export interface AlertAdminCommand extends WorkflowAuthorization {
  readonly alertId: string;
}

export type AdminWorkflowResult<
  T extends Record<string, unknown> = Record<string, never>,
> =
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
export class AdminInvalidStateTransitionError extends Error {
  readonly code = "ADMIN_INVALID_STATE_TRANSITION";
  constructor() {
    super("Admin workflow state transition is not allowed");
    this.name = "AdminInvalidStateTransitionError";
  }
}
type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
type MutationResult = Record<string, unknown>;

export const latePaymentReason = "expert_residency_paid_after_deadline";
export const invalidatedCreditPaymentReason =
  "expert_residency_paid_after_credit_invalidation";
// Alias i is the authenticated inbox row. JSON framing and epoch timestamps
// make the binding unambiguous and independent of connection timezone settings.
export const latePaymentBinding = sql`'sha256:' || encode(digest(jsonb_build_array(
  'expert-residency-late-payment-v1', i.id::text, i.provider, i.external_event_id,
  i.payment_id, i.order_id::text, i.amount_minor::text, i.currency,
  i.payload_digest, extract(epoch from i.occurred_at)::text,
  i.verification_id, i.verifier_key_version, extract(epoch from i.verified_at)::text
)::text, 'sha256'), 'hex')`;

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
export interface LatePaymentListInput {
  readonly sessionIdHash: string;
  readonly limit: number;
  readonly status?: string;
  readonly beforeCreatedAt?: string;
  readonly beforeId?: string;
}
type ReadResult<T> =
  | ({ readonly allowed: true } & T)
  | { readonly allowed: false; readonly reasonCode: "forbidden" };
const canonicalUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.exec(
    value,
  )?.[0] === value;
const validCursorTime = (value: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value) ||
    value.length !== 27
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === `${value.slice(0, 23)}Z`
  );
};
const latePaymentProjection = sql`jsonb_build_object(
 'id',e.id,'reasonCode',e.reason_code,'status',e.status,
 'createdAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'updatedAt',to_char(e.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'resolvedAt',to_char(e.resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`;
const supportAuthorization = (
  sessionIdHash: string,
) => sql`select 1 from admin_sessions s
 join admin_role_assignments r on r.admin_id=s.admin_id and r.role='support'
 cross join (select clock_timestamp() as now) c
 where s.session_id_hash=${sessionIdHash} and s.revoked_at is null
 and s.expires_at>c.now and s.mfa_verified_at<=c.now
 and s.mfa_verified_at>=c.now-interval '15 minutes'`;

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const testClockByRepository = new WeakMap<PostgresAdminRepository, Date>();

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
  "expert_referral.batch_generate": "expert",
  "expert_referral.code_revoke": "expert_referral_code",
  "expert_referral.issuance_override": "expert_referral_issuance_override",
  "expert_referral.abuse_hold_open": "expert",
  "expert_referral.abuse_hold_close": "expert",
  "expert_residency.tariff_create": "expert_residency_tariff_version",
  "client_commercial_policy.control_v2": "client_commercial_policy_control",
  "expert_residency.tariff_create_v2": "expert_residency_tariff_version",
  "expert_residency.tariff_retire": "expert_residency_tariff_version",
  "expert_referral.hold_replay": "expert",
  "expert_referral.feature_switch": "expert_referral_feature_control",
  "expert_residency.sandbox_settle": "sandbox_expert_residency_payment",
  "expert_residency.sandbox_refund": "sandbox_expert_residency_payment",
  "selarti_budget.policy_approve": "selarti_budget_policy",
};

export class PostgresAdminRepository {
  constructor(private readonly db: DrizzleDb) {}

  async listLatePayments(
    input: LatePaymentListInput,
  ): Promise<ReadResult<{ items: LatePaymentSummary[] }>> {
    const status = input.status ?? "open";
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !["open", "resolved"].includes(status) ||
      (input.beforeId === undefined) !==
        (input.beforeCreatedAt === undefined) ||
      (input.beforeId !== undefined && !canonicalUuid(input.beforeId)) ||
      (input.beforeCreatedAt !== undefined &&
        !validCursorTime(input.beforeCreatedAt))
    )
      throw new Error("invalid_request");
    const cursor =
      input.beforeId === undefined
        ? sql`true`
        : sql`(e.created_at,e.id)<(${input.beforeCreatedAt}::timestamptz,${input.beforeId}::uuid)`;
    const result = await this.db.execute<{
      authorized: boolean;
      items: LatePaymentSummary[];
    }>(sql`
      with auth as materialized (${supportAuthorization(input.sessionIdHash)}), page as (
        select e.created_at,e.id,${latePaymentProjection} item from integration_errors e
        where exists(select 1 from auth) and e.provider='expert_residency'
        and e.reason_code in (${latePaymentReason},${invalidatedCreditPaymentReason}) and e.status=${status} and ${cursor}
        order by e.created_at desc,e.id desc limit ${input.limit}
      ) select exists(select 1 from auth) authorized,
      coalesce((select jsonb_agg(item order by created_at desc,id desc) from page),'[]'::jsonb) items`);
    const row = result.rows[0];
    return row?.authorized
      ? { allowed: true, items: row.items }
      : { allowed: false, reasonCode: "forbidden" };
  }

  async getLatePayment(input: {
    sessionIdHash: string;
    errorId: string;
  }): Promise<ReadResult<{ item: LatePaymentDetail | null }>> {
    if (!canonicalUuid(input.errorId)) throw new Error("invalid_request");
    const result = await this.db.execute<{
      authorized: boolean;
      item: LatePaymentDetail | null;
    }>(sql`
      with auth as materialized (${supportAuthorization(input.sessionIdHash)})
      select exists(select 1 from auth) authorized, (
        select ${latePaymentProjection} || jsonb_build_object('inboxId',i.id,'orderId',i.order_id,
          'provider',i.provider,'paymentId',i.payment_id,'amountMinor',i.amount_minor,'currency',i.currency)
        from integration_errors e join expert_residency_provider_event_inbox i
          on e.metadata_hash=${latePaymentBinding}
        where exists(select 1 from auth) and e.id=${input.errorId}::uuid
          and e.provider='expert_residency'
          and i.authenticated=true and i.identity_version=1 and i.event_kind='settled'
          and i.status='rejected' and (
            (e.reason_code=${latePaymentReason} and i.result_code='EXPERT_RESIDENCY_PAYMENT_EXPIRED')
            or (e.reason_code=${invalidatedCreditPaymentReason} and i.result_code='EXPERT_RESIDENCY_CREDIT_INVALIDATED')
          )
      ) item`);
    const row = result.rows[0];
    return row?.authorized
      ? { allowed: true, item: row.item }
      : { allowed: false, reasonCode: "forbidden" };
  }

  private grantClock() {
    const testClock = testClockByRepository.get(this);
    return testClock === undefined ? sql`clock_timestamp()` : sql`${testClock}`;
  }

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
        actorId:
          actor.rows[0]?.actorId ?? "00000000-0000-0000-0000-000000000000",
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
      await this.appendDenied(
        command,
        binding.action,
        binding.objectId,
        "approval_denied",
      );
      return { allowed: false, reasonCode: "approval_denied" };
    } catch (error) {
      await this.appendDenied(
        command,
        binding.action,
        binding.objectId,
        "workflow_failed",
      );
      throw error;
    }
  }

  async createClient(
    command: ClientAdminCommand,
  ): Promise<AdminWorkflowResult<{ userId: string }>> {
    return this.executeApproved(
      command,
      {
        action: "client.create",
        objectId: command.userId,
        payload: { userId: command.userId },
      },
      async (tx) => {
        const inserted = await tx.execute<{ userId: string }>(sql`
        insert into users (id, active) values (${command.userId}::uuid, true)
        on conflict (id) do nothing returning id as "userId"
      `);
        if (inserted.rows[0] === undefined)
          throw new AdminWorkflowConflictError();
        return inserted.rows[0];
      },
    );
  }

  async deactivateClient(
    command: ClientAdminCommand,
  ): Promise<AdminWorkflowResult<{ userId: string }>> {
    return this.executeApproved(
      command,
      {
        action: "client.deactivate",
        objectId: command.userId,
        payload: { userId: command.userId },
      },
      async (tx) => {
        const changed = await tx.execute<{ userId: string }>(sql`
        update users set active = false, updated_at = clock_timestamp()
        where id = ${command.userId}::uuid and active = true
        returning id as "userId"
      `);
        if (changed.rows[0] === undefined) throw new AdminTargetNotFoundError();
        return changed.rows[0];
      },
    );
  }

  private async findGrantReplay(input: {
    userId: string;
    units: number;
    kind: "admin" | "intro";
    idempotencyKey: string;
    approvalId: string;
    sessionIdHash: string;
    nonce: string;
    action: "package.grant" | "package.intro_grant";
    payload: AdminPayload;
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
    const approval = await new PostgresAdminApprovalRepository(
      this.db,
    ).validateConsumedApprovalReplay({
      approvalId: input.approvalId,
      sessionIdHash: input.sessionIdHash,
      action: input.action,
      objectType: "user",
      objectId: input.userId,
      payload: input.payload,
      nonce: input.nonce,
    });
    if (approval === null || row.requesterId !== approval.requesterId)
      return null;
    if (
      row.userId !== input.userId ||
      Number(row.units) !== input.units ||
      row.kind !== input.kind ||
      Number(row.ledgerDelta) !== input.units ||
      row.approvalId !== input.approvalId ||
      row.sessionIdHash !== input.sessionIdHash ||
      (input.kind === "admin" ? row.expiresAt === null : row.expiresAt !== null)
    )
      throw new AdminWorkflowConflictError();
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
    return this.executeApproved(
      command,
      {
        action,
        objectId: command.userId,
        payload,
      },
      async (tx, approval) => {
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
            then c.db_now + interval '30 days' else null end,
          c.db_now
        from (select ${this.grantClock()}::timestamptz as db_now) c
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
      },
      () =>
        this.findGrantReplay({
          ...payload,
          kind,
          approvalId: command.approvalId,
          sessionIdHash: command.sessionIdHash,
          nonce: command.nonce,
          action,
          payload,
        }),
    );
  }

  async grantPackage(
    command: GrantAdminPackageCommand,
  ): Promise<AdminWorkflowResult<{ packageId: string }>> {
    return this.executeGrant(command, "package.grant", "admin");
  }

  async grantIntroPackage(
    command: GrantIntroPackageCommand,
  ): Promise<AdminWorkflowResult<{ packageId: string }>> {
    return this.executeGrant(command, "package.intro_grant", "intro");
  }

  private async findRevokeReplay(command: RevokeAdminPackageCommand): Promise<{
    packageId: string;
    delta: number;
    originalEntryId: string;
  } | null> {
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
      join message_ledger_entries g
        on g.id = l.original_entry_id and g.entry_kind = 'grant'
      left join admin_approvals a on a.id = l.admin_approval_id
      where l.idempotency_key = ${command.idempotencyKey}
        and l.entry_kind = 'revocation'
        and p.kind = 'admin'
        and p.legacy_admin_grant = false
        and p.admin_approval_id is not null
        and p.admin_requester_session_id_hash is not null
        and g.admin_approval_id = p.admin_approval_id
        and g.admin_requester_session_id_hash = p.admin_requester_session_id_hash
    `);
    const row = stored.rows[0];
    if (row === undefined) return null;
    const approval = await new PostgresAdminApprovalRepository(
      this.db,
    ).validateConsumedApprovalReplay({
      approvalId: command.approvalId,
      sessionIdHash: command.sessionIdHash,
      action: "package.revoke",
      objectType: "user",
      objectId: command.userId,
      payload: {
        userId: command.userId,
        packageId: command.packageId,
        idempotencyKey: command.idempotencyKey,
      },
      nonce: command.nonce,
    });
    if (approval === null || row.requesterId !== approval.requesterId)
      return null;
    if (
      row.packageId !== command.packageId ||
      row.userId !== command.userId ||
      row.approvalId !== command.approvalId ||
      row.sessionIdHash !== command.sessionIdHash
    ) {
      throw new AdminWorkflowConflictError();
    }
    return {
      packageId: row.packageId,
      delta: Number(row.delta),
      originalEntryId: row.originalEntryId,
    };
  }

  async revokePackage(command: RevokeAdminPackageCommand): Promise<
    AdminWorkflowResult<{
      packageId: string;
      delta: number;
      originalEntryId: string;
    }>
  > {
    const payload = {
      userId: command.userId,
      packageId: command.packageId,
      idempotencyKey: command.idempotencyKey,
    };
    return this.executeApproved(
      command,
      {
        action: "package.revoke",
        objectId: command.userId,
        payload,
      },
      async (tx, approval) => {
        const locked = await tx.execute<{
          packageId: string;
          userId: string;
          originalEntryId: string;
        }>(sql`
        select p.id as "packageId", p.user_id as "userId",
          g.id as "originalEntryId"
        from message_packages p
        join message_ledger_entries g
          on g.package_id = p.id and g.entry_kind = 'grant'
        where p.id = ${command.packageId}::uuid
          and p.user_id = ${command.userId}::uuid
          and p.kind = 'admin'
          and p.legacy_admin_grant = false
          and p.admin_approval_id is not null
          and p.admin_requester_session_id_hash is not null
          and g.admin_approval_id = p.admin_approval_id
          and g.admin_requester_session_id_hash = p.admin_requester_session_id_hash
          and g.legacy_admin_fact = false
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
        return {
          packageId: row.packageId,
          delta: Number(inserted.rows[0]!.delta),
          originalEntryId: row.originalEntryId,
        };
      },
      () => this.findRevokeReplay(command),
    );
  }

  private async mutateBooleanTarget(
    command: WorkflowAuthorization,
    binding: {
      action: ApprovalAdminAction;
      objectId: string;
      payload: AdminPayload;
      table: "experts" | "expert_services";
      column: "verified" | "active";
      value: boolean;
    },
  ): Promise<AdminWorkflowResult<{ objectId: string }>> {
    return this.executeApproved(command, binding, async (tx) => {
      const changed =
        binding.table === "experts"
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
    return this.mutateBooleanTarget(command, {
      action: "expert.verify",
      objectId: command.expertId,
      payload: { expertId: command.expertId, verified: true },
      table: "experts",
      column: "verified",
      value: true,
    });
  }
  async suspendExpert(command: ExpertAdminCommand) {
    return this.mutateBooleanTarget(command, {
      action: "expert.suspend",
      objectId: command.expertId,
      payload: { expertId: command.expertId, verified: false },
      table: "experts",
      column: "verified",
      value: false,
    });
  }
  async activateService(command: ServiceAdminCommand) {
    return this.mutateBooleanTarget(command, {
      action: "service.activate",
      objectId: command.serviceId,
      payload: { serviceId: command.serviceId, active: true },
      table: "expert_services",
      column: "active",
      value: true,
    });
  }
  async deactivateService(command: ServiceAdminCommand) {
    return this.mutateBooleanTarget(command, {
      action: "service.deactivate",
      objectId: command.serviceId,
      payload: { serviceId: command.serviceId, active: false },
      table: "expert_services",
      column: "active",
      value: false,
    });
  }

  async resolveIntegrationError(
    command: IntegrationErrorAdminCommand,
  ): Promise<AdminWorkflowResult<{ errorId: string }>> {
    return this.executeApproved(
      command,
      {
        action: "integration_error.resolve",
        objectId: command.errorId,
        payload: { errorId: command.errorId },
      },
      async (tx) => {
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
      },
    );
  }

  private async recordCaseAction(
    command: AlertAdminCommand,
    input: {
      approvalAction: "safety.resolve" | "feedback.resolve";
      objectType: "safety_alert" | "negative_feedback";
      action: "acknowledge" | "resolve";
    },
  ): Promise<AdminWorkflowResult<{ alertId: string }>> {
    return this.executeApproved(
      command,
      {
        action: input.approvalAction,
        objectId: command.alertId,
        payload: { alertId: command.alertId, resolution: input.action },
      },
      async (tx, approval) => {
        if (input.objectType === "safety_alert") {
          const target = await tx.execute<{ status: string }>(sql`
          select status
          from human_escalations
          where id = ${command.alertId}::uuid
          for update
        `);
          const status = target.rows[0]?.status;
          if (status === undefined) throw new AdminTargetNotFoundError();
          const valid =
            input.action === "acknowledge"
              ? status === "assigned"
              : status === "acknowledged" || status === "escalated";
          if (!valid) throw new AdminInvalidStateTransitionError();
          if (input.action === "acknowledge") {
            await tx.execute(sql`
            update human_escalations
            set status = 'acknowledged',
              acknowledged_at = clock_timestamp(),
              version = version + 1,
              updated_at = clock_timestamp()
            where id = ${command.alertId}::uuid
          `);
          } else {
            await tx.execute(sql`
            update human_escalations
            set status = 'resolved',
              resolved_at = clock_timestamp(),
              version = version + 1,
              updated_at = clock_timestamp()
            where id = ${command.alertId}::uuid
          `);
          }
        } else {
          const target = await tx.execute<{ status: string }>(sql`
          select escalation_status as status
          from feedback
          where id = ${command.alertId}::uuid
          for update
        `);
          const status = target.rows[0]?.status;
          if (status === undefined) throw new AdminTargetNotFoundError();
          const expected =
            input.action === "acknowledge" ? "escalated" : "acknowledged";
          if (status !== expected) throw new AdminInvalidStateTransitionError();
          if (input.action === "acknowledge") {
            await tx.execute(sql`
            update feedback
            set escalation_status = 'acknowledged'
            where id = ${command.alertId}::uuid
          `);
          } else {
            await tx.execute(sql`
            update feedback
            set escalation_status = 'resolved'
            where id = ${command.alertId}::uuid
          `);
          }
        }
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
      },
    );
  }

  async acknowledgeSafetyAlert(command: AlertAdminCommand) {
    return this.recordCaseAction(command, {
      approvalAction: "safety.resolve",
      objectType: "safety_alert",
      action: "acknowledge",
    });
  }
  async resolveSafetyAlert(command: AlertAdminCommand) {
    return this.recordCaseAction(command, {
      approvalAction: "safety.resolve",
      objectType: "safety_alert",
      action: "resolve",
    });
  }
  async acknowledgeNegativeFeedback(command: AlertAdminCommand) {
    return this.recordCaseAction(command, {
      approvalAction: "feedback.resolve",
      objectType: "negative_feedback",
      action: "acknowledge",
    });
  }
  async resolveNegativeFeedback(command: AlertAdminCommand) {
    return this.recordCaseAction(command, {
      approvalAction: "feedback.resolve",
      objectType: "negative_feedback",
      action: "resolve",
    });
  }
}

/** Deep-source testkit seam; deliberately absent from the package root export. */
export const createAdminRepositoryWithClockForTest = (
  db: DrizzleDb,
  now: Date,
): PostgresAdminRepository => {
  const repository = new PostgresAdminRepository(db);
  testClockByRepository.set(repository, new Date(now));
  return repository;
};
