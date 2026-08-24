import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { canonicalAdminPayloadHash } from "./admin-approval-repository.js";
import {
  ExpertReferralControlError,
  PostgresExpertReferralControlRepository,
  appendExpertReferralAuditEvent,
  assertExpertReferralAuditReplay,
  validateAndConsumeExpertReferralAdminEvidence,
} from "./expert-referral-control-repository.js";
import { withSerializableRetry } from "./message-repository.js";

interface IssuedCodeMaterial {
  readonly plaintext: string;
  readonly digest: string;
  readonly keyVersion: number;
  readonly maskedSuffix: string;
}

interface ExpertCodeCryptoPort {
  issue(count: number): readonly IssuedCodeMaterial[];
  digestCandidates(
    code: string,
  ): readonly { keyVersion: number; digest: string }[];
  verify(code: string, storedDigest: string, keyVersion: number): boolean;
}

interface AdminEvidence {
  readonly adminId: string;
  readonly approvalId: string;
  readonly sessionIdHash: string;
}

export interface IssueExpertReferralBatch extends AdminEvidence {
  readonly inviterExpertId: string;
  readonly count: number;
  readonly overrideId?: string;
}

export interface RevokeExpertReferralCode extends AdminEvidence {
  readonly codeId: string;
  readonly reasonCode: string;
}

export interface RedeemExpertReferralCode {
  readonly plaintext: string;
  readonly inviteeExpertId: string;
  readonly provider: string;
  readonly externalId: string;
}

export interface IssuedExpertReferralBatch {
  readonly batchId: string;
  readonly inviterExpertId: string;
  readonly codes: readonly {
    readonly codeId: string;
    readonly plaintext: string;
    readonly maskedSuffix: string;
  }[];
}

export interface MaskedExpertReferralCode {
  readonly batchId: string;
  readonly maskedSuffix: string;
  readonly status: "issued" | "redeemed" | "revoked";
  readonly createdAt: Date;
}

export interface RevokedExpertReferralCode {
  readonly codeId: string;
  readonly inviterExpertId: string;
  readonly maskedSuffix: string;
  readonly status: "revoked";
  readonly issuedAt: Date;
}

export interface RedeemedExpertReferral {
  readonly referralId: string;
  readonly codeId: string;
  readonly inviterExpertId: string;
  readonly inviteeExpertId: string;
  readonly boundAt: Date;
}

export class ExpertReferralRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly databaseCode?: string,
    readonly databaseConstraint?: string,
  ) {
    super(code);
    this.name = "ExpertReferralRepositoryError";
  }
}

export function validateExpertReferralBatchSize(count: number): number {
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new ExpertReferralRepositoryError("invalid_expert_code_batch_size");
  }
  return count;
}

export function computeExpertReferralOverrideConsumption(input: {
  readonly requestedCount: number;
  readonly outstandingCount: number;
  readonly rollingCount: number;
}): number {
  const incrementalOverage = (currentCount: number): number =>
    Math.max(0, currentCount + input.requestedCount - 1000) -
    Math.max(0, currentCount - 1000);
  return Math.max(
    incrementalOverage(input.outstandingCount),
    incrementalOverage(input.rollingCount),
  );
}

interface CountRow extends Record<string, unknown> {
  outstandingCount: number;
  rollingCount: number;
}

interface CodeRow extends Record<string, unknown> {
  codeId: string;
  inviterExpertId: string;
  codeHash: string;
  keyVersion: number;
  maskedSuffix: string;
  status: "issued" | "redeemed" | "revoked";
  issuedAt: Date | string;
  revocationApprovalId: string | null;
}

interface InventoryRow extends Record<string, unknown> {
  batchId: string;
  maskedSuffix: string;
  status: "issued" | "redeemed" | "revoked";
  createdAt: Date | string;
}

interface IssuanceOverrideRow extends Record<string, unknown> {
  id: string;
  inviterExpertId: string;
  additionalQuota: number;
  consumedCount: number;
  reason: string;
  validFrom: Date | string;
  expiresAt: Date | string;
  requestedByAdminId: string;
  firstApproverId: string;
  secondApproverId: string;
  firstRequesterId: string;
  secondRequesterId: string;
  firstActualApproverId: string | null;
  secondActualApproverId: string | null;
  firstPayloadHash: string;
  secondPayloadHash: string;
  firstApproved: boolean;
  secondApproved: boolean;
  firstConsumed: boolean;
  secondConsumed: boolean;
  databaseCurrent: boolean;
}

interface InviteeRow extends Record<string, unknown> {
  expertId: string;
  userId: string;
  active: boolean;
  verified: boolean;
  userActive: boolean;
  expertIdentityCount: number;
  channelMatches: boolean;
  openHoldCount: number;
  referralCount: number;
  settlementCount: number;
}

interface ReferralRow extends RedeemedExpertReferral, Record<string, unknown> {}

function requireCommandsEnabled(control: {
  newCommandsEnabled: boolean;
}): void {
  if (!control.newCommandsEnabled) {
    throw new ExpertReferralRepositoryError(
      "expert_referral_commands_disabled",
    );
  }
}

function validateAdminEvidence(command: AdminEvidence): void {
  if (!command.adminId || !command.approvalId || !command.sessionIdHash) {
    throw new ExpertReferralRepositoryError("invalid_admin_evidence");
  }
}

function isKnownReferralError(error: unknown): boolean {
  return (
    error instanceof ExpertReferralRepositoryError ||
    error instanceof ExpertReferralControlError
  );
}

function redactedDatabaseDiagnostic(error: unknown): {
  databaseCode?: string;
  databaseConstraint?: string;
} {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === "string") {
      return typeof candidate.constraint === "string"
        ? {
            databaseCode: candidate.code,
            databaseConstraint: candidate.constraint,
          }
        : { databaseCode: candidate.code };
    }
    current = candidate.cause;
  }
  return {};
}

export class PostgresExpertReferralRepository {
  private readonly controls: PostgresExpertReferralControlRepository;

  constructor(
    private readonly db: DrizzleDb,
    private readonly crypto: ExpertCodeCryptoPort,
  ) {
    this.controls = new PostgresExpertReferralControlRepository(db);
  }

  async issueBatch(
    command: IssueExpertReferralBatch,
  ): Promise<IssuedExpertReferralBatch> {
    validateAdminEvidence(command);
    const count = validateExpertReferralBatchSize(command.count);
    const material = this.crypto.issue(count).map((code) => ({
      ...code,
      codeId: randomUUID(),
    }));
    const batchId = randomUUID();
    try {
      return await withSerializableRetry(() =>
        this.db.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level serializable`);
          requireCommandsEnabled(await this.controls.lockFeatureControl(tx));
          await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`expert-referral:${command.inviterExpertId}`}, 0))
      `);
          const inviter = (
            await tx.execute<{
              active: boolean;
              verified: boolean;
              userActive: boolean;
            }>(sql`
        select e.active, e.verified, u.active as "userActive"
        from experts e join users u on u.id = e.user_id
        where e.id = ${command.inviterExpertId}::uuid
        for update of e, u
      `)
          ).rows[0];
          if (
            inviter === undefined ||
            !inviter.active ||
            !inviter.verified ||
            !inviter.userActive
          ) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_inviter_ineligible",
            );
          }
          const evidence = await validateAndConsumeExpertReferralAdminEvidence(
            tx,
            command,
            {
              action: "expert_referral.batch_generate",
              objectType: "expert",
              objectId: command.inviterExpertId,
              payload: {
                count: command.count,
                overrideId: command.overrideId ?? null,
              },
            },
          );
          if (evidence.replay) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_batch_already_issued",
            );
          }
          const counts = (
            await tx.execute<CountRow>(sql`
        select
          count(*) filter (
            where c.status = 'issued' or (
              c.status = 'redeemed'
              and exists (select 1 from expert_referrals r where r.code_id = c.id)
              and not exists (
                select 1 from expert_referrals r
                join expert_first_residency_settlements s
                  on s.expert_id = r.invitee_expert_id
                where r.code_id = c.id
              )
            )
          )::integer as "outstandingCount",
          count(*) filter (
            where c.issued_at >= clock_timestamp() - interval '30 days'
          )::integer as "rollingCount"
        from expert_referral_codes c
        where c.inviter_expert_id = ${command.inviterExpertId}::uuid
      `)
          ).rows[0] ?? { outstandingCount: 0, rollingCount: 0 };
          const overrideConsumption = computeExpertReferralOverrideConsumption({
            requestedCount: count,
            ...counts,
          });
          if (overrideConsumption > 0) {
            if (command.overrideId === undefined) {
              throw new ExpertReferralRepositoryError(
                "expert_referral_issuance_quota_exceeded",
              );
            }
            const override = (
              await tx.execute<IssuanceOverrideRow>(sql`
          select o.id, o.inviter_expert_id as "inviterExpertId",
            o.additional_quota as "additionalQuota",
            o.consumed_count as "consumedCount", o.reason,
            o.valid_from as "validFrom", o.expires_at as "expiresAt",
            o.requested_by_admin_id as "requestedByAdminId",
            o.first_approver_id as "firstApproverId",
            o.second_approver_id as "secondApproverId",
            first_approval.requester_id as "firstRequesterId",
            second_approval.requester_id as "secondRequesterId",
            first_approval.approver_id as "firstActualApproverId",
            second_approval.approver_id as "secondActualApproverId",
            first_approval.payload_hash as "firstPayloadHash",
            second_approval.payload_hash as "secondPayloadHash",
            first_approval.approved_at is not null as "firstApproved",
            second_approval.approved_at is not null as "secondApproved",
            first_approval.consumed_at is not null as "firstConsumed",
            second_approval.consumed_at is not null as "secondConsumed",
            transaction_timestamp() >= o.valid_from
              and transaction_timestamp() < o.expires_at as "databaseCurrent"
          from expert_referral_issuance_overrides o
          join admin_approvals first_approval
            on first_approval.id = o.first_approval_id
            and first_approval.action = 'expert_referral.issuance_override'
            and first_approval.object_type = 'expert'
            and first_approval.object_id = o.id
          join admin_approvals second_approval
            on second_approval.id = o.second_approval_id
            and second_approval.action = 'expert_referral.issuance_override'
            and second_approval.object_type = 'expert'
            and second_approval.object_id = o.id
          where o.id = ${command.overrideId}::uuid
          for update of o, first_approval, second_approval
        `)
            ).rows[0];
            const expectedPayloadHash =
              override === undefined
                ? undefined
                : canonicalAdminPayloadHash({
                    inviterExpertId: override.inviterExpertId,
                    additionalQuota: override.additionalQuota,
                    reason: override.reason,
                    validFrom: new Date(override.validFrom).toISOString(),
                    expiresAt: new Date(override.expiresAt).toISOString(),
                  });
            if (
              override === undefined ||
              override.inviterExpertId !== command.inviterExpertId ||
              !override.databaseCurrent ||
              override.consumedCount + overrideConsumption >
                override.additionalQuota ||
              override.firstRequesterId !== override.requestedByAdminId ||
              override.secondRequesterId !== override.requestedByAdminId ||
              override.firstActualApproverId !== override.firstApproverId ||
              override.secondActualApproverId !== override.secondApproverId ||
              override.firstActualApproverId ===
                override.secondActualApproverId ||
              !override.firstApproved ||
              !override.secondApproved ||
              !override.firstConsumed ||
              !override.secondConsumed ||
              override.firstPayloadHash !== expectedPayloadHash ||
              override.secondPayloadHash !== expectedPayloadHash
            ) {
              throw new ExpertReferralRepositoryError(
                "expert_referral_override_invalid",
              );
            }
            const consumed = await tx.execute(sql`
              update expert_referral_issuance_overrides
              set consumed_count = consumed_count + ${overrideConsumption},
                consumed_at = case
                  when consumed_count + ${overrideConsumption} = additional_quota
                    then clock_timestamp()
                  else consumed_at
                end
              where id = ${override.id}::uuid
            `);
            if (consumed.rowCount !== 1) {
              throw new ExpertReferralRepositoryError(
                "expert_referral_override_invalid",
              );
            }
          }
          await tx.execute(sql`
        insert into expert_referral_code_batches (
          id, inviter_expert_id, requested_count, issued_by_admin_id,
          approval_id, admin_session_id_hash
        ) values (
          ${batchId}::uuid, ${command.inviterExpertId}::uuid, ${count},
          ${command.adminId}::uuid, ${command.approvalId}::uuid,
          ${command.sessionIdHash}
        )
      `);
          const encoded = JSON.stringify(
            material.map((code) => ({
              id: code.codeId,
              code_hash: code.digest,
              masked_suffix: code.maskedSuffix,
              key_version: code.keyVersion,
            })),
          );
          await tx.execute(sql`
        insert into expert_referral_codes (
          id, batch_id, inviter_expert_id, code_hash, masked_suffix,
          hmac_key_version
        )
        select x.id::uuid, ${batchId}::uuid, ${command.inviterExpertId}::uuid,
          x.code_hash, x.masked_suffix, x.key_version
        from jsonb_to_recordset(${encoded}::jsonb) as x(
          id text, code_hash text, masked_suffix text, key_version integer
        )
      `);
          await appendExpertReferralAuditEvent(tx, {
            ...command,
            action: "expert_referral.batch_generate",
            objectType: "expert_referral_code_batch",
            objectId: batchId,
            reasonCode: "batch_issued",
            metadata: {
              inviterExpertId: command.inviterExpertId,
              requestedCount: count,
              overrideId: command.overrideId ?? null,
            },
          });
          return {
            batchId,
            inviterExpertId: command.inviterExpertId,
            codes: material.map((code) => ({
              codeId: code.codeId,
              plaintext: code.plaintext,
              maskedSuffix: code.maskedSuffix,
            })),
          };
        }),
      );
    } catch (error) {
      if (isKnownReferralError(error)) throw error;
      const diagnostic = redactedDatabaseDiagnostic(error);
      throw new ExpertReferralRepositoryError(
        "expert_referral_issuance_failed",
        diagnostic.databaseCode,
        diagnostic.databaseConstraint,
      );
    }
  }

  revokeCode(
    command: RevokeExpertReferralCode,
  ): Promise<RevokedExpertReferralCode> {
    validateAdminEvidence(command);
    if (command.reasonCode.trim().length === 0) {
      throw new ExpertReferralRepositoryError("invalid_revocation_reason");
    }
    return withSerializableRetry<RevokedExpertReferralCode>(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        const code = (
          await tx.execute<CodeRow>(sql`
        select id as "codeId", inviter_expert_id as "inviterExpertId",
          code_hash as "codeHash", hmac_key_version as "keyVersion",
          masked_suffix as "maskedSuffix", status, issued_at as "issuedAt",
          revocation_approval_id as "revocationApprovalId"
        from expert_referral_codes
        where id = ${command.codeId}::uuid
        for update
      `)
        ).rows[0];
        if (code === undefined)
          throw new ExpertReferralRepositoryError(
            "expert_referral_code_not_found",
          );
        const evidence = await validateAndConsumeExpertReferralAdminEvidence(
          tx,
          command,
          {
            action: "expert_referral.code_revoke",
            objectType: "expert_referral_code",
            objectId: command.codeId,
            payload: { reasonCode: command.reasonCode },
          },
        );
        if (
          code.status === "revoked" &&
          code.revocationApprovalId === command.approvalId
        ) {
          if (!evidence.replay) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_replay_conflict",
            );
          }
          await assertExpertReferralAuditReplay(tx, {
            ...command,
            action: "expert_referral.code_revoke",
            objectId: code.codeId,
            reasonCode: command.reasonCode,
            metadata: {
              codeId: command.codeId,
              reasonCode: command.reasonCode,
            },
            conflictCode: "expert_referral_replay_conflict",
          });
          return {
            codeId: code.codeId,
            inviterExpertId: code.inviterExpertId,
            maskedSuffix: code.maskedSuffix,
            status: "revoked",
            issuedAt: new Date(code.issuedAt),
          };
        }
        if (code.status !== "issued") {
          throw new ExpertReferralRepositoryError(
            "expert_referral_code_not_revocable",
          );
        }
        const updated = (
          await tx.execute<CodeRow>(sql`
        update expert_referral_codes
        set status = 'revoked', revoked_at = clock_timestamp(),
          revocation_approval_id = ${command.approvalId}::uuid,
          revoked_by_admin_id = ${command.adminId}::uuid,
          revocation_admin_session_id_hash = ${command.sessionIdHash}
        where id = ${command.codeId}::uuid and status = 'issued'
        returning id as "codeId", inviter_expert_id as "inviterExpertId",
          code_hash as "codeHash", hmac_key_version as "keyVersion",
          masked_suffix as "maskedSuffix", status, issued_at as "issuedAt",
          revocation_approval_id as "revocationApprovalId"
      `)
        ).rows[0];
        if (updated === undefined) {
          throw new ExpertReferralRepositoryError(
            "expert_referral_code_not_revocable",
          );
        }
        await appendExpertReferralAuditEvent(tx, {
          ...command,
          action: "expert_referral.code_revoke",
          objectType: "expert_referral_code",
          objectId: updated.codeId,
          reasonCode: command.reasonCode,
          metadata: { codeId: command.codeId, reasonCode: command.reasonCode },
        });
        return {
          codeId: updated.codeId,
          inviterExpertId: updated.inviterExpertId,
          maskedSuffix: updated.maskedSuffix,
          status: "revoked",
          issuedAt: new Date(updated.issuedAt),
        };
      }),
    ).catch((error: unknown) => {
      if (isKnownReferralError(error)) throw error;
      const diagnostic = redactedDatabaseDiagnostic(error);
      throw new ExpertReferralRepositoryError(
        "expert_referral_revocation_failed",
        diagnostic.databaseCode,
        diagnostic.databaseConstraint,
      );
    });
  }

  async redeemCode(
    command: RedeemExpertReferralCode,
  ): Promise<RedeemedExpertReferral> {
    const candidates = this.crypto.digestCandidates(command.plaintext);
    const encoded = JSON.stringify(candidates);
    try {
      return await withSerializableRetry(() =>
        this.db.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level serializable`);
          requireCommandsEnabled(await this.controls.lockFeatureControl(tx));
          await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`expert-code:${candidates[0]?.digest ?? "invalid"}`}, 0))
      `);
          const code = (
            await tx.execute<CodeRow>(sql`
        select c.id as "codeId", c.inviter_expert_id as "inviterExpertId",
          c.code_hash as "codeHash", c.hmac_key_version as "keyVersion",
          c.masked_suffix as "maskedSuffix", c.status, c.issued_at as "issuedAt",
          c.revocation_approval_id as "revocationApprovalId"
        from expert_referral_codes c
        join jsonb_to_recordset(${encoded}::jsonb)
          as candidate("keyVersion" integer, digest text)
          on candidate."keyVersion" = c.hmac_key_version
          and candidate.digest = c.code_hash
        for update of c
      `)
          ).rows[0];
          if (
            code === undefined ||
            code.status !== "issued" ||
            !this.crypto.verify(
              command.plaintext,
              code.codeHash,
              code.keyVersion,
            )
          ) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_code_unavailable",
            );
          }
          if (code.inviterExpertId === command.inviteeExpertId) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_self_referral",
            );
          }
          await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`expert-referral:${command.inviteeExpertId}`}, 0))
      `);
          const invitee = (
            await tx.execute<InviteeRow>(sql`
        select e.id as "expertId", e.user_id as "userId", e.active, e.verified,
          u.active as "userActive",
          (select count(*)::integer from experts same where same.user_id = e.user_id)
            as "expertIdentityCount",
          exists(
            select 1 from channel_identities ci
            where ci.user_id = e.user_id and ci.provider = ${command.provider}
              and ci.external_id = ${command.externalId}
          ) as "channelMatches",
          (select count(*)::integer from expert_referral_abuse_holds h
            where h.expert_id = e.id and h.status = 'open') as "openHoldCount",
          (select count(*)::integer from expert_referrals r
            where r.invitee_expert_id = e.id) as "referralCount",
          (select count(*)::integer from expert_first_residency_settlements s
            where s.expert_id = e.id) as "settlementCount"
        from experts e join users u on u.id = e.user_id
        where e.id = ${command.inviteeExpertId}::uuid
        for update of e, u
      `)
          ).rows[0];
          if (
            invitee === undefined ||
            !invitee.active ||
            !invitee.verified ||
            !invitee.userActive ||
            invitee.expertIdentityCount !== 1 ||
            !invitee.channelMatches ||
            invitee.openHoldCount !== 0
          ) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_invitee_ineligible",
            );
          }
          await tx.execute(sql`
        select id from channel_identities
        where user_id = ${invitee.userId}::uuid and provider = ${command.provider}
          and external_id = ${command.externalId}
        for update
      `);
          await tx.execute(sql`
        select id from expert_referral_abuse_holds
        where expert_id = ${command.inviteeExpertId}::uuid and status = 'open'
        for update
      `);
          if (invitee.referralCount !== 0) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_already_bound",
            );
          }
          if (invitee.settlementCount !== 0) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_first_residency_settled",
            );
          }
          const referralId = randomUUID();
          const updated = await tx.execute(sql`
        update expert_referral_codes
        set status = 'redeemed', redeemed_at = clock_timestamp()
        where id = ${code.codeId}::uuid and status = 'issued'
        returning id
      `);
          if (updated.rows[0] === undefined) {
            throw new ExpertReferralRepositoryError(
              "expert_referral_code_unavailable",
            );
          }
          const referral = (
            await tx.execute<ReferralRow>(sql`
        insert into expert_referrals (
          id, code_id, inviter_expert_id, invitee_expert_id
        ) values (
          ${referralId}::uuid, ${code.codeId}::uuid,
          ${code.inviterExpertId}::uuid, ${command.inviteeExpertId}::uuid
        )
        returning id as "referralId", code_id as "codeId",
          inviter_expert_id as "inviterExpertId",
          invitee_expert_id as "inviteeExpertId", bound_at as "boundAt"
      `)
          ).rows[0];
          if (referral === undefined)
            throw new Error("expert_referral_insert_failed");
          return referral;
        }),
      );
    } catch (error) {
      if (isKnownReferralError(error)) throw error;
      const diagnostic = redactedDatabaseDiagnostic(error);
      throw new ExpertReferralRepositoryError(
        "expert_referral_redemption_failed",
        diagnostic.databaseCode,
        diagnostic.databaseConstraint,
      );
    }
  }

  async maskedInventory(
    inviterExpertId: string,
  ): Promise<readonly MaskedExpertReferralCode[]> {
    const result = await this.db.execute<InventoryRow>(sql`
      select batch_id as "batchId", masked_suffix as "maskedSuffix", status,
        issued_at as "createdAt"
      from expert_referral_codes
      where inviter_expert_id = ${inviterExpertId}::uuid
      order by issued_at, id
    `);
    return result.rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
    }));
  }
}
