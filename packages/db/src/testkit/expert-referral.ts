import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  canonicalAdminPayloadHash,
  type AdminPayload,
} from "../repositories/admin-approval-repository.js";

export interface ExpertReferralAdminEvidence {
  readonly adminId: string;
  readonly approvalId: string;
  readonly sessionIdHash: string;
}

export const EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID =
  "00000000-0000-4000-8000-000000000018";

export interface ExpertReferralExpertFixture {
  readonly expertId: string;
  readonly userId: string;
  readonly provider: string;
  readonly externalId: string;
}

export class ExpertReferralTestkit {
  constructor(readonly db: DrizzleDb) {}

  async createExpert(
    input: {
      active?: boolean;
      verified?: boolean;
      userActive?: boolean;
      provider?: string;
      externalId?: string;
    } = {},
  ): Promise<ExpertReferralExpertFixture> {
    const userId = randomUUID();
    const expertId = randomUUID();
    const provider = input.provider ?? "telegram";
    const externalId = input.externalId ?? `tg-${randomUUID()}`;
    await this.db.execute(sql`
      insert into users (id, active)
      values (${userId}::uuid, ${input.userActive ?? true})
    `);
    await this.db.execute(sql`
      insert into channel_identities (user_id, provider, external_id)
      values (${userId}::uuid, ${provider}, ${externalId})
    `);
    await this.db.execute(sql`
      insert into experts (id, user_id, active, verified)
      values (
        ${expertId}::uuid,
        ${userId}::uuid,
        ${input.active ?? true},
        ${input.verified ?? true}
      )
    `);
    return { expertId, userId, provider, externalId };
  }

  async createAdminEvidence(
    action = "expert_referral.batch_generate",
    objectId?: string,
    payload: AdminPayload = {},
  ): Promise<ExpertReferralAdminEvidence> {
    const adminId = randomUUID();
    const approverId = randomUUID();
    const approvalId = randomUUID();
    const sessionIdHash = `sha256:${randomUUID()}`;
    const approverSessionIdHash = `sha256:${randomUUID()}`;
    const requesterMfaVerifiedAt = new Date(Date.now() - 60_000);
    const approverMfaVerifiedAt = new Date(Date.now() - 60_000);
    await this.db.execute(sql`
      insert into users (id) values (${adminId}::uuid), (${approverId}::uuid)
    `);
    await this.db.execute(sql`
      insert into admin_sessions (
        session_id_hash, admin_id, mfa_verified_at, expires_at
      ) values
      (
        ${sessionIdHash}, ${adminId}::uuid,
        ${requesterMfaVerifiedAt},
        clock_timestamp() + interval '1 day'
      ),
      (
        ${approverSessionIdHash}, ${approverId}::uuid,
        ${approverMfaVerifiedAt},
        clock_timestamp() + interval '1 day'
      )
    `);
    await this.db.execute(sql`
      insert into admin_role_assignments (admin_id, role)
      values (${adminId}::uuid, 'entitlement_admin'),
        (${approverId}::uuid, 'entitlement_admin')
    `);
    await this.db.execute(sql`
      insert into admin_approvals (
        id, action, object_type, object_id, requester_id, expires_at, nonce
        , requester_session_id_hash, approver_id, approver_session_id_hash,
        payload_hash, required_role, requester_mfa_verified_at,
        approver_mfa_verified_at, approved_at
      ) values (
        ${approvalId}::uuid, ${action},
        ${action === "expert_referral.code_revoke" ? "expert_referral_code" : action === "expert_referral.feature_switch" ? "expert_referral_feature_control" : "expert"},
        ${objectId ?? adminId}::uuid, ${adminId}::uuid,
        clock_timestamp() + interval '1 day', ${randomUUID()},
        ${sessionIdHash}, ${approverId}::uuid, ${approverSessionIdHash},
        ${canonicalAdminPayloadHash(payload)}, 'entitlement_admin',
        ${requesterMfaVerifiedAt}, ${approverMfaVerifiedAt}, clock_timestamp()
      )
    `);
    return { adminId, approvalId, sessionIdHash };
  }

  async enableFeatureControl(): Promise<ExpertReferralAdminEvidence> {
    const evidence = await this.createAdminEvidence(
      "expert_referral.feature_switch",
      EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID,
      { newCommandsEnabled: true, rewardGrantsEnabled: true },
    );
    await this.db.execute(sql`
      insert into expert_referral_feature_controls (
        feature_key, version, new_commands_enabled, reward_grants_enabled,
        approval_id, changed_by_admin_id, admin_session_id_hash
      ) values (
        'expert_referrals', 1, true, true,
        ${evidence.approvalId}::uuid, ${evidence.adminId}::uuid,
        ${evidence.sessionIdHash}
      )
    `);
    return evidence;
  }

  async storedCodes(): Promise<
    readonly {
      id: string;
      codeHash: string;
      maskedSuffix: string;
      keyVersion: number;
      status: string;
    }[]
  > {
    const result = await this.db.execute<{
      id: string;
      codeHash: string;
      maskedSuffix: string;
      keyVersion: number;
      status: string;
    }>(sql`
      select id, code_hash as "codeHash", masked_suffix as "maskedSuffix",
        hmac_key_version as "keyVersion", status
      from expert_referral_codes
      order by issued_at, id
    `);
    return result.rows;
  }

  async referralCount(inviteeExpertId?: string): Promise<number> {
    const result = await this.db.execute<{ count: number }>(sql`
      select count(*)::integer as count
      from expert_referrals
      where ${inviteeExpertId === undefined} or invitee_expert_id = ${inviteeExpertId ?? randomUUID()}::uuid
    `);
    return result.rows[0]?.count ?? 0;
  }

  async seedIssuedQuota(inviterExpertId: string, count: number): Promise<void> {
    const evidence = await this.createAdminEvidence(
      "expert_referral.batch_generate",
      inviterExpertId,
      { count, overrideId: null },
    );
    const batchId = randomUUID();
    await this.db.execute(sql`
      insert into expert_referral_code_batches (
        id, inviter_expert_id, requested_count, issued_by_admin_id,
        approval_id, admin_session_id_hash
      ) values (
        ${batchId}::uuid, ${inviterExpertId}::uuid, ${count},
        ${evidence.adminId}::uuid, ${evidence.approvalId}::uuid,
        ${evidence.sessionIdHash}
      )
    `);
    await this.db.execute(sql`
      insert into expert_referral_codes (
        batch_id, inviter_expert_id, code_hash, masked_suffix,
        hmac_key_version, status
      )
      select ${batchId}::uuid, ${inviterExpertId}::uuid,
        'seed:' || n::text || ':' || ${batchId}::text,
        '…' || lpad(n::text, 4, '0'), 1, 'issued'
      from generate_series(1, ${count}) n
    `);
  }

  async createIssuanceOverride(
    inviterExpertId: string,
    additionalQuota: number,
  ): Promise<string> {
    const overrideId = randomUUID();
    const reason = "bounded_test_override";
    const validFrom = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 86_400_000);
    const payload = {
      inviterExpertId,
      additionalQuota,
      reason,
      validFrom: validFrom.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const first = await this.createAdminEvidence(
      "expert_referral.issuance_override",
      overrideId,
      payload,
    );
    const second = await this.createAdminEvidence(
      "expert_referral.issuance_override",
      overrideId,
      payload,
    );
    await this.db.execute(sql`
      update admin_approvals second_approval
      set requester_id = first_approval.requester_id,
        requester_session_id_hash = first_approval.requester_session_id_hash,
        requester_mfa_verified_at = first_approval.requester_mfa_verified_at
      from admin_approvals first_approval
      where second_approval.id = ${second.approvalId}::uuid
        and first_approval.id = ${first.approvalId}::uuid
    `);
    const approvals = await this.db.execute<{
      approvalId: string;
      approverId: string;
    }>(sql`
      update admin_approvals set consumed_at = clock_timestamp()
      where id in (${first.approvalId}::uuid, ${second.approvalId}::uuid)
      returning id as "approvalId", approver_id as "approverId"
    `);
    const approvers = new Map(
      approvals.rows.map((row) => [row.approvalId, row.approverId]),
    );
    const firstApproverId = approvers.get(first.approvalId);
    const secondApproverId = approvers.get(second.approvalId);
    if (firstApproverId === undefined || secondApproverId === undefined) {
      throw new Error("issuance override approvals were not created");
    }
    await this.db.execute(sql`
      insert into expert_referral_issuance_overrides (
        id, inviter_expert_id, additional_quota, reason, valid_from,
        expires_at, requested_by_admin_id, requester_session_id_hash,
        first_approver_id, second_approver_id,
        first_approval_id, second_approval_id
      ) values (
        ${overrideId}::uuid, ${inviterExpertId}::uuid, ${additionalQuota},
        ${reason}, ${validFrom},
        ${expiresAt}, ${first.adminId}::uuid,
        ${first.sessionIdHash}, ${firstApproverId}::uuid, ${secondApproverId}::uuid,
        ${first.approvalId}::uuid, ${second.approvalId}::uuid
      )
    `);
    return overrideId;
  }

  async issuanceOverrideConsumedCount(overrideId: string): Promise<number> {
    const result = await this.db.execute<{ consumedCount: number }>(sql`
      select consumed_count as "consumedCount"
      from expert_referral_issuance_overrides
      where id = ${overrideId}::uuid
    `);
    return result.rows[0]?.consumedCount ?? 0;
  }

  async seedFirstResidencySettlement(expertId: string): Promise<void> {
    const tariffVersionId = randomUUID();
    const orderId = randomUUID();
    const settledAt = new Date();
    const residencyEndsAt = new Date(settledAt.getTime() + 86_400_000);
    const evidence = await this.createAdminEvidence(
      "expert_residency.tariff_create",
      tariffVersionId,
      { priceMinor: "1000", durationSeconds: 86400 },
    );
    await this.db.execute(sql`
      insert into expert_residency_tariff_versions (
        id, tariff_key, version, display_name, description, price_minor,
        currency, duration_seconds, active_from, active_to,
        created_by_admin_id, approval_id, admin_session_id_hash
      ) values (
        ${tariffVersionId}::uuid, ${`settled-${tariffVersionId}`}, 1,
        'Settled residency', 'Test settlement fixture', 1000, 'RUB', 86400,
        clock_timestamp() - interval '1 day',
        clock_timestamp() + interval '1 day', ${evidence.adminId}::uuid,
        ${evidence.approvalId}::uuid, ${evidence.sessionIdHash}
      )
    `);
    await this.db.execute(sql`
      insert into expert_residency_orders (
        id, expert_id, tariff_version_id, tariff_name, tariff_description,
        price_minor, currency, duration_seconds, credit_minor, cash_minor,
        payment_deadline, provider_deadline, idempotency_key, status, quoted_at, settled_at,
        residency_starts_at, residency_ends_at
      ) values (
        ${orderId}::uuid, ${expertId}::uuid, ${tariffVersionId}::uuid,
        'Settled residency', 'Test settlement fixture', 1000, 'RUB', 86400,
        0, 1000, clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day',
        ${`settled-${orderId}`}, 'settled', clock_timestamp() - interval '1 minute',
        ${settledAt}, ${settledAt}, ${residencyEndsAt}
      )
    `);
    await this.db.execute(sql`
      insert into expert_first_residency_settlements (
        expert_id, qualifying_order_id, eligibility_status,
        eligibility_reason_code, expert_active, expert_verified,
        unique_identity, abuse_cleared, settled_at
      ) values (
        ${expertId}::uuid, ${orderId}::uuid, 'ineligible',
        'preexisting_settlement', true, true, true, true, ${settledAt}
      )
    `);
  }

  async deleteChannelIdentities(userId: string): Promise<void> {
    await this.db.execute(sql`
      delete from channel_identities where user_id = ${userId}::uuid
    `);
  }

  async auditEventCount(action: string): Promise<number> {
    const result = await this.db.execute<{ count: number }>(sql`
      select count(*)::integer as count from audit_events where action = ${action}
    `);
    return result.rows[0]?.count ?? 0;
  }

  async replaceApprovalApproverSessionWithUnrelated(
    approvalId: string,
  ): Promise<void> {
    const unrelatedAdminId = randomUUID();
    const unrelatedSessionIdHash = `sha256:${randomUUID()}`;
    const mfaVerifiedAt = new Date(Date.now() - 60_000);
    await this.db.execute(sql`
      insert into users (id) values (${unrelatedAdminId}::uuid)
    `);
    await this.db.execute(sql`
      insert into admin_sessions (
        session_id_hash, admin_id, mfa_verified_at, expires_at
      ) values (
        ${unrelatedSessionIdHash}, ${unrelatedAdminId}::uuid,
        ${mfaVerifiedAt}, clock_timestamp() + interval '1 day'
      )
    `);
    await this.db.execute(sql`
      update admin_approvals
      set approver_session_id_hash = ${unrelatedSessionIdHash},
          approver_mfa_verified_at = ${mfaVerifiedAt}
      where id = ${approvalId}::uuid
    `);
  }
}
