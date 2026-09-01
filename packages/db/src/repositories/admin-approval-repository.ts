import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type AdminRole =
  | "support"
  | "catalog_admin"
  | "entitlement_admin"
  | "security_admin";

export const expertReferralApprovalActions = [
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

export type ExpertReferralApprovalAction =
  (typeof expertReferralApprovalActions)[number];

export type ApprovalAdminAction =
  | "client.create"
  | "client.deactivate"
  | "package.grant"
  | "package.intro_grant"
  | "package.revoke"
  | "expert.verify"
  | "expert.suspend"
  | "service.activate"
  | "service.deactivate"
  | "integration_error.resolve"
  | "safety.read"
  | "safety.resolve"
  | "feedback.read"
  | "feedback.resolve"
  | ExpertReferralApprovalAction;

type JsonScalar = string | number | boolean | null;
export type AdminPayload =
  | JsonScalar
  | readonly AdminPayload[]
  | { readonly [key: string]: AdminPayload | undefined };

export interface ResolvedAdminPrincipal {
  readonly id: string;
  readonly sessionIdHash: string;
  readonly roles: readonly AdminRole[];
  readonly mfaVerifiedAt: Date;
}

export interface RequestAdminApproval {
  readonly sessionIdHash: string;
  readonly action: ApprovalAdminAction;
  readonly objectType: string;
  readonly objectId: string;
  readonly payload: AdminPayload;
  readonly nonce: string;
}

export interface ApproveAdminApproval {
  readonly approvalId: string;
  readonly sessionIdHash: string;
}

export interface ConsumeAdminApproval extends RequestAdminApproval {
  readonly approvalId: string;
}

export interface ConsumedAdminApproval {
  readonly approvalId: string;
  readonly requesterId: string;
  readonly approverId: string;
  readonly action: ApprovalAdminAction;
  readonly objectType: string;
  readonly objectId: string;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly consumedAt: Date;
}

export interface CreateExpertReferralIssuanceOverride {
  readonly sessionIdHash: string;
  readonly overrideId: string;
  readonly inviterExpertId: string;
  readonly additionalQuota: number;
  readonly reason: string;
  readonly validFrom: Date;
  readonly expiresAt: Date;
  readonly approvalId: string;
  readonly nonce: string;
  readonly secondApprovalId: string;
  readonly secondNonce: string;
}

export interface CreatedExpertReferralIssuanceOverride {
  readonly overrideId: string;
  readonly inviterExpertId: string;
  readonly additionalQuota: number;
  readonly consumedCount: number;
  readonly expiresAt: Date;
}

const actionRoles: Readonly<Record<ApprovalAdminAction, AdminRole>> = {
  "client.create": "support",
  "client.deactivate": "support",
  "package.grant": "entitlement_admin",
  "package.intro_grant": "entitlement_admin",
  "package.revoke": "entitlement_admin",
  "expert.verify": "catalog_admin",
  "expert.suspend": "catalog_admin",
  "service.activate": "catalog_admin",
  "service.deactivate": "catalog_admin",
  "integration_error.resolve": "support",
  "safety.read": "security_admin",
  "safety.resolve": "security_admin",
  "feedback.read": "support",
  "feedback.resolve": "support",
  "expert_referral.batch_generate": "entitlement_admin",
  "expert_referral.code_revoke": "entitlement_admin",
  "expert_referral.issuance_override": "entitlement_admin",
  "expert_referral.abuse_hold_open": "entitlement_admin",
  "expert_referral.abuse_hold_close": "entitlement_admin",
  "expert_residency.tariff_create": "entitlement_admin",
  "expert_residency.tariff_retire": "entitlement_admin",
  "expert_referral.hold_replay": "entitlement_admin",
  "expert_referral.feature_switch": "entitlement_admin",
};

export const requiredApprovalRole = (
  action: ApprovalAdminAction,
): AdminRole => actionRoles[action];

const readObjectTypes: Readonly<
  Partial<Record<ApprovalAdminAction, "safety_case" | "feedback_queue">>
> = {
  "safety.read": "safety_case",
  "safety.resolve": "safety_case",
  "feedback.read": "feedback_queue",
  "feedback.resolve": "feedback_queue",
};

export const requiredApprovalObjectType = (
  action: ApprovalAdminAction,
): "safety_case" | "feedback_queue" | null => readObjectTypes[action] ?? null;

function canonicalize(value: AdminPayload | undefined): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Unsupported admin payload number");
    return JSON.stringify(value);
  }
  if (value === undefined) throw new Error("Unsupported admin payload value");
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Unsupported admin payload object");
  }
  const record = value as { readonly [key: string]: AdminPayload | undefined };
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(record[key])}`
  ).join(",")}}`;
}

export const canonicalAdminPayload = (payload: AdminPayload): string =>
  canonicalize(payload);

export const canonicalAdminPayloadHash = (payload: AdminPayload): string =>
  `sha256:${createHash("sha256").update(canonicalAdminPayload(payload)).digest("hex")}`;

interface PrincipalRow extends Record<string, unknown> {
  id: string;
  sessionIdHash: string;
  mfaVerifiedAt: Date;
  roles: AdminRole[];
}

interface ApprovalRow extends Record<string, unknown> {
  approvalId: string;
  requesterId: string;
  approverId: string;
  action: ApprovalAdminAction;
  objectType: string;
  objectId: string;
  payloadHash: string;
  nonce: string;
  consumedAt: Date;
}

interface OverrideApprovalRow extends Record<string, unknown> {
  approvalId: string;
  action: ApprovalAdminAction;
  objectType: string;
  objectId: string;
  requesterId: string;
  requesterSessionIdHash: string;
  approverId: string;
  payloadHash: string;
  nonce: string;
  requiredRole: AdminRole;
  approved: boolean;
  consumed: boolean;
  approvalCurrent: boolean;
  requesterSessionCurrent: boolean;
  requesterSessionAdminId: string;
  requesterMfaMatches: boolean;
  requesterHasRole: boolean;
  approverSessionCurrent: boolean;
  approverSessionAdminId: string;
  approverMfaMatches: boolean;
  approverHasRole: boolean;
}

interface CreatedExpertReferralIssuanceOverrideRow
  extends CreatedExpertReferralIssuanceOverride, Record<string, unknown> {}

export class PostgresAdminApprovalRepository {
  constructor(private readonly db: DrizzleDb) {}

  async resolvePrincipal(
    sessionIdHash: string,
  ): Promise<ResolvedAdminPrincipal | null> {
    const result = await this.db.execute<PrincipalRow>(sql`
      select
        s.admin_id as id,
        s.session_id_hash as "sessionIdHash",
        s.mfa_verified_at as "mfaVerifiedAt",
        array_agg(r.role order by r.role) as roles
      from admin_sessions s
      join admin_role_assignments r on r.admin_id = s.admin_id
      cross join lateral (select clock_timestamp() as db_now) c
      where s.session_id_hash = ${sessionIdHash}
        and s.revoked_at is null
        and s.expires_at > c.db_now
        and s.mfa_verified_at <= c.db_now
        and s.mfa_verified_at >= c.db_now - interval '15 minutes'
      group by s.admin_id, s.session_id_hash, s.mfa_verified_at
    `);
    return result.rows[0] ?? null;
  }

  async requestApproval(
    input: RequestAdminApproval,
  ): Promise<{ approvalId: string; expiresAt: Date } | null> {
    const requiredRole = actionRoles[input.action];
    const requiredObjectType = requiredApprovalObjectType(input.action);
    const payloadHash = canonicalAdminPayloadHash(input.payload);
    const assignmentGate = requiredObjectType === null
      ? sql`true`
      : sql`
          ${input.objectType} = ${requiredObjectType}
          and exists (
            select 1 from admin_object_assignments oa
            where oa.admin_id = s.admin_id
              and oa.object_type = ${requiredObjectType}
              and oa.object_id = ${input.objectId}::uuid
          )
        `;
    const result = await this.db.execute<{ approvalId: string; expiresAt: Date }>(sql`
      with db_clock as (
        select clock_timestamp() as db_now
      ),
      requester as (
        select s.admin_id, s.session_id_hash, s.mfa_verified_at, c.db_now
        from admin_sessions s
        join admin_role_assignments r
          on r.admin_id = s.admin_id and r.role = ${requiredRole}
        cross join db_clock c
        where s.session_id_hash = ${input.sessionIdHash}
          and s.revoked_at is null
          and s.expires_at > c.db_now
          and s.mfa_verified_at <= c.db_now
          and s.mfa_verified_at >= c.db_now - interval '15 minutes'
          and ${assignmentGate}
      )
      insert into admin_approvals (
        action, object_type, object_id, requester_id,
        requester_session_id_hash, payload_hash, required_role,
        requester_mfa_verified_at, expires_at, nonce, created_at
      )
      select
        ${input.action}, ${input.objectType}, ${input.objectId}::uuid, r.admin_id,
        r.session_id_hash, ${payloadHash}, ${requiredRole},
        r.mfa_verified_at, r.db_now + interval '5 minutes', ${input.nonce}, r.db_now
      from requester r
      on conflict (
        action, object_type, object_id, requester_id, nonce
      ) where requester_session_id_hash <> 'legacy-unbound'
      do nothing
      returning id as "approvalId", expires_at as "expiresAt"
    `);
    if (result.rows[0] !== undefined) return result.rows[0];

    const replay = await this.db.execute<{
      approvalId: string;
      expiresAt: Date;
      payloadHash: string;
      requesterSessionIdHash: string;
      requiredRole: string;
    }>(sql`
      select
        a.id as "approvalId", a.expires_at as "expiresAt",
        a.payload_hash as "payloadHash",
        a.requester_session_id_hash as "requesterSessionIdHash",
        a.required_role as "requiredRole"
      from admin_approvals a
      join admin_sessions s on s.admin_id = a.requester_id
      cross join lateral (select clock_timestamp() as db_now) c
      where s.session_id_hash = ${input.sessionIdHash}
        and s.revoked_at is null
        and s.expires_at > c.db_now
        and s.mfa_verified_at <= c.db_now
        and s.mfa_verified_at >= c.db_now - interval '15 minutes'
        and ${assignmentGate}
        and a.action = ${input.action}
        and a.object_type = ${input.objectType}
        and a.object_id = ${input.objectId}::uuid
        and a.nonce = ${input.nonce}
        and a.consumed_at is null
        and a.expires_at > c.db_now
    `);
    const row = replay.rows[0];
    if (
      row === undefined ||
      row.payloadHash !== payloadHash ||
      row.requesterSessionIdHash !== input.sessionIdHash ||
      row.requiredRole !== requiredRole
    ) return null;
    return { approvalId: row.approvalId, expiresAt: row.expiresAt };
  }

  async approveApproval(input: ApproveAdminApproval): Promise<boolean> {
    const result = await this.db.execute<{ approvalId: string }>(sql`
      with db_clock as (
        select clock_timestamp() as db_now
      ),
      approver as (
        select s.admin_id, s.session_id_hash, s.mfa_verified_at, c.db_now
        from admin_sessions s
        cross join db_clock c
        where s.session_id_hash = ${input.sessionIdHash}
          and s.revoked_at is null
          and s.expires_at > c.db_now
          and s.mfa_verified_at <= c.db_now
          and s.mfa_verified_at >= c.db_now - interval '15 minutes'
      )
      update admin_approvals a
      set
        approver_id = p.admin_id,
        approver_session_id_hash = p.session_id_hash,
        approver_mfa_verified_at = p.mfa_verified_at,
        approved_at = p.db_now
      from approver p
      where a.id = ${input.approvalId}::uuid
        and a.approver_id is null
        and a.consumed_at is null
        and a.expires_at > p.db_now
        and a.requester_id <> p.admin_id
        and exists (
          select 1 from admin_role_assignments r
          where r.admin_id = p.admin_id and r.role = a.required_role
        )
      returning a.id as "approvalId"
    `);
    return result.rows.length === 1;
  }

  async createIssuanceOverride(
    input: CreateExpertReferralIssuanceOverride,
  ): Promise<CreatedExpertReferralIssuanceOverride | null> {
    if (
      !Number.isInteger(input.additionalQuota) ||
      input.additionalQuota < 1 ||
      input.additionalQuota > 1000 ||
      input.reason.trim().length === 0 ||
      input.reason.length > 200 ||
      !Number.isFinite(input.validFrom.getTime()) ||
      !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt <= input.validFrom ||
      input.approvalId === input.secondApprovalId ||
      input.nonce === input.secondNonce
    )
      return null;
    const payload = {
      inviterExpertId: input.inviterExpertId,
      additionalQuota: input.additionalQuota,
      reason: input.reason,
      validFrom: input.validFrom.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
    };
    const payloadHash = canonicalAdminPayloadHash(payload);
    return this.db.transaction(async (tx) => {
      const approvals = (
        await tx.execute<OverrideApprovalRow>(sql`
          select a.id as "approvalId", a.action,
            a.object_type as "objectType", a.object_id as "objectId",
            a.requester_id as "requesterId",
            a.requester_session_id_hash as "requesterSessionIdHash",
            a.approver_id as "approverId", a.payload_hash as "payloadHash",
            a.nonce, a.required_role as "requiredRole",
            a.approved_at is not null as approved,
            a.consumed_at is not null as consumed,
            a.expires_at > clock_timestamp() as "approvalCurrent",
            requester_session.revoked_at is null
              and requester_session.expires_at > clock_timestamp()
              and requester_session.mfa_verified_at <= clock_timestamp()
              and requester_session.mfa_verified_at >= clock_timestamp() - interval '15 minutes'
              as "requesterSessionCurrent",
            requester_session.admin_id as "requesterSessionAdminId",
            requester_session.mfa_verified_at = a.requester_mfa_verified_at
              as "requesterMfaMatches",
            exists(select 1 from admin_role_assignments requester_role
              where requester_role.admin_id = a.requester_id
                and requester_role.role = a.required_role) as "requesterHasRole",
            approver_session.revoked_at is null
              and approver_session.expires_at > clock_timestamp()
              and approver_session.mfa_verified_at <= clock_timestamp()
              and approver_session.mfa_verified_at >= clock_timestamp() - interval '15 minutes'
              as "approverSessionCurrent",
            approver_session.admin_id as "approverSessionAdminId",
            approver_session.mfa_verified_at = a.approver_mfa_verified_at
              as "approverMfaMatches",
            exists(select 1 from admin_role_assignments approver_role
              where approver_role.admin_id = a.approver_id
                and approver_role.role = a.required_role) as "approverHasRole"
          from admin_approvals a
          join admin_sessions requester_session
            on requester_session.session_id_hash = a.requester_session_id_hash
          join admin_sessions approver_session
            on approver_session.session_id_hash = a.approver_session_id_hash
          where a.id in (${input.approvalId}::uuid, ${input.secondApprovalId}::uuid)
          order by a.id
          for update of a, requester_session, approver_session
        `)
      ).rows;
      const byId = new Map(approvals.map((row) => [row.approvalId, row]));
      const first = byId.get(input.approvalId);
      const second = byId.get(input.secondApprovalId);
      const valid = (
        row: OverrideApprovalRow | undefined,
        nonce: string,
      ): row is OverrideApprovalRow =>
        row !== undefined &&
        row.action === "expert_referral.issuance_override" &&
        row.objectType === "expert" &&
        row.objectId === input.overrideId &&
        row.requesterSessionIdHash === input.sessionIdHash &&
        row.requesterSessionAdminId === row.requesterId &&
        row.requesterMfaMatches &&
        row.payloadHash === payloadHash &&
        row.nonce === nonce &&
        row.requiredRole === "entitlement_admin" &&
        row.approved &&
        !row.consumed &&
        row.approvalCurrent &&
        row.requesterSessionCurrent &&
        row.requesterHasRole &&
        row.approverId !== row.requesterId &&
        row.approverSessionAdminId === row.approverId &&
        row.approverMfaMatches &&
        row.approverSessionCurrent &&
        row.approverHasRole;
      if (
        !valid(first, input.nonce) ||
        !valid(second, input.secondNonce) ||
        first.requesterId !== second.requesterId ||
        first.approverId === second.approverId
      )
        return null;
      const consumed = await tx.execute(sql`
        update admin_approvals set consumed_at = clock_timestamp()
        where id in (${input.approvalId}::uuid, ${input.secondApprovalId}::uuid)
          and consumed_at is null
        returning id
      `);
      if (consumed.rows.length !== 2) return null;
      const inserted = (
        await tx.execute<CreatedExpertReferralIssuanceOverrideRow>(sql`
          insert into expert_referral_issuance_overrides (
            id, inviter_expert_id, additional_quota, reason, valid_from,
            expires_at, requested_by_admin_id, requester_session_id_hash,
            first_approver_id, second_approver_id,
            first_approval_id, second_approval_id
          ) values (
            ${input.overrideId}::uuid, ${input.inviterExpertId}::uuid,
            ${input.additionalQuota}, ${input.reason}, ${input.validFrom},
            ${input.expiresAt}, ${first.requesterId}::uuid,
            ${input.sessionIdHash}, ${first.approverId}::uuid,
            ${second.approverId}::uuid, ${input.approvalId}::uuid,
            ${input.secondApprovalId}::uuid
          )
          returning id as "overrideId", inviter_expert_id as "inviterExpertId",
            additional_quota as "additionalQuota", consumed_count as "consumedCount",
            expires_at as "expiresAt"
        `)
      ).rows[0];
      if (inserted === undefined)
        throw new Error("issuance_override_insert_failed");
      await tx.execute(sql`
        insert into audit_events (
          actor_type, actor_id, authenticated_session_id_hash, action,
          object_type, object_id, decision, reason_code, correlation_id,
          occurred_at, metadata_hash
        ) values (
          'admin', ${first.requesterId}::uuid, ${input.sessionIdHash},
          'expert_referral.issuance_override', 'expert_referral_issuance_override',
          ${input.overrideId}::uuid, 'allow', ${input.reason},
          ${`approvals:${input.approvalId}:${input.secondApprovalId}`},
          clock_timestamp(), ${payloadHash}
        )
      `);
      return {
        ...inserted,
        expiresAt: new Date(inserted.expiresAt),
      };
    });
  }

  async consumeApproval(
    input: ConsumeAdminApproval,
  ): Promise<ConsumedAdminApproval | null> {
    const requiredRole = actionRoles[input.action];
    const requiredObjectType = requiredApprovalObjectType(input.action);
    const payloadHash = canonicalAdminPayloadHash(input.payload);
    const assignmentGate = requiredObjectType === null
      ? sql`true`
      : sql`
          ${input.objectType} = ${requiredObjectType}
          and exists (
            select 1 from admin_object_assignments oa
            where oa.admin_id = s.admin_id
              and oa.object_type = ${requiredObjectType}
              and oa.object_id = ${input.objectId}::uuid
          )
        `;
    const result = await this.db.execute<ApprovalRow>(sql`
      with db_clock as (
        select clock_timestamp() as db_now
      ),
      requester as (
        select s.admin_id, s.session_id_hash, s.mfa_verified_at, c.db_now
        from admin_sessions s
        join admin_role_assignments r
          on r.admin_id = s.admin_id and r.role = ${requiredRole}
        cross join db_clock c
        where s.session_id_hash = ${input.sessionIdHash}
          and s.revoked_at is null
          and s.expires_at > c.db_now
          and s.mfa_verified_at <= c.db_now
          and s.mfa_verified_at >= c.db_now - interval '15 minutes'
          and ${assignmentGate}
      )
      update admin_approvals a
      set consumed_at = r.db_now
      from requester r
      where a.id = ${input.approvalId}::uuid
        and a.requester_id = r.admin_id
        and a.requester_session_id_hash = r.session_id_hash
        and a.requester_mfa_verified_at = r.mfa_verified_at
        and a.approver_id is not null
        and a.approver_id <> a.requester_id
        and a.approver_session_id_hash is not null
        and a.approver_mfa_verified_at is not null
        and a.approver_mfa_verified_at <= r.db_now
        and a.approver_mfa_verified_at >= r.db_now - interval '15 minutes'
        and exists (
          select 1 from admin_sessions s
          join admin_role_assignments ar
            on ar.admin_id = s.admin_id and ar.role = a.required_role
          where s.session_id_hash = a.approver_session_id_hash
            and s.admin_id = a.approver_id
            and s.mfa_verified_at = a.approver_mfa_verified_at
            and s.mfa_verified_at <= r.db_now
            and s.mfa_verified_at >= r.db_now - interval '15 minutes'
            and s.revoked_at is null
            and s.expires_at > r.db_now
        )
        and a.action = ${input.action}
        and a.object_type = ${input.objectType}
        and a.object_id = ${input.objectId}::uuid
        and a.payload_hash = ${payloadHash}
        and a.required_role = ${requiredRole}
        and a.nonce = ${input.nonce}
        and a.consumed_at is null
        and a.expires_at > r.db_now
      returning
        a.id as "approvalId", a.requester_id as "requesterId",
        a.approver_id as "approverId", a.action,
        a.object_type as "objectType", a.object_id as "objectId",
        a.payload_hash as "payloadHash", a.nonce,
        a.consumed_at as "consumedAt"
    `);
    return result.rows[0] ?? null;
  }

  async validateConsumedApprovalReplay(
    input: ConsumeAdminApproval,
  ): Promise<ConsumedAdminApproval | null> {
    const requiredRole = actionRoles[input.action];
    const requiredObjectType = requiredApprovalObjectType(input.action);
    const payloadHash = canonicalAdminPayloadHash(input.payload);
    const assignmentGate = requiredObjectType === null
      ? sql`true`
      : sql`
          ${input.objectType} = ${requiredObjectType}
          and exists (
            select 1 from admin_object_assignments oa
            where oa.admin_id = requester.admin_id
              and oa.object_type = ${requiredObjectType}
              and oa.object_id = ${input.objectId}::uuid
          )
        `;
    const result = await this.db.execute<ApprovalRow>(sql`
      with db_clock as (
        select clock_timestamp() as db_now
      ),
      requester as (
        select s.admin_id, s.session_id_hash, s.mfa_verified_at, c.db_now
        from admin_sessions s
        join admin_role_assignments r
          on r.admin_id = s.admin_id and r.role = ${requiredRole}
        cross join db_clock c
        where s.session_id_hash = ${input.sessionIdHash}
          and s.revoked_at is null
          and s.expires_at > c.db_now
          and s.mfa_verified_at <= c.db_now
          and s.mfa_verified_at >= c.db_now - interval '15 minutes'
      )
      select
        a.id as "approvalId", a.requester_id as "requesterId",
        a.approver_id as "approverId", a.action,
        a.object_type as "objectType", a.object_id as "objectId",
        a.payload_hash as "payloadHash", a.nonce,
        a.consumed_at as "consumedAt"
      from admin_approvals a
      join requester
        on requester.admin_id = a.requester_id
        and requester.session_id_hash = a.requester_session_id_hash
        and requester.mfa_verified_at = a.requester_mfa_verified_at
      where a.id = ${input.approvalId}::uuid
        and a.action = ${input.action}
        and a.object_type = ${input.objectType}
        and a.object_id = ${input.objectId}::uuid
        and a.payload_hash = ${payloadHash}
        and a.required_role = ${requiredRole}
        and a.nonce = ${input.nonce}
        and a.consumed_at is not null
        and a.approver_id is not null
        and a.approver_id <> a.requester_id
        and a.approver_session_id_hash is not null
        and a.approver_mfa_verified_at is not null
        and a.approver_mfa_verified_at <= requester.db_now
        and a.approver_mfa_verified_at >= requester.db_now - interval '15 minutes'
        and exists (
          select 1
          from admin_sessions approver_session
          join admin_role_assignments approver_role
            on approver_role.admin_id = approver_session.admin_id
            and approver_role.role = a.required_role
          where approver_session.session_id_hash = a.approver_session_id_hash
            and approver_session.admin_id = a.approver_id
            and approver_session.mfa_verified_at = a.approver_mfa_verified_at
            and approver_session.revoked_at is null
            and approver_session.expires_at > requester.db_now
            and approver_session.mfa_verified_at <= requester.db_now
            and approver_session.mfa_verified_at >= requester.db_now - interval '15 minutes'
        )
        and ${assignmentGate}
    `);
    return result.rows[0] ?? null;
  }

  async hasObjectAssignment(input: {
    readonly sessionIdHash: string;
    readonly objectType: "safety_case" | "feedback_queue";
    readonly objectId: string;
  }): Promise<boolean> {
    const result = await this.db.execute<{ assigned: boolean }>(sql`
      select exists (
        select 1
        from admin_sessions s
        join admin_object_assignments a on a.admin_id = s.admin_id
        cross join lateral (select clock_timestamp() as db_now) c
        where s.session_id_hash = ${input.sessionIdHash}
          and s.revoked_at is null
          and s.expires_at > c.db_now
          and s.mfa_verified_at <= c.db_now
          and s.mfa_verified_at >= c.db_now - interval '15 minutes'
          and a.object_type = ${input.objectType}
          and a.object_id = ${input.objectId}::uuid
      ) as assigned
    `);
    return result.rows[0]?.assigned === true;
  }
}
