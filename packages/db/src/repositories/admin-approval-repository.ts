import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

export type AdminRole =
  | "support"
  | "catalog_admin"
  | "entitlement_admin"
  | "security_admin";
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
  | "feedback.resolve";

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
};

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
