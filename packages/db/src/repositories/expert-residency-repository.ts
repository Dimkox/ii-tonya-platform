import { randomUUID } from "node:crypto";
import { allocateCreditFifo, quoteResidency } from "@ii-tonya/domain";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  ExpertReferralControlError,
  type ExpertReferralAdminEvidence,
  type ExpertReferralTransaction,
  PostgresExpertReferralControlRepository,
  appendExpertReferralAuditEvent,
  assertExpertReferralAuditReplay,
  validateAndConsumeExpertReferralAdminEvidence,
} from "./expert-referral-control-repository.js";
import { withSerializableRetry } from "./message-repository.js";

export interface CreateTariffVersion extends ExpertReferralAdminEvidence {
  readonly tariffVersionId: string;
  readonly tariffKey: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly priceMinor: bigint;
  readonly durationSeconds: number;
  readonly activeFrom: Date;
  readonly activeTo: Date | null;
}

export interface RetireTariffVersion extends ExpertReferralAdminEvidence {
  readonly tariffVersionId: string;
  readonly activeTo: Date;
}

export interface ResidencyQuoteRequest {
  readonly expertId: string;
  readonly tariffKey: string;
}

export interface CreateCheckoutOrder {
  readonly expertId: string;
  readonly tariffKey: string;
  readonly providerDeadline: Date;
  readonly idempotencyKey: string;
}

export interface ReleaseExpiredOrders {
  readonly orderId: string;
}

export interface ResidencyQuote {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly description: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
  readonly creditMinor: string;
  readonly cashMinor: string;
}

export interface ResidencyCheckoutOrder extends ResidencyQuote {
  readonly orderId: string;
  readonly expertId: string;
  readonly paymentDeadline: Date;
  readonly providerDeadline: Date;
  readonly status: "quoted" | "payment_pending" | "settled" | "failed" | "expired" | "refunded" | "charged_back";
  readonly allocations: readonly { readonly grantId: string; readonly amountMinor: string }[];
}

export interface ReferralCreditBalance {
  readonly spendableBalanceMinor: string;
  readonly reservedBalanceMinor: string;
  readonly debtMinor: string;
  readonly nearestExpiryAt: Date | null;
  readonly lifetimeGrantedMinor: string;
  readonly lifetimeSpentMinor: string;
  readonly lifetimeExpiredMinor: string;
}

export type ExpiryReleaseResult =
  | { readonly kind: "settlement_allowed"; readonly released: false }
  | { readonly kind: "expired"; readonly released: boolean };

export class ExpertResidencyRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly databaseCode?: string,
    readonly databaseConstraint?: string,
  ) {
    super(code);
    this.name = "ExpertResidencyRepositoryError";
  }
}

interface TariffRow extends Record<string, unknown> {
  tariffVersionId: string;
  tariffKey: string;
  version: number;
  displayName: string;
  description: string;
  priceMinor: bigint | string;
  currency: "RUB";
  durationSeconds: number;
  activeFrom: Date | string;
  activeTo: Date | string | null;
}

interface BalanceRow extends Record<string, unknown> {
  spendableBalanceMinor: bigint | string;
  reservedBalanceMinor: bigint | string;
  debtMinor: bigint | string;
  nearestExpiryAt: Date | string | null;
  lifetimeGrantedMinor: bigint | string;
  lifetimeSpentMinor: bigint | string;
  lifetimeExpiredMinor: bigint | string;
}

interface GrantRow extends Record<string, unknown> {
  grantId: string;
  availableMinor: bigint | string;
  grantedAt: Date | string;
  expiresAt: Date | string;
}

interface OrderRow extends TariffRow, Record<string, unknown> {
  orderId: string;
  expertId: string;
  creditMinor: bigint | string;
  cashMinor: bigint | string;
  paymentDeadline: Date | string;
  providerDeadline: Date | string;
  status: "quoted" | "payment_pending" | "expired" | "settled" | "failed" | "refunded" | "charged_back";
}

interface AllocationRow extends Record<string, unknown> {
  grantId: string;
  amountMinor: bigint | string;
}

interface NowRow extends Record<string, unknown> { now: Date | string }

function bigint(value: bigint | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function date(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("invalid_database_timestamp");
  return parsed;
}

function validDate(value: Date, code: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ExpertResidencyRepositoryError(code);
  }
  return value;
}

function requireText(value: string, code: string): string {
  if (value.trim().length === 0 || value.length > 500) {
    throw new ExpertResidencyRepositoryError(code);
  }
  return value;
}

function requireTariffCommand(command: CreateTariffVersion): void {
  requireText(command.tariffVersionId, "invalid_tariff_version_id");
  requireText(command.tariffKey, "invalid_tariff_key");
  requireText(command.displayName, "invalid_tariff_display_name");
  requireText(command.description, "invalid_tariff_description");
  if (!Number.isSafeInteger(command.version) || command.version < 1) {
    throw new ExpertResidencyRepositoryError("invalid_tariff_version");
  }
  if (command.priceMinor <= 0n) throw new ExpertResidencyRepositoryError("invalid_tariff_price");
  if (!Number.isSafeInteger(command.durationSeconds)
    || command.durationSeconds < 86_400 || command.durationSeconds > 315_360_000) {
    throw new ExpertResidencyRepositoryError("invalid_tariff_duration");
  }
  const activeFrom = validDate(command.activeFrom, "invalid_tariff_activation");
  if (command.activeTo !== null && validDate(command.activeTo, "invalid_tariff_activation") <= activeFrom) {
    throw new ExpertResidencyRepositoryError("invalid_tariff_activation");
  }
}

function databaseDiagnostic(error: unknown): { databaseCode?: string; databaseConstraint?: string } {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return typeof candidate.constraint === "string"
        ? { databaseCode: candidate.code, databaseConstraint: candidate.constraint }
        : { databaseCode: candidate.code };
    }
    current = candidate.cause;
  }
  return {};
}

function isKnown(error: unknown): boolean {
  return error instanceof ExpertResidencyRepositoryError || error instanceof ExpertReferralControlError;
}

function tariffResult(row: TariffRow, creditMinor: bigint, cashMinor: bigint): ResidencyQuote {
  return {
    tariffVersionId: row.tariffVersionId,
    displayName: row.displayName,
    description: row.description,
    priceMinor: bigint(row.priceMinor).toString(),
    currency: "RUB",
    durationSeconds: row.durationSeconds,
    creditMinor: creditMinor.toString(),
    cashMinor: cashMinor.toString(),
  };
}

function orderResult(row: OrderRow, allocations: readonly AllocationRow[]): ResidencyCheckoutOrder {
  return {
    ...tariffResult(row, bigint(row.creditMinor), bigint(row.cashMinor)),
    orderId: row.orderId,
    expertId: row.expertId,
    paymentDeadline: date(row.paymentDeadline),
    providerDeadline: date(row.providerDeadline),
    status: row.status,
    allocations: allocations.map((allocation) => ({
      grantId: allocation.grantId,
      amountMinor: bigint(allocation.amountMinor).toString(),
    })),
  };
}

export class PostgresExpertResidencyRepository {
  private readonly controls: PostgresExpertReferralControlRepository;

  constructor(private readonly db: DrizzleDb) {
    this.controls = new PostgresExpertReferralControlRepository(db);
  }

  async createTariffVersion(command: CreateTariffVersion): Promise<ResidencyQuote> {
    requireTariffCommand(command);
    try {
      return await withSerializableRetry(() => this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`expert-residency:tariff:${command.tariffKey}`}, 0))`);
        const evidence = await validateAndConsumeExpertReferralAdminEvidence(tx, command, {
          action: "expert_residency.tariff_create",
          objectType: "expert",
          objectId: command.tariffVersionId,
          payload: tariffPayload(command),
        });
        const existing = await this.tariffByApproval(tx, command.approvalId);
        if (existing !== undefined) {
          if (!evidence.replay || existing.tariffVersionId !== command.tariffVersionId) {
            throw new ExpertResidencyRepositoryError("tariff_create_approval_conflict");
          }
          await assertExpertReferralAuditReplay(tx, {
            ...command,
            action: "expert_residency.tariff_create",
            objectId: existing.tariffVersionId,
            reasonCode: "tariff_version_created",
            metadata: tariffPayload(command),
            conflictCode: "tariff_create_replay_conflict",
          });
          return tariffResult(existing, 0n, bigint(existing.priceMinor));
        }
        if (evidence.replay) throw new ExpertResidencyRepositoryError("tariff_create_approval_replayed");
        const row = (await tx.execute<TariffRow>(sql`
          insert into expert_residency_tariff_versions (
            id, tariff_key, version, display_name, description, price_minor,
            currency, duration_seconds, active_from, active_to,
            created_by_admin_id, approval_id, admin_session_id_hash
          ) values (
            ${command.tariffVersionId}::uuid, ${command.tariffKey}, ${command.version},
            ${command.displayName}, ${command.description}, ${command.priceMinor}, 'RUB',
            ${command.durationSeconds}, ${command.activeFrom}, ${command.activeTo},
            ${command.adminId}::uuid, ${command.approvalId}::uuid, ${command.sessionIdHash}
          ) returning id as "tariffVersionId", tariff_key as "tariffKey", version,
            display_name as "displayName", description, price_minor as "priceMinor",
            currency, duration_seconds as "durationSeconds", active_from as "activeFrom",
            active_to as "activeTo"
        `)).rows[0];
        if (row === undefined) throw new Error("tariff_insert_failed");
        await appendExpertReferralAuditEvent(tx, {
          ...command,
          action: "expert_residency.tariff_create",
          objectType: "expert_residency_tariff_version",
          objectId: row.tariffVersionId,
          reasonCode: "tariff_version_created",
          metadata: tariffPayload(command),
        });
        return tariffResult(row, 0n, bigint(row.priceMinor));
      }));
    } catch (error) {
      if (isKnown(error)) throw error;
      const diagnostic = databaseDiagnostic(error);
      if (diagnostic.databaseConstraint === "expert_tariff_active_interval_exclusion") {
        throw new ExpertResidencyRepositoryError("tariff_activation_overlap", diagnostic.databaseCode, diagnostic.databaseConstraint);
      }
      throw new ExpertResidencyRepositoryError("tariff_create_failed", diagnostic.databaseCode, diagnostic.databaseConstraint);
    }
  }

  async retireTariffVersion(command: RetireTariffVersion): Promise<void> {
    validDate(command.activeTo, "invalid_tariff_retirement");
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const tariff = (await tx.execute<TariffRow>(sql`
        select id as "tariffVersionId", tariff_key as "tariffKey", version,
          display_name as "displayName", description, price_minor as "priceMinor",
          currency, duration_seconds as "durationSeconds", active_from as "activeFrom", active_to as "activeTo"
        from expert_residency_tariff_versions where id = ${command.tariffVersionId}::uuid for update
      `)).rows[0];
      if (tariff === undefined) throw new ExpertResidencyRepositoryError("tariff_not_found");
      const payload = { activeTo: command.activeTo.toISOString() };
      const evidence = await validateAndConsumeExpertReferralAdminEvidence(tx, command, {
        action: "expert_residency.tariff_retire", objectType: "expert", objectId: command.tariffVersionId, payload,
      });
      if (evidence.replay) {
        if (tariff.activeTo === null || date(tariff.activeTo).getTime() !== command.activeTo.getTime()) {
          throw new ExpertResidencyRepositoryError("tariff_retire_replay_conflict");
        }
        await assertExpertReferralAuditReplay(tx, {
          ...command, action: "expert_residency.tariff_retire", objectId: command.tariffVersionId,
          reasonCode: "tariff_version_retired", metadata: payload, conflictCode: "tariff_retire_replay_conflict",
        });
        return;
      }
      if (command.activeTo <= date(tariff.activeFrom)) throw new ExpertResidencyRepositoryError("invalid_tariff_retirement");
      await tx.execute(sql`update expert_residency_tariff_versions set active_to = ${command.activeTo} where id = ${command.tariffVersionId}::uuid`);
      await appendExpertReferralAuditEvent(tx, {
        ...command, action: "expert_residency.tariff_retire", objectType: "expert_residency_tariff_version",
        objectId: command.tariffVersionId, reasonCode: "tariff_version_retired", metadata: payload,
      });
    }));
  }

  async quote(request: ResidencyQuoteRequest): Promise<ResidencyQuote> {
    requireText(request.expertId, "invalid_expert_id");
    requireText(request.tariffKey, "invalid_tariff_key");
    return this.db.transaction(async (tx) => {
      const eligibility = await this.controls.lockEligibility(tx, request.expertId);
      if (!eligibility.found || !eligibility.active || !eligibility.verified || !eligibility.userActive) {
        throw new ExpertResidencyRepositoryError("expert_not_eligible_for_residency");
      }
      const tariff = await this.activeTariff(tx, request.tariffKey);
      const balance = await this.balanceIn(tx, request.expertId);
      const quoted = quoteResidency(bigint(tariff.priceMinor), bigint(balance.spendableBalanceMinor), bigint(balance.debtMinor));
      return tariffResult(tariff, quoted.creditMinor, quoted.cashMinor);
    });
  }

  async balance(expertId: string): Promise<ReferralCreditBalance> {
    requireText(expertId, "invalid_expert_id");
    return this.db.transaction((tx) => this.balanceIn(tx, expertId));
  }

  async createCheckoutOrder(command: CreateCheckoutOrder): Promise<ResidencyCheckoutOrder> {
    requireText(command.expertId, "invalid_expert_id");
    requireText(command.tariffKey, "invalid_tariff_key");
    requireText(command.idempotencyKey, "invalid_checkout_idempotency_key");
    validDate(command.providerDeadline, "invalid_provider_deadline");
    try {
      return await withSerializableRetry(() => this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`expert-residency:checkout:${command.expertId}`}, 0))`);
        const existing = await this.orderByIdempotency(tx, command.idempotencyKey);
        if (existing !== undefined) {
          if (
            existing.expertId !== command.expertId
            || existing.tariffKey !== command.tariffKey
            || date(existing.providerDeadline).getTime() !== command.providerDeadline.getTime()
          ) {
            throw new ExpertResidencyRepositoryError("checkout_idempotency_conflict");
          }
          return orderResult(existing, await this.orderAllocations(tx, existing.orderId));
        }
        const eligibility = await this.controls.lockEligibility(tx, command.expertId);
        if (!eligibility.found || !eligibility.active || !eligibility.verified || !eligibility.userActive) {
          throw new ExpertResidencyRepositoryError("expert_not_eligible_for_residency");
        }
        const now = await this.databaseNow(tx);
        if (command.providerDeadline <= now) throw new ExpertResidencyRepositoryError("invalid_provider_deadline");
        const tariff = await this.activeTariff(tx, command.tariffKey);
        await this.lockCreditGrants(tx, command.expertId);
        const balance = await this.balanceIn(tx, command.expertId);
        const quote = quoteResidency(bigint(tariff.priceMinor), bigint(balance.spendableBalanceMinor), bigint(balance.debtMinor));
        const grants = await this.availableGrants(tx, command.expertId);
        const allocations = allocateCreditFifo({
          at: now,
          allocationMinor: quote.creditMinor,
          grants: grants.map((grant) => ({
            grantId: grant.grantId,
            availableMinor: bigint(grant.availableMinor),
            grantedAt: date(grant.grantedAt),
            expiresAt: date(grant.expiresAt),
          })),
        });
        const earliestExpiry = allocations.length === 0 ? null : allocations.reduce((earliest, allocation) => {
          const grant = grants.find((candidate) => candidate.grantId === allocation.grantId);
          if (grant === undefined) throw new Error("allocated_grant_missing");
          const expiresAt = date(grant.expiresAt);
          return expiresAt < earliest ? expiresAt : earliest;
        }, date(grants.find((grant) => grant.grantId === allocations[0]!.grantId)!.expiresAt));
        const paymentDeadline = earliestExpiry !== null && earliestExpiry < command.providerDeadline
          ? earliestExpiry : command.providerDeadline;
        const orderId = randomUUID();
        const order = (await tx.execute<OrderRow>(sql`
          insert into expert_residency_orders (
            id, expert_id, tariff_version_id, tariff_name, tariff_description,
            price_minor, currency, duration_seconds, credit_minor, cash_minor,
            payment_deadline, provider_deadline, idempotency_key, status, quoted_at
          ) values (
            ${orderId}::uuid, ${command.expertId}::uuid, ${tariff.tariffVersionId}::uuid,
            ${tariff.displayName}, ${tariff.description}, ${bigint(tariff.priceMinor)}, 'RUB',
            ${tariff.durationSeconds}, ${quote.creditMinor}, ${quote.cashMinor},
            ${paymentDeadline}, ${command.providerDeadline}, ${command.idempotencyKey}, 'quoted', ${now}
          ) returning id as "orderId", expert_id as "expertId", tariff_version_id as "tariffVersionId",
            tariff_name as "displayName", tariff_description as description, price_minor as "priceMinor",
            currency, duration_seconds as "durationSeconds", credit_minor as "creditMinor",
            cash_minor as "cashMinor", payment_deadline as "paymentDeadline", provider_deadline as "providerDeadline", status,
            ${tariff.tariffKey} as "tariffKey", ${tariff.version} as version
        `)).rows[0];
        if (order === undefined) throw new Error("checkout_order_insert_failed");
        if (allocations.length > 0) await this.appendReservation(tx, orderId, command.expertId, allocations);
        return orderResult(order, allocations.map((allocation) => ({ grantId: allocation.grantId, amountMinor: allocation.amountMinor })));
      }));
    } catch (error) {
      if (isKnown(error)) throw error;
      const diagnostic = databaseDiagnostic(error);
      if (diagnostic.databaseCode === "23505") throw new ExpertResidencyRepositoryError("checkout_idempotency_conflict", diagnostic.databaseCode, diagnostic.databaseConstraint);
      throw new ExpertResidencyRepositoryError("checkout_create_failed", diagnostic.databaseCode, diagnostic.databaseConstraint);
    }
  }

  async releaseExpiredOrders(command: ReleaseExpiredOrders): Promise<ExpiryReleaseResult> {
    requireText(command.orderId, "invalid_order_id");
    return withSerializableRetry(() => this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const decision = (await tx.execute<{ decision: "settlement_allowed" | "expire_and_release"; status: OrderRow["status"] }>(sql`
        select expert_residency_payment_deadline_state(payment_deadline) as decision,
          status
        from expert_residency_orders where id = ${command.orderId}::uuid for update
      `)).rows[0];
      if (decision === undefined) throw new ExpertResidencyRepositoryError("order_not_found");
      if (decision.decision === "settlement_allowed") return { kind: "settlement_allowed", released: false };
      if (decision.status === "expired") return { kind: "expired", released: false };
      if (decision.status !== "quoted" && decision.status !== "payment_pending") {
        return { kind: "expired", released: false };
      }
      const reservation = (await tx.execute<{ id: string; accountExpertId: string; amountMinor: bigint | string }>(sql`
        select l.id, l.account_expert_id as "accountExpertId", l.amount_minor as "amountMinor"
        from expert_referral_ledger_entries l
        where l.entry_kind = 'reservation' and l.source_type = 'residency_order'
          and l.source_id = ${command.orderId}::uuid
          and not exists (select 1 from expert_referral_ledger_entries terminal
            where terminal.original_entry_id = l.id and terminal.entry_kind in ('release', 'spend'))
        for update
      `)).rows[0];
      await tx.execute(sql`update expert_residency_orders set status = 'expired', updated_at = clock_timestamp() where id = ${command.orderId}::uuid`);
      if (reservation === undefined) return { kind: "expired", released: false };
      const releaseId = randomUUID();
      await tx.execute(sql`
        insert into expert_referral_ledger_entries (
          id, account_expert_id, entry_kind, amount_minor, source_type, source_id,
          original_entry_id, idempotency_key
        ) values (
          ${releaseId}::uuid, ${reservation.accountExpertId}::uuid, 'release', ${-bigint(reservation.amountMinor)},
          'residency_order', ${command.orderId}::uuid, ${reservation.id}::uuid,
          ${`residency-release:${command.orderId}`}
        )
      `);
      const allocations = await this.reservationAllocations(tx, reservation.id);
      for (const allocation of allocations) {
        await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, amount_minor)
          values (${releaseId}::uuid, ${allocation.grantId}::uuid, ${bigint(allocation.amountMinor)})`);
      }
      return { kind: "expired", released: true };
    }));
  }

  private async activeTariff(tx: ExpertReferralTransaction, tariffKey: string): Promise<TariffRow> {
    const rows = (await tx.execute<TariffRow>(sql`
      select id as "tariffVersionId", tariff_key as "tariffKey", version,
        display_name as "displayName", description, price_minor as "priceMinor",
        currency, duration_seconds as "durationSeconds", active_from as "activeFrom", active_to as "activeTo"
      from expert_residency_tariff_versions
      where tariff_key = ${tariffKey} and active_from <= transaction_timestamp()
        and (active_to is null or transaction_timestamp() < active_to)
      order by active_from desc, version desc for share
    `)).rows;
    if (rows.length !== 1 || rows[0] === undefined) throw new ExpertResidencyRepositoryError("tariff_not_active");
    return rows[0];
  }

  private async tariffByApproval(tx: ExpertReferralTransaction, approvalId: string): Promise<TariffRow | undefined> {
    return (await tx.execute<TariffRow>(sql`
      select id as "tariffVersionId", tariff_key as "tariffKey", version,
        display_name as "displayName", description, price_minor as "priceMinor",
        currency, duration_seconds as "durationSeconds", active_from as "activeFrom", active_to as "activeTo"
      from expert_residency_tariff_versions where approval_id = ${approvalId}::uuid for update
    `)).rows[0];
  }

  private async databaseNow(tx: ExpertReferralTransaction): Promise<Date> {
    const row = (await tx.execute<NowRow>(sql`select transaction_timestamp() as now`)).rows[0];
    if (row === undefined) throw new Error("database_clock_unavailable");
    return date(row.now);
  }

  private async balanceIn(tx: ExpertReferralTransaction, expertId: string): Promise<ReferralCreditBalance> {
    const row = (await tx.execute<BalanceRow>(sql`
      select spendable_balance_minor as "spendableBalanceMinor", reserved_balance_minor as "reservedBalanceMinor",
        debt_minor as "debtMinor", nearest_expiry_at as "nearestExpiryAt",
        lifetime_granted_minor as "lifetimeGrantedMinor", lifetime_spent_minor as "lifetimeSpentMinor",
        lifetime_expired_minor as "lifetimeExpiredMinor"
      from expert_referral_balances where expert_id = ${expertId}::uuid
    `)).rows[0];
    if (row === undefined) return {
      spendableBalanceMinor: "0", reservedBalanceMinor: "0", debtMinor: "0", nearestExpiryAt: null,
      lifetimeGrantedMinor: "0", lifetimeSpentMinor: "0", lifetimeExpiredMinor: "0",
    };
    return {
      spendableBalanceMinor: bigint(row.spendableBalanceMinor).toString(),
      reservedBalanceMinor: bigint(row.reservedBalanceMinor).toString(), debtMinor: bigint(row.debtMinor).toString(),
      nearestExpiryAt: row.nearestExpiryAt === null ? null : date(row.nearestExpiryAt),
      lifetimeGrantedMinor: bigint(row.lifetimeGrantedMinor).toString(), lifetimeSpentMinor: bigint(row.lifetimeSpentMinor).toString(),
      lifetimeExpiredMinor: bigint(row.lifetimeExpiredMinor).toString(),
    };
  }

  private async lockCreditGrants(tx: ExpertReferralTransaction, expertId: string): Promise<void> {
    await tx.execute(sql`select id from expert_referral_reward_grants
      where inviter_expert_id = ${expertId}::uuid and expires_at > transaction_timestamp()
      order by expires_at, granted_at, id for update`);
  }

  private async availableGrants(tx: ExpertReferralTransaction, expertId: string): Promise<GrantRow[]> {
    return (await tx.execute<GrantRow>(sql`
      with grant_positions as (
        select g.id as "grantId", g.granted_at as "grantedAt", g.expires_at as "expiresAt",
          coalesce(sum(case
            when l.entry_kind in ('release', 'debt_repayment') then 0
            when l.entry_kind = 'reservation' and exists (select 1 from expert_referral_ledger_entries terminal
              where terminal.original_entry_id = l.id and terminal.entry_kind in ('release', 'spend')) then 0
            when l.amount_minor < 0 then -a.amount_minor else a.amount_minor end), 0)::bigint as "availableMinor"
        from expert_referral_reward_grants g
        left join expert_referral_ledger_allocations a on a.reward_grant_id = g.id
        left join expert_referral_ledger_entries l on l.id = a.ledger_entry_id
        where g.inviter_expert_id = ${expertId}::uuid and g.expires_at > transaction_timestamp()
        group by g.id, g.granted_at, g.expires_at
      ) select * from grant_positions where "availableMinor" > 0
      order by "expiresAt", "grantedAt", "grantId"
    `)).rows;
  }

  private async appendReservation(tx: ExpertReferralTransaction, orderId: string, expertId: string, allocations: readonly { grantId: string; amountMinor: bigint }[]): Promise<void> {
    const reservationId = randomUUID();
    const amount = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0n);
    await tx.execute(sql`insert into expert_referral_ledger_entries (
      id, account_expert_id, entry_kind, amount_minor, source_type, source_id, idempotency_key
    ) values (${reservationId}::uuid, ${expertId}::uuid, 'reservation', ${-amount},
      'residency_order', ${orderId}::uuid, ${`residency-reservation:${orderId}`})`);
    for (const allocation of allocations) {
      await tx.execute(sql`insert into expert_referral_ledger_allocations (ledger_entry_id, reward_grant_id, amount_minor)
        values (${reservationId}::uuid, ${allocation.grantId}::uuid, ${allocation.amountMinor})`);
    }
  }

  private async orderByIdempotency(tx: ExpertReferralTransaction, idempotencyKey: string): Promise<OrderRow | undefined> {
    return (await tx.execute<OrderRow>(sql`
      select o.id as "orderId", o.expert_id as "expertId", o.tariff_version_id as "tariffVersionId",
        o.tariff_name as "displayName", o.tariff_description as description, o.price_minor as "priceMinor",
        o.currency, o.duration_seconds as "durationSeconds", o.credit_minor as "creditMinor", o.cash_minor as "cashMinor",
        o.payment_deadline as "paymentDeadline", o.provider_deadline as "providerDeadline", o.status, t.tariff_key as "tariffKey", t.version,
        t.active_from as "activeFrom", t.active_to as "activeTo"
      from expert_residency_orders o join expert_residency_tariff_versions t on t.id = o.tariff_version_id
      where o.idempotency_key = ${idempotencyKey} for update of o
    `)).rows[0];
  }

  private async orderAllocations(tx: ExpertReferralTransaction, orderId: string): Promise<AllocationRow[]> {
    return (await tx.execute<AllocationRow>(sql`
      select a.reward_grant_id as "grantId", a.amount_minor as "amountMinor"
      from expert_referral_ledger_entries l join expert_referral_ledger_allocations a on a.ledger_entry_id = l.id
      join expert_referral_reward_grants g on g.id = a.reward_grant_id
      where l.entry_kind = 'reservation' and l.source_type = 'residency_order' and l.source_id = ${orderId}::uuid
      order by g.expires_at, g.granted_at, g.id
    `)).rows;
  }

  private async reservationAllocations(tx: ExpertReferralTransaction, reservationId: string): Promise<AllocationRow[]> {
    return (await tx.execute<AllocationRow>(sql`select reward_grant_id as "grantId", amount_minor as "amountMinor"
      from expert_referral_ledger_allocations where ledger_entry_id = ${reservationId}::uuid order by reward_grant_id`)).rows;
  }
}

function tariffPayload(command: CreateTariffVersion): Record<string, string | number | null> {
  return {
    tariffKey: command.tariffKey, version: command.version, displayName: command.displayName,
    description: command.description, priceMinor: command.priceMinor.toString(), durationSeconds: command.durationSeconds,
    activeFrom: command.activeFrom.toISOString(), activeTo: command.activeTo?.toISOString() ?? null,
  };
}
