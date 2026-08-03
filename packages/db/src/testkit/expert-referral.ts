import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "./postgres.js";

export interface ExpertIdentityFixture {
  userId: string;
  expertId: string;
  provider: string;
  externalId: string;
}

export interface ExpertAdminAuditFixture {
  adminId: string;
  approvalId: string;
  sessionIdHash: string;
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
  }): Promise<ExpertAdminAuditFixture>;
  enableExpertReferralCommands(): Promise<void>;
  createDualApprovedOverride(input: {
    inviterExpertId: string;
    additionalQuota: number;
  }): Promise<string>;
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

  const createAdminAudit: ExpertReferralTestDatabase["createAdminAudit"] =
    async ({ action, objectId, adminId }) => {
      const resolvedAdminId = adminId ?? (await base.createUser());
      const sessionIdHash = `session-${randomUUID()}`;
      await base.db.execute(sql`
        insert into admin_sessions (
          session_id_hash, admin_id, mfa_verified_at, expires_at
        ) values (
          ${sessionIdHash}, ${resolvedAdminId}::uuid,
          transaction_timestamp() - interval '1 minute',
          transaction_timestamp() + interval '1 hour'
        )
      `);
      const approvalId = requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into admin_approvals (
              action, object_type, object_id, requester_id,
              requester_session_id_hash, payload_hash, required_role,
              requester_mfa_verified_at, expires_at, nonce
            ) values (
              ${action}, 'expert_referral', ${objectId}::uuid, ${resolvedAdminId}::uuid,
              ${sessionIdHash}, ${"a".repeat(64)}, 'security_admin',
              transaction_timestamp() - interval '1 minute',
              transaction_timestamp() + interval '1 hour', ${randomUUID()}
            ) returning id
          `)
        ).rows,
        "admin approval",
      );
      return { adminId: resolvedAdminId, approvalId, sessionIdHash };
    };

  const reset = async (): Promise<void> => {
    await base.db.execute(sql`
      truncate table expert_referral_feature_controls,
        expert_referral_abuse_holds, expert_referral_issuance_overrides,
        expert_referral_ledger_allocations, expert_referral_ledger_entries,
        expert_referral_reward_grants, expert_first_residency_settlements,
        expert_residency_provider_event_inbox,
        expert_residency_payment_attempts, expert_residency_orders,
        expert_residency_tariff_versions, expert_referrals,
        expert_referral_codes, expert_referral_code_batches cascade
    `);
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
      const objectId = randomUUID();
      const audit = await createAdminAudit({
        action: "expert_referral.feature_switch",
        objectId,
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
    async createDualApprovedOverride({ inviterExpertId, additionalQuota }) {
      const requesterId = await base.createUser();
      const approverOneId = await base.createUser();
      const approverTwoId = await base.createUser();
      const first = await createAdminAudit({
        action: "expert_referral.issuance_override",
        objectId: inviterExpertId,
        adminId: requesterId,
      });
      const second = await createAdminAudit({
        action: "expert_referral.issuance_override",
        objectId: inviterExpertId,
        adminId: requesterId,
      });
      await base.db.execute(sql`
        update admin_approvals
        set approver_id = ${approverOneId}::uuid,
            approver_session_id_hash = ${`approver-${randomUUID()}`},
            approver_mfa_verified_at = transaction_timestamp(),
            approved_at = transaction_timestamp()
        where id = ${first.approvalId}::uuid
      `);
      await base.db.execute(sql`
        update admin_approvals
        set approver_id = ${approverTwoId}::uuid,
            approver_session_id_hash = ${`approver-${randomUUID()}`},
            approver_mfa_verified_at = transaction_timestamp(),
            approved_at = transaction_timestamp()
        where id = ${second.approvalId}::uuid
      `);
      return requiredId(
        (
          await base.db.execute<{ id: string }>(sql`
            insert into expert_referral_issuance_overrides (
              inviter_expert_id, additional_quota, reason_code,
              valid_from, valid_until, requester_id, approver_one_id,
              approver_two_id, approval_one_id, approval_two_id,
              requester_session_id_hash
            ) values (
              ${inviterExpertId}::uuid, ${additionalQuota}, 'approved_test',
              transaction_timestamp() - interval '1 minute',
              transaction_timestamp() + interval '1 hour',
              ${requesterId}::uuid, ${approverOneId}::uuid,
              ${approverTwoId}::uuid, ${first.approvalId}::uuid,
              ${second.approvalId}::uuid, ${first.sessionIdHash}
            ) returning id
          `)
        ).rows,
        "issuance override",
      );
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
