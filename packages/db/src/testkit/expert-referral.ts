import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  canonicalAdminPayloadHash,
  type AdminPayload,
} from "../repositories/admin-approval-repository.js";
import {
  EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_ACTION,
  EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_OBJECT_TYPE,
  EXPERT_REFERRAL_FEATURE_CONTROL_ID,
  expertReferralFeatureControlApprovalPayload,
} from "../repositories/expert-referral-control-repository.js";
import {
  EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION,
  EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE,
  expertReferralOverrideApprovalPayload,
} from "../repositories/expert-referral-repository.js";
import {
  resetWithImmutableExpertReferralAdminResults,
  startTestPostgres,
  type TestDatabase,
} from "./postgres.js";

export interface ExpertIdentityFixture {
  userId: string;
  expertId: string;
  provider: string;
  externalId: string;
}

export interface ExpertAdminAuditFixture {
  adminId: string;
  approvalId: string;
  nonce: string;
  sessionIdHash: string;
  approverId: string;
  approverSessionIdHash: string;
}

export interface ExpertReferralOverrideFixture {
  overrideId: string;
  approvalOneId: string;
  approvalTwoId: string;
  requesterSessionIdHash: string;
}

export interface ExpertReferralTestDatabase extends TestDatabase {
  createExpertIdentity(input?: {
    active?: boolean;
    verified?: boolean;
    provider?: string;
    externalId?: string;
  }): Promise<ExpertIdentityFixture>;
  createAdminAudit(input: {
    action: string;
    objectId: string;
    adminId?: string;
    sessionIdHash?: string;
    approverId?: string;
    objectType?: string;
    payload?: AdminPayload;
    consumed?: boolean;
    expired?: boolean;
  }): Promise<ExpertAdminAuditFixture>;
  enableExpertReferralCommands(): Promise<void>;
  createFeatureControlApproval(input: {
    expectedVersion: number;
    newCommandsEnabled: boolean;
    rewardGrantsEnabled: boolean;
  }): Promise<ExpertAdminAuditFixture>;
  createDualApprovedOverride(input: {
    inviterExpertId: string;
    additionalQuota: number;
  }): Promise<ExpertReferralOverrideFixture>;
  seedExpertReferralQuotaLimit(inviterExpertId: string): Promise<void>;
  seedFirstSettlement(expertId: string): Promise<void>;
}

function requiredId(
  rows: readonly { id: string }[],
  description: string,
): string {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Expected ${description}`);
  return id;
}

export async function startExpertReferralTestDatabase(): Promise<ExpertReferralTestDatabase> {
  const base = await startTestPostgres();
  await base.migrate();

  const ensureAdminSession = async (
    adminId: string,
    requestedSessionIdHash?: string,
    mfaVerifiedAt = new Date(Date.now() - 3 * 60_000),
  ): Promise<{ sessionIdHash: string; mfaVerifiedAt: Date }> => {
    const sessionIdHash =
      requestedSessionIdHash ?? `session-${randomUUID()}`;
    await base.db.execute(sql`
      insert into admin_role_assignments (admin_id, role)
      values (${adminId}::uuid, 'security_admin')
      on conflict (admin_id, role) do nothing
    `);
    await base.db.execute(sql`
      insert into admin_sessions (
        session_id_hash, admin_id, mfa_verified_at, expires_at
      ) values (
        ${sessionIdHash}, ${adminId}::uuid, ${mfaVerifiedAt},
        transaction_timestamp() + interval '1 hour'
      ) on conflict (session_id_hash) do nothing
    `);
    const stored = await base.db.execute<{
      session_id_hash: string;
      mfa_verified_at: Date;
    }>(sql`
      select session_id_hash, mfa_verified_at
      from admin_sessions
      where session_id_hash = ${sessionIdHash}
        and admin_id = ${adminId}::uuid
    `);
    const session = stored.rows[0];
    if (session === undefined) {
      throw new Error("Expected admin session bound to requested admin");
    }
    return {
      sessionIdHash: session.session_id_hash,
      mfaVerifiedAt: session.mfa_verified_at,
    };
  };

  const createAdminAudit: ExpertReferralTestDatabase["createAdminAudit"] =
    async ({
      action,
      objectId,
      adminId,
      sessionIdHash: requestedSessionIdHash,
      approverId,
      objectType = "expert_referral",
      payload = {},
      consumed = false,
      expired = false,
    }) => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 2 * 60_000);
      const requesterMfaVerifiedAt = new Date(now.getTime() - 3 * 60_000);
      const approverMfaVerifiedAt = new Date(now.getTime() - 3 * 60_000);
      const approvedAt = new Date(now.getTime() - 60_000);
      const expiresAt = new Date(
        now.getTime() + (expired ? -30_000 : 5 * 60_000),
      );
      const resolvedAdminId = adminId ?? (await base.createUser());
      const resolvedApproverId = approverId ?? (await base.createUser());
      const requesterSession = await ensureAdminSession(
        resolvedAdminId,
        requestedSessionIdHash,
        requesterMfaVerifiedAt,
      );
      const approverSession = await ensureAdminSession(
        resolvedApproverId,
        undefined,
        approverMfaVerifiedAt,
      );
      const nonce = randomUUID();
      const approvalId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into admin_approvals (
              action, object_type, object_id, requester_id, approver_id,
              requester_session_id_hash, approver_session_id_hash,
              payload_hash, required_role, requester_mfa_verified_at,
              approver_mfa_verified_at, approved_at, expires_at, nonce,
              consumed_at, created_at
            ) values (
              ${action}, ${objectType}, ${objectId}::uuid,
              ${resolvedAdminId}::uuid, ${resolvedApproverId}::uuid,
              ${requesterSession.sessionIdHash}, ${approverSession.sessionIdHash},
              ${canonicalAdminPayloadHash(payload)}, 'security_admin',
              ${requesterSession.mfaVerifiedAt}, ${approverSession.mfaVerifiedAt},
              ${approvedAt}, ${expiresAt}, ${nonce},
              ${consumed ? now : null}, ${createdAt}
            ) returning id
          `)
        ).rows,
        "admin approval",
      );
      return {
        adminId: resolvedAdminId,
        approvalId,
        nonce,
        sessionIdHash: requesterSession.sessionIdHash,
        approverId: resolvedApproverId,
        approverSessionIdHash: approverSession.sessionIdHash,
      };
    };

  const reset = async (): Promise<void> => {
    await resetWithImmutableExpertReferralAdminResults(base.db, async (tx) => {
      await tx.execute(sql`
        truncate table expert_referral_admin_execution_results,
          expert_referral_feature_controls,
          expert_referral_abuse_holds, expert_referral_issuance_overrides,
          expert_referral_ledger_allocations, expert_referral_ledger_entries,
          expert_referral_reward_grants, expert_first_residency_settlements,
          expert_residency_provider_event_inbox,
          expert_residency_payment_attempts, expert_residency_orders,
          expert_residency_tariff_versions, expert_referrals,
          expert_referral_codes, expert_referral_code_batches cascade
      `);
    });
    await base.reset();
  };

  return {
    ...base,
    reset,
    createAdminAudit,
    async createExpertIdentity(input = {}) {
      const userId = await base.createUser();
      const expertId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into experts (user_id, active, verified)
            values (
              ${userId}::uuid, ${input.active ?? true},
              ${input.verified ?? true}
            ) returning id
          `)
        ).rows,
        "expert",
      );
      const provider = input.provider ?? "telegram";
      const externalId = input.externalId ?? `expert-${randomUUID()}`;
      await base.db.execute(sql`
        insert into channel_identities (user_id, provider, external_id)
        values (${userId}::uuid, ${provider}, ${externalId})
      `);
      return { userId, expertId, provider, externalId };
    },
    async enableExpertReferralCommands() {
      const command = {
        expectedVersion: 0,
        newCommandsEnabled: true,
        rewardGrantsEnabled: false,
      };
      const audit = await createAdminAudit({
        action: EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_ACTION,
        objectType: EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_OBJECT_TYPE,
        objectId: EXPERT_REFERRAL_FEATURE_CONTROL_ID,
        payload: expertReferralFeatureControlApprovalPayload(command),
        consumed: true,
      });
      await base.db.execute(sql`
        insert into expert_referral_feature_controls (
          control_key, version, new_commands_enabled,
          reward_grants_enabled, updated_approval_id,
          updated_admin_session_id_hash
        ) values (
          'expert_referrals', 1, true, false, ${audit.approvalId}::uuid,
          ${audit.sessionIdHash}
        )
      `);
    },
    async createFeatureControlApproval(input) {
      return createAdminAudit({
        action: EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_ACTION,
        objectType: EXPERT_REFERRAL_FEATURE_CONTROL_APPROVAL_OBJECT_TYPE,
        objectId: EXPERT_REFERRAL_FEATURE_CONTROL_ID,
        payload: expertReferralFeatureControlApprovalPayload(input),
      });
    },
    async createDualApprovedOverride({ inviterExpertId, additionalQuota }) {
      const overrideId = randomUUID();
      const requesterId = await base.createUser();
      const approverOneId = await base.createUser();
      const approverTwoId = await base.createUser();
      const requesterSession = await ensureAdminSession(requesterId);
      const reasonCode = "approved_test";
      const validFrom = new Date(Date.now() - 60_000);
      const validUntil = new Date(Date.now() + 60 * 60_000);
      const payload = expertReferralOverrideApprovalPayload({
        overrideId,
        inviterExpertId,
        additionalQuota,
        reasonCode,
        validFrom,
        validUntil,
        requesterId,
        requesterSessionIdHash: requesterSession.sessionIdHash,
      });
      const first = await createAdminAudit({
        action: EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION,
        objectType: EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE,
        objectId: overrideId,
        adminId: requesterId,
        sessionIdHash: requesterSession.sessionIdHash,
        approverId: approverOneId,
        payload,
      });
      const second = await createAdminAudit({
        action: EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION,
        objectType: EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE,
        objectId: overrideId,
        adminId: requesterId,
        sessionIdHash: requesterSession.sessionIdHash,
        approverId: approverTwoId,
        payload,
      });
      await base.db.execute(sql`
        update admin_approvals
        set consumed_at = transaction_timestamp()
        where id in (${first.approvalId}::uuid, ${second.approvalId}::uuid)
          and consumed_at is null
      `);
      await base.db.execute(sql`
        insert into expert_referral_issuance_overrides (
          id, inviter_expert_id, additional_quota, reason_code,
          valid_from, valid_until, requester_id, approver_one_id,
          approver_two_id, approval_one_id, approval_two_id,
          requester_session_id_hash
        ) values (
          ${overrideId}::uuid, ${inviterExpertId}::uuid, ${additionalQuota},
          ${reasonCode}, ${validFrom}, ${validUntil}, ${requesterId}::uuid,
          ${approverOneId}::uuid, ${approverTwoId}::uuid,
          ${first.approvalId}::uuid, ${second.approvalId}::uuid,
          ${requesterSession.sessionIdHash}
        )
      `);
      return {
        overrideId,
        approvalOneId: first.approvalId,
        approvalTwoId: second.approvalId,
        requesterSessionIdHash: requesterSession.sessionIdHash,
      };
    },
    async seedExpertReferralQuotaLimit(inviterExpertId) {
      const audit = await createAdminAudit({
        action: "expert_referral.batch_generate",
        objectId: randomUUID(),
      });
      const batchId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into expert_referral_code_batches (
              inviter_expert_id, requested_count, approval_id,
              issued_by_admin_id, admin_session_id_hash
            ) values (
              ${inviterExpertId}::uuid, 1000, ${audit.approvalId}::uuid,
              ${audit.adminId}::uuid, ${audit.sessionIdHash}
            ) returning id
          `)
        ).rows,
        "expert referral batch",
      );
      await base.db.execute(sql`
        insert into expert_referral_codes (
          batch_id, inviter_expert_id, code_hash, key_version, masked_suffix
        )
        select
          ${batchId}::uuid,
          ${inviterExpertId}::uuid,
          md5(${batchId}::text || generated::text) ||
            md5('hash-' || ${batchId}::text || generated::text),
          1,
          lpad(generated::text, 6, '0')
        from generate_series(1, 1000) generated
      `);
    },
    async seedFirstSettlement(expertId) {
      const tariffAudit = await createAdminAudit({
        action: "expert_residency.tariff_create",
        objectId: randomUUID(),
      });
      const tariffId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into expert_residency_tariff_versions (
              tariff_key, display_name, price_minor, duration_seconds,
              active_from, active_to, approval_id, admin_session_id_hash
            ) values (
              ${`test-${randomUUID()}`}, 'Test residency', 100000, 86400,
              transaction_timestamp() - interval '1 day',
              transaction_timestamp() + interval '1 day',
              ${tariffAudit.approvalId}::uuid, ${tariffAudit.sessionIdHash}
            ) returning id
          `)
        ).rows,
        "tariff",
      );
      const orderId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into expert_residency_orders (
              expert_id, tariff_version_id, snapshot_display_name,
              price_minor, currency, duration_seconds, credit_minor,
              cash_minor, payment_deadline, status, settled_at,
              residency_starts_at, residency_ends_at, idempotency_key
            ) values (
              ${expertId}::uuid, ${tariffId}::uuid, 'Test residency',
              100000, 'RUB', 86400, 0, 100000,
              transaction_timestamp() + interval '1 hour', 'settled',
              transaction_timestamp(), transaction_timestamp(),
              transaction_timestamp() + interval '1 day', ${randomUUID()}
            ) returning id
          `)
        ).rows,
        "residency order",
      );
      const paymentAttemptId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into expert_residency_payment_attempts (
              order_id, provider, provider_request_id,
              expected_amount_minor, currency, status,
              idempotency_key, resolved_at
            ) values (
              ${orderId}::uuid, 'test', ${randomUUID()}, 100000, 'RUB',
              'settled', ${randomUUID()}, transaction_timestamp()
            ) returning id
          `)
        ).rows,
        "payment attempt",
      );
      await base.db.execute(sql`
        insert into expert_first_residency_settlements (
          expert_id, qualifying_order_id, qualifying_payment_attempt_id,
          eligibility, reason_code, settlement_expert_active,
          settlement_expert_verified, settlement_abuse_cleared, settled_at
        ) values (
          ${expertId}::uuid, ${orderId}::uuid, ${paymentAttemptId}::uuid,
          'permanently_ineligible', 'test_prior_settlement', true, true, true,
          transaction_timestamp()
        )
      `);
    },
  };
}
