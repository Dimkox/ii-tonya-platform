import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { canonicalAdminPayloadHash } from "./admin-approval-repository.js";
import {
  expertReferralCodeBatches,
  expertReferralCodes,
} from "../schema/expert-residency.js";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import { withSerializableRetry } from "./message-repository.js";

const BASE_ISSUANCE_QUOTA = 1000;

export interface ExpertReferralIssuedCodeMaterial {
  plaintext: string;
  digest: string;
  hash: string;
  keyVersion: string;
  maskedSuffix: string;
}

export interface ExpertReferralCodeCrypto {
  issue(count: number): ExpertReferralIssuedCodeMaterial[];
  digestCandidates(plaintext: string): Array<{
    digest: string;
    hash: string;
    keyVersion: string;
  }>;
}

export interface IssueExpertReferralBatchCommand {
  inviterExpertId: string;
  count: number;
  issuedByAdminId: string;
  approvalId: string;
  adminSessionIdHash: string;
  overrideId?: string;
}

export interface IssuedExpertReferralCode {
  id: string;
  plaintext: string;
  maskedSuffix: string;
}

export interface IssuedExpertReferralBatch {
  batchId: string;
  codes: IssuedExpertReferralCode[];
}

export interface RevokeExpertReferralCodeCommand {
  codeId: string;
  approvalId: string;
  adminSessionIdHash: string;
}

export interface RedeemExpertReferralCodeCommand {
  plaintext: string;
  userId: string;
  provider: string;
  externalId: string;
}

export interface ExpertReferralBinding {
  referralId: string;
  codeId: string;
  inviterExpertId: string;
  inviteeExpertId: string;
  boundAt: Date;
}

export interface MaskedExpertReferralCode extends Record<string, unknown> {
  id: string;
  batchId: string;
  maskedSuffix: string;
  status: "issued" | "redeemed" | "revoked";
  issuedAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
}

export type ExpertReferralBatchStatus =
  | "issued"
  | "partially_redeemed"
  | "fully_redeemed"
  | "revoked";

type ExpertReferralCodeStatus = "issued" | "redeemed" | "revoked";

export const EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION =
  "expert_referral.issuance_override";
export const EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE =
  "expert_referral_issuance_override";

export class ExpertReferralCommandError extends Error {
  constructor(
    readonly code:
      | "EXPERT_REFERRAL_DISABLED"
      | "EXPERT_REFERRAL_NOT_ELIGIBLE"
      | "EXPERT_REFERRAL_CODE_UNAVAILABLE"
      | "EXPERT_REFERRAL_QUOTA_EXCEEDED"
      | "EXPERT_REFERRAL_OVERRIDE_INVALID"
      | "EXPERT_REFERRAL_COMMAND_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ExpertReferralCommandError";
  }
}

export function parseExpertCodeKeyVersion(version: string): number {
  const match = /^v([1-9][0-9]*)$/u.exec(version);
  const parsed = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new Error("Invalid expert referral key version");
  }
  return parsed;
}

export function calculateIssuanceOverrideUsage(input: {
  count: number;
  outstandingOrUnsettled: number;
  issuedInRollingWindow: number;
}): number {
  const incrementalExcess = (before: number): number =>
    Math.max(0, before + input.count - BASE_ISSUANCE_QUOTA) -
    Math.max(0, before - BASE_ISSUANCE_QUOTA);
  return Math.max(
    0,
    incrementalExcess(input.outstandingOrUnsettled),
    incrementalExcess(input.issuedInRollingWindow),
  );
}

export function toPublicIssuedExpertReferralCode(
  id: string,
  material: ExpertReferralIssuedCodeMaterial,
): IssuedExpertReferralCode {
  return {
    id,
    plaintext: material.plaintext,
    maskedSuffix: material.maskedSuffix,
  };
}

export function deriveExpertReferralBatchStatus(
  statuses: readonly ExpertReferralCodeStatus[],
): ExpertReferralBatchStatus {
  if (statuses.length === 0) {
    throw new Error("Expert referral batch has no codes");
  }
  if (statuses.every((status) => status === "issued")) return "issued";
  if (statuses.every((status) => status === "redeemed")) {
    return "fully_redeemed";
  }
  if (statuses.every((status) => status === "revoked")) return "revoked";
  return "partially_redeemed";
}

export interface ExpertReferralOverrideApprovalPayloadInput {
  overrideId: string;
  inviterExpertId: string;
  additionalQuota: number;
  reasonCode: string;
  validFrom: Date | string;
  validUntil: Date | string;
  requesterId: string;
  requesterSessionIdHash: string;
}

export class ExpertReferralDataIntegrityError extends Error {
  readonly code = "expert_referral_invalid_timestamp";

  constructor(readonly field: string) {
    super(`Invalid database timestamp: ${field}`);
    this.name = "ExpertReferralDataIntegrityError";
  }
}

const EXPERT_REFERRAL_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})([ T])(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2})(?::(\d{2}))?)$/u;

const CANONICAL_EXPERT_REFERRAL_INSTANT_PATTERN =
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function canonicalExpertReferralInstant(value: Date, field: string): string {
  const canonical = value.toISOString();
  if (!CANONICAL_EXPERT_REFERRAL_INSTANT_PATTERN.test(canonical)) {
    throw new ExpertReferralDataIntegrityError(field);
  }
  return canonical;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeExpertReferralInstant(
  value: Date | string,
  field: string,
): string {
  if (value instanceof Date) {
    const normalized = new Date(value.getTime());
    if (!Number.isFinite(normalized.getTime())) {
      throw new ExpertReferralDataIntegrityError(field);
    }
    return canonicalExpertReferralInstant(normalized, field);
  }

  const match = EXPERT_REFERRAL_INSTANT_PATTERN.exec(value);
  if (match === null) {
    throw new ExpertReferralDataIntegrityError(field);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const separator = match[4];
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  const second = Number(match[7]);
  const milliseconds = Number((match[8] ?? "").padEnd(3, "0").slice(0, 3));
  const zone = match[9];
  const offsetSign = match[10];
  const offsetHour = Number(match[11] ?? "0");
  const offsetMinute = Number(match[12] ?? "0");
  const isPostgresForm = separator === " " && zone !== "Z";
  const isIsoForm =
    separator === "T" && (zone === "Z" || match[12] !== undefined);
  if (
    (!isPostgresForm && !isIsoForm) ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new ExpertReferralDataIntegrityError(field);
  }

  const localClock = new Date(0);
  localClock.setUTCFullYear(year, month - 1, day);
  localClock.setUTCHours(hour, minute, second, milliseconds);
  const direction = offsetSign === "-" ? -1 : 1;
  const offsetMilliseconds =
    direction * (offsetHour * 60 + offsetMinute) * 60_000;
  const normalized = new Date(localClock.getTime() - offsetMilliseconds);
  if (!Number.isFinite(normalized.getTime())) {
    throw new ExpertReferralDataIntegrityError(field);
  }
  return canonicalExpertReferralInstant(normalized, field);
}

export function expertReferralOverrideApprovalPayload(
  input: ExpertReferralOverrideApprovalPayloadInput,
) {
  return {
    additionalQuota: input.additionalQuota,
    inviterExpertId: input.inviterExpertId,
    overrideId: input.overrideId,
    reasonCode: input.reasonCode,
    requesterId: input.requesterId,
    requesterSessionIdHash: input.requesterSessionIdHash,
    validFrom: normalizeExpertReferralInstant(
      input.validFrom,
      "expert_referral_issuance_overrides.valid_from",
    ),
    validUntil: normalizeExpertReferralInstant(
      input.validUntil,
      "expert_referral_issuance_overrides.valid_until",
    ),
  } as const;
}

function storedDigestMatches(
  candidateDigest: string,
  keyVersion: string,
  storedHash: string,
): boolean {
  const storedDigest = `hmac-sha256:${keyVersion}:${storedHash}`;
  const candidateBytes = Buffer.from(candidateDigest, "utf8");
  const storedBytes = Buffer.from(storedDigest, "utf8");
  return (
    candidateBytes.byteLength === storedBytes.byteLength &&
    timingSafeEqual(candidateBytes, storedBytes)
  );
}

function assertBatchSize(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
    throw new RangeError(
      "Expert referral batch size must be between 1 and 1000",
    );
  }
}

export class PostgresExpertReferralRepository {
  readonly #controls: PostgresExpertReferralControlRepository;

  constructor(
    private readonly db: DrizzleDb,
    private readonly crypto: ExpertReferralCodeCrypto,
    private readonly options: { skipIsolationStatement?: boolean } = {},
  ) {
    this.#controls = new PostgresExpertReferralControlRepository(db, options);
  }

  async issueBatch(
    command: IssueExpertReferralBatchCommand,
  ): Promise<IssuedExpertReferralBatch> {
    assertBatchSize(command.count);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        if (this.options.skipIsolationStatement !== true) await tx.execute(sql`set transaction isolation level serializable`);
        const control = await this.#controls.lockFeatureControl(tx);
        if (!control.newCommandsEnabled) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_DISABLED",
            "Expert referral commands are disabled",
          );
        }
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended('expert-referral-issuance:' || ${command.inviterExpertId}, 0)
          )
        `);
        const inviter = await tx.execute<{
          active: boolean;
          verified: boolean;
        }>(
          sql`
            select active, verified
            from experts
            where id = ${command.inviterExpertId}::uuid
            for update
          `,
        );
        const inviterRow = inviter.rows[0];
        if (
          inviterRow === undefined ||
          !inviterRow.active ||
          !inviterRow.verified
        ) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_NOT_ELIGIBLE",
            "Expert referral command is not eligible",
          );
        }

        const quota = await tx.execute<{
          outstandingOrUnsettled: string;
          issuedInRollingWindow: string;
        }>(sql`
          select
            (
              select count(*)::text
              from expert_referral_codes c
              left join expert_referrals r on r.code_id = c.id
              left join expert_first_residency_settlements s
                on s.referral_id = r.id
              where c.inviter_expert_id = ${command.inviterExpertId}::uuid
                and (
                  c.status = 'issued'
                  or (c.status = 'redeemed' and s.id is null)
                )
            ) as "outstandingOrUnsettled",
            (
              select count(*)::text
              from expert_referral_codes c
              where c.inviter_expert_id = ${command.inviterExpertId}::uuid
                and c.issued_at >= transaction_timestamp() - interval '30 days'
            ) as "issuedInRollingWindow"
        `);
        const quotaRow = quota.rows[0];
        if (quotaRow === undefined) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_COMMAND_CONFLICT",
            "Expert referral quota state is unavailable",
          );
        }
        const overrideUsage = calculateIssuanceOverrideUsage({
          count: command.count,
          outstandingOrUnsettled: Number(quotaRow.outstandingOrUnsettled),
          issuedInRollingWindow: Number(quotaRow.issuedInRollingWindow),
        });
        if (overrideUsage > 0) {
          await this.consumeOverride(
            tx,
            command.inviterExpertId,
            command.overrideId,
            overrideUsage,
          );
        }

        const batchRows = await tx
          .insert(expertReferralCodeBatches)
          .values({
            inviterExpertId: command.inviterExpertId,
            requestedCount: command.count,
            issuedByAdminId: command.issuedByAdminId,
            approvalId: command.approvalId,
            adminSessionIdHash: command.adminSessionIdHash,
          })
          .returning({ id: expertReferralCodeBatches.id });
        const batchId = batchRows[0]?.id;
        if (batchId === undefined) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_COMMAND_CONFLICT",
            "Expert referral batch was not created",
          );
        }
        const issued = this.crypto.issue(command.count);
        const storedRows = await tx
          .insert(expertReferralCodes)
          .values(
            issued.map((code) => ({
              batchId,
              inviterExpertId: command.inviterExpertId,
              codeHash: code.hash,
              keyVersion: parseExpertCodeKeyVersion(code.keyVersion),
              maskedSuffix: code.maskedSuffix,
            })),
          )
          .returning({ id: expertReferralCodes.id });
        if (storedRows.length !== issued.length) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_COMMAND_CONFLICT",
            "Expert referral batch was not created",
          );
        }
        return {
          batchId,
          codes: issued.map((code, index) =>
            toPublicIssuedExpertReferralCode(storedRows[index]!.id, code),
          ),
        };
      }),
    );
  }

  async revokeCode(
    command: RevokeExpertReferralCodeCommand,
  ): Promise<{ id: string; status: "revoked" }> {
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        if (this.options.skipIsolationStatement !== true) await tx.execute(sql`set transaction isolation level serializable`);
        const control = await this.#controls.lockFeatureControl(tx);
        if (!control.newCommandsEnabled) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_DISABLED",
            "Expert referral commands are disabled",
          );
        }
        const code = await tx.execute<{
          id: string;
          batchId: string;
          status: "issued" | "redeemed" | "revoked";
          revokedApprovalId: string | null;
          revokedAdminSessionIdHash: string | null;
        }>(sql`
          select
            id, batch_id as "batchId", status,
            revoked_approval_id as "revokedApprovalId",
            revoked_admin_session_id_hash as "revokedAdminSessionIdHash"
          from expert_referral_codes
          where id = ${command.codeId}::uuid
          for update
        `);
        const row = code.rows[0];
        if (row === undefined || row.status === "redeemed") {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_CODE_UNAVAILABLE",
            "Expert referral code is unavailable",
          );
        }
        if (row.status === "revoked") {
          if (
            row.revokedApprovalId === command.approvalId &&
            row.revokedAdminSessionIdHash === command.adminSessionIdHash
          ) {
            return { id: row.id, status: "revoked" as const };
          }
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_COMMAND_CONFLICT",
            "Expert referral command conflicts with stored state",
          );
        }
        await tx.execute(sql`
          update expert_referral_codes
          set status = 'revoked', revoked_at = transaction_timestamp(),
              revoked_approval_id = ${command.approvalId}::uuid,
              revoked_admin_session_id_hash = ${command.adminSessionIdHash}
          where id = ${row.id}::uuid and status = 'issued'
        `);
        await this.refreshBatchStatus(tx, row.batchId);
        return { id: row.id, status: "revoked" as const };
      }),
    );
  }

  async redeemCode(
    command: RedeemExpertReferralCodeCommand,
  ): Promise<ExpertReferralBinding> {
    const candidates = this.crypto.digestCandidates(command.plaintext);
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        if (this.options.skipIsolationStatement !== true) await tx.execute(sql`set transaction isolation level serializable`);
        const control = await this.#controls.lockFeatureControl(tx);
        if (!control.newCommandsEnabled) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_DISABLED",
            "Expert referral commands are disabled",
          );
        }
        const user = await tx.execute<{ id: string; active: boolean }>(sql`
          select id, active
          from users
          where id = ${command.userId}::uuid
          for update
        `);
        if (user.rows[0]?.active !== true) this.notEligible();

        const identity = await tx.execute<{ userId: string }>(sql`
          select user_id as "userId"
          from channel_identities
          where provider = ${command.provider}
            and external_id = ${command.externalId}
          for update
        `);
        if (
          identity.rows.length !== 1 ||
          identity.rows[0]?.userId !== command.userId
        ) {
          this.notEligible();
        }

        const experts = await tx.execute<{
          id: string;
          active: boolean;
          verified: boolean;
        }>(sql`
          select id, active, verified
          from experts
          where user_id = ${command.userId}::uuid
          for update
        `);
        const invitee = experts.rows[0];
        if (
          experts.rows.length !== 1 ||
          invitee === undefined ||
          !invitee.active ||
          !invitee.verified
        ) {
          this.notEligible();
        }

        const holds = await tx.execute<{ id: string }>(sql`
          select id
          from expert_referral_abuse_holds
          where expert_id = ${invitee.id}::uuid and status = 'open'
          for update
        `);
        if (holds.rows.length !== 0) this.notEligible();

        const previousBinding = await tx.execute<{ id: string }>(sql`
          select id
          from expert_referrals
          where invitee_expert_id = ${invitee.id}::uuid
          for update
        `);
        if (previousBinding.rows.length !== 0) this.notEligible();

        const priorSettlement = await tx.execute<{ id: string }>(sql`
          select id
          from expert_first_residency_settlements
          where expert_id = ${invitee.id}::uuid
          for update
        `);
        if (priorSettlement.rows.length !== 0) this.notEligible();

        const candidateHashes = sql.join(
          candidates.map(({ hash }) => sql`${hash}`),
          sql`, `,
        );
        const codes = await tx.execute<{
          id: string;
          batchId: string;
          inviterExpertId: string;
          codeHash: string;
          keyVersion: number;
          status: "issued" | "redeemed" | "revoked";
        }>(sql`
          select
            id, batch_id as "batchId",
            inviter_expert_id as "inviterExpertId",
            code_hash as "codeHash", key_version as "keyVersion", status
          from expert_referral_codes
          where code_hash in (${candidateHashes})
          for update
        `);
        const code = codes.rows.find((stored) => {
          const candidate = candidates.find(
            ({ keyVersion }) =>
              parseExpertCodeKeyVersion(keyVersion) === stored.keyVersion,
          );
          return (
            candidate !== undefined &&
            storedDigestMatches(
              candidate.digest,
              candidate.keyVersion,
              stored.codeHash,
            )
          );
        });
        if (code === undefined || code.status !== "issued") {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_CODE_UNAVAILABLE",
            "Expert referral code is unavailable",
          );
        }
        if (code.inviterExpertId === invitee.id) this.notEligible();

        const consumed = await tx.execute<{ id: string }>(sql`
          update expert_referral_codes
          set status = 'redeemed', redeemed_at = transaction_timestamp()
          where id = ${code.id}::uuid and status = 'issued'
          returning id
        `);
        if (consumed.rows.length !== 1) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_CODE_UNAVAILABLE",
            "Expert referral code is unavailable",
          );
        }
        const referral = await tx.execute<{
          referralId: string;
          boundAt: Date;
        }>(sql`
          insert into expert_referrals (
            code_id, inviter_expert_id, invitee_expert_id, bound_at
          ) values (
            ${code.id}::uuid, ${code.inviterExpertId}::uuid,
            ${invitee.id}::uuid, transaction_timestamp()
          ) returning id as "referralId", bound_at as "boundAt"
        `);
        const binding = referral.rows[0];
        if (binding === undefined) {
          throw new ExpertReferralCommandError(
            "EXPERT_REFERRAL_COMMAND_CONFLICT",
            "Expert referral binding was not created",
          );
        }
        await this.refreshBatchStatus(tx, code.batchId);
        return {
          ...binding,
          codeId: code.id,
          inviterExpertId: code.inviterExpertId,
          inviteeExpertId: invitee.id,
        };
      }),
    );
  }

  async maskedInventory(
    inviterExpertId: string,
  ): Promise<MaskedExpertReferralCode[]> {
    const result = await this.db.execute<MaskedExpertReferralCode>(sql`
      select
        id, batch_id as "batchId", masked_suffix as "maskedSuffix", status,
        issued_at as "issuedAt", redeemed_at as "redeemedAt",
        revoked_at as "revokedAt"
      from expert_referral_codes
      where inviter_expert_id = ${inviterExpertId}::uuid
      order by issued_at, id
    `);
    return [...result.rows];
  }

  private notEligible(): never {
    throw new ExpertReferralCommandError(
      "EXPERT_REFERRAL_NOT_ELIGIBLE",
      "Expert referral command is not eligible",
    );
  }

  private async consumeOverride(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    inviterExpertId: string,
    overrideId: string | undefined,
    required: number,
  ): Promise<void> {
    if (overrideId === undefined) {
      throw new ExpertReferralCommandError(
        "EXPERT_REFERRAL_QUOTA_EXCEEDED",
        "Expert referral issuance quota exceeded",
      );
    }
    const override = await tx.execute<{
      overrideId: string;
      inviterExpertId: string;
      additionalQuota: number;
      consumedCount: number;
      reasonCode: string;
      validFrom: Date | string;
      validUntil: Date | string;
      requesterId: string;
      requesterSessionIdHash: string;
      approverOneId: string;
      approverTwoId: string;
      approvalOneId: string;
      approvalTwoId: string;
      approvalOnePayloadHash: string;
      approvalTwoPayloadHash: string;
    }>(sql`
      with db_clock as (select clock_timestamp() as db_now)
      select
        o.id as "overrideId",
        o.inviter_expert_id as "inviterExpertId",
        o.additional_quota as "additionalQuota",
        o.consumed_count as "consumedCount",
        o.reason_code as "reasonCode",
        to_char(
          o.valid_from at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) as "validFrom",
        to_char(
          o.valid_until at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) as "validUntil",
        o.requester_id as "requesterId",
        o.requester_session_id_hash as "requesterSessionIdHash",
        o.approver_one_id as "approverOneId",
        o.approver_two_id as "approverTwoId",
        a1.id as "approvalOneId", a2.id as "approvalTwoId",
        a1.payload_hash as "approvalOnePayloadHash",
        a2.payload_hash as "approvalTwoPayloadHash"
      from expert_referral_issuance_overrides o
      join admin_approvals a1 on a1.id = o.approval_one_id
      join admin_approvals a2 on a2.id = o.approval_two_id
      join admin_sessions requester_session
        on requester_session.session_id_hash = o.requester_session_id_hash
        and requester_session.admin_id = o.requester_id
      join admin_role_assignments requester_role
        on requester_role.admin_id = o.requester_id
        and requester_role.role = 'security_admin'
      join admin_sessions approver_one_session
        on approver_one_session.session_id_hash = a1.approver_session_id_hash
        and approver_one_session.admin_id = o.approver_one_id
      join admin_role_assignments approver_one_role
        on approver_one_role.admin_id = o.approver_one_id
        and approver_one_role.role = 'security_admin'
      join admin_sessions approver_two_session
        on approver_two_session.session_id_hash = a2.approver_session_id_hash
        and approver_two_session.admin_id = o.approver_two_id
      join admin_role_assignments approver_two_role
        on approver_two_role.admin_id = o.approver_two_id
        and approver_two_role.role = 'security_admin'
      cross join db_clock c
      where o.id = ${overrideId}::uuid
        and o.inviter_expert_id = ${inviterExpertId}::uuid
        and o.consumed_count = 0
        and date_trunc('milliseconds', o.valid_from) = o.valid_from
        and date_trunc('milliseconds', o.valid_until) = o.valid_until
        and o.valid_from >= timestamp with time zone '0001-01-01 00:00:00+00 AD'
        and o.valid_from < timestamp with time zone '10000-01-01 00:00:00+00 AD'
        and o.valid_until >= timestamp with time zone '0001-01-01 00:00:00+00 AD'
        and o.valid_until < timestamp with time zone '10000-01-01 00:00:00+00 AD'
        and c.db_now >= o.valid_from and c.db_now < o.valid_until
        and a1.id <> a2.id
        and a1.action = ${EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION}
        and a2.action = ${EXPERT_REFERRAL_OVERRIDE_APPROVAL_ACTION}
        and a1.object_type = ${EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE}
        and a2.object_type = ${EXPERT_REFERRAL_OVERRIDE_APPROVAL_OBJECT_TYPE}
        and a1.object_id = o.id and a2.object_id = o.id
        and a1.requester_id = o.requester_id
        and a2.requester_id = o.requester_id
        and a1.requester_session_id_hash = o.requester_session_id_hash
        and a2.requester_session_id_hash = o.requester_session_id_hash
        and a1.requester_mfa_verified_at = requester_session.mfa_verified_at
        and a2.requester_mfa_verified_at = requester_session.mfa_verified_at
        and a1.required_role = 'security_admin'
        and a2.required_role = 'security_admin'
        and a1.approver_id = o.approver_one_id
        and a2.approver_id = o.approver_two_id
        and a1.approved_at is not null and a2.approved_at is not null
        and a1.consumed_at is null and a2.consumed_at is null
        and a1.expires_at > c.db_now and a2.expires_at > c.db_now
        and requester_session.revoked_at is null
        and requester_session.expires_at > c.db_now
        and requester_session.mfa_verified_at <= c.db_now
        and requester_session.mfa_verified_at >= c.db_now - interval '15 minutes'
        and approver_one_session.mfa_verified_at = a1.approver_mfa_verified_at
        and approver_one_session.revoked_at is null
        and approver_one_session.expires_at > c.db_now
        and approver_one_session.mfa_verified_at <= c.db_now
        and approver_one_session.mfa_verified_at >= c.db_now - interval '15 minutes'
        and approver_two_session.mfa_verified_at = a2.approver_mfa_verified_at
        and approver_two_session.revoked_at is null
        and approver_two_session.expires_at > c.db_now
        and approver_two_session.mfa_verified_at <= c.db_now
        and approver_two_session.mfa_verified_at >= c.db_now - interval '15 minutes'
      for update of o, a1, a2
    `);
    const row = override.rows[0];
    const expectedPayloadHash =
      row === undefined
        ? undefined
        : canonicalAdminPayloadHash(expertReferralOverrideApprovalPayload(row));
    if (
      row === undefined ||
      row.requesterId === row.approverOneId ||
      row.requesterId === row.approverTwoId ||
      row.approverOneId === row.approverTwoId ||
      row.approvalOnePayloadHash !== expectedPayloadHash ||
      row.approvalTwoPayloadHash !== expectedPayloadHash ||
      row.additionalQuota - row.consumedCount < required
    ) {
      throw new ExpertReferralCommandError(
        "EXPERT_REFERRAL_OVERRIDE_INVALID",
        "Expert referral issuance override is invalid",
      );
    }
    const approvals = await tx.execute<{ id: string }>(sql`
      update admin_approvals
      set consumed_at = clock_timestamp()
      where id in (${row.approvalOneId}::uuid, ${row.approvalTwoId}::uuid)
        and consumed_at is null
      returning id
    `);
    if (approvals.rows.length !== 2) {
      throw new ExpertReferralCommandError(
        "EXPERT_REFERRAL_OVERRIDE_INVALID",
        "Expert referral issuance override is invalid",
      );
    }
    const consumed = await tx.execute<{ consumedCount: number }>(sql`
      update expert_referral_issuance_overrides
      set consumed_count = consumed_count + ${required}
      where id = ${overrideId}::uuid
        and consumed_count = 0
        and consumed_count + ${required} <= additional_quota
      returning consumed_count as "consumedCount"
    `);
    if (consumed.rows.length !== 1) {
      throw new ExpertReferralCommandError(
        "EXPERT_REFERRAL_OVERRIDE_INVALID",
        "Expert referral issuance override is invalid",
      );
    }
  }

  private async refreshBatchStatus(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    batchId: string,
  ): Promise<void> {
    const codes = await tx.execute<{ status: ExpertReferralCodeStatus }>(sql`
      select status
      from expert_referral_codes
      where batch_id = ${batchId}::uuid
      order by id
      for update
    `);
    const status = deriveExpertReferralBatchStatus(
      codes.rows.map((row) => row.status),
    );
    await tx.execute(sql`
      update expert_referral_code_batches
      set status = ${status}::expert_referral_batch_status
      where id = ${batchId}::uuid
    `);
  }
}
