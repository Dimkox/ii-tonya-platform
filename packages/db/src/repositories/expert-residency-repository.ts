import { sql, type SQL } from "drizzle-orm";
import { quoteResidency } from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";

export class ExpertResidencyCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExpertResidencyCommandError";
  }
}

export interface TariffVersionCommand {
  tariffKey: string;
  displayName: string;
  priceMinor: bigint;
  durationSeconds: number;
  activeFrom: Date;
  activeTo: Date;
  approvalId: string;
  adminSessionIdHash: string;
}
const MAX_MONEY_MINOR = 999_999_999_999n;
const MAX_TARIFF_KEY_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 256;

export function validateTariffVersionCommand(
  command: TariffVersionCommand,
): void {
  if (
    !validDate(command.activeFrom) ||
    !validDate(command.activeTo) ||
    command.activeTo <= command.activeFrom ||
    typeof command.priceMinor !== "bigint" ||
    command.priceMinor <= 0n ||
    command.priceMinor > MAX_MONEY_MINOR ||
    !Number.isSafeInteger(command.durationSeconds) ||
    command.durationSeconds < 86400 ||
    command.durationSeconds > 315360000 ||
    command.tariffKey.trim().length < 1 ||
    command.tariffKey.length > MAX_TARIFF_KEY_LENGTH ||
    command.displayName.trim().length < 1 ||
    command.displayName.length > MAX_DISPLAY_NAME_LENGTH
  )
    throw new ExpertResidencyCommandError(
      "EXPERT_RESIDENCY_INVALID_TARIFF",
      "Invalid tariff version",
    );
}
export interface ResidencyQuote {
  tariffVersionId: string;
  displayName: string;
  priceMinor: string;
  currency: "RUB";
  durationSeconds: number;
  creditMinor: string;
  cashMinor: string;
  commercialPolicyVersion: "legacy_residency_v1" | "expert_residency_v2";
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
}
export interface ResidencyOrder extends ResidencyQuote {
  id: string;
  expertId: string;
  paymentDeadline: string;
  status: "payment_pending" | "expired";
  allocations: readonly { grantId: string; amountMinor: string }[];
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}
function dateString(value: Date | string): string {
  return new Date(value).toISOString();
}
export function minPaymentDeadline(left: Date, right: Date): Date {
  if (!validDate(left) || !validDate(right))
    throw new ExpertResidencyCommandError(
      "EXPERT_RESIDENCY_INVALID_DEADLINE",
      "Invalid payment deadline",
    );
  return left <= right ? new Date(left) : new Date(right);
}
export function parseMoneySnapshot(input: {
  priceMinor: bigint;
  creditMinor: bigint;
  cashMinor: bigint;
}) {
  return {
    priceMinor: input.priceMinor.toString(),
    creditMinor: input.creditMinor.toString(),
    cashMinor: input.cashMinor.toString(),
  };
}

type TariffRow = {
  id: string;
  displayName: string;
  priceMinor: bigint | string;
  currency: "RUB";
  durationSeconds: number;
  commercialPolicyVersion: "legacy_residency_v1" | "expert_residency_v2";
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
};
export interface ActiveResidencyTariff {
  readonly tariffVersionId: string;
  readonly displayName: string;
  readonly priceMinor: string;
  readonly currency: "RUB";
  readonly durationSeconds: number;
  readonly commercialPolicyVersion:
    "legacy_residency_v1" | "expert_residency_v2";
  readonly creditCapBps: number;
  readonly individualServicesEnabled: boolean;
  readonly groupEventLimit: number;
  readonly statisticsLevel: "basic" | "expanded";
  readonly supportPriority: "standard" | "priority";
}
type OrderRow = TariffRow & {
  expertId: string;
  paymentDeadline: Date | string;
  status: "payment_pending" | "expired";
  creditMinor: bigint;
  cashMinor: bigint;
  providerDeadline: Date | string;
  individualServicesEnabled: boolean;
};

export function normalizeDatabaseMoney(
  value: bigint | string | number,
  field: string,
): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ExpertResidencyCommandError(
      "EXPERT_RESIDENCY_INVALID_DATABASE_MONEY",
      `Invalid database money value: ${field}`,
    );
  }
}

export function releaseAmountFromReservation(
  amountMinor: bigint | string,
): bigint {
  return -normalizeDatabaseMoney(amountMinor, "reservation.amountMinor");
}

type CreditTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const invalidCredit = () =>
  new ExpertResidencyCommandError(
    "EXPERT_RESIDENCY_CREDIT_ALLOCATION_INVALID",
    "Original credit allocation and release facts disagree",
  );

/** Caller holds the order lock. Validate immutable originals and every release,
 * not merely the presence of one release (legacy releases may be partial).
 */
export async function readLockedExpertCreditReservations(
  tx: CreditTransaction,
  order: { id: string; expertId: string },
) {
  const reservations = await tx.execute<{
    id: string;
    expertId: string;
    amount: string;
  }>(
    sql`select id,expert_id as "expertId",amount_minor::text amount from expert_referral_ledger_entries where order_id=${order.id}::uuid and entry_kind='reservation' order by id for update`,
  );
  const result: {
    id: string;
    amount: bigint;
    allocations: {
      grantId: string;
      original: bigint;
      released: bigint;
      remaining: bigint;
    }[];
  }[] = [];
  for (const reservation of reservations.rows) {
    if (
      reservation.expertId !== order.expertId ||
      BigInt(reservation.amount) >= 0n
    )
      throw invalidCredit();
    const spent = await tx.execute<{ present: boolean }>(
      sql`select exists(select 1 from expert_referral_ledger_entries where original_entry_id=${reservation.id}::uuid and entry_kind='spend') present`,
    );
    // This helper is used only before settlement's spend or for a cancelled
    // pending order. A previously spent reservation is never releasable here.
    if (spent.rows[0]!.present) throw invalidCredit();
    const originals = await tx.execute<{
      grantId: string;
      expertId: string;
      grantExpertId: string;
      amount: string;
    }>(
      sql`select a.reward_grant_id as "grantId",a.expert_id as "expertId",g.expert_id as "grantExpertId",a.amount_minor::text amount from expert_referral_ledger_allocations a join expert_referral_reward_grants g on g.id=a.reward_grant_id where a.ledger_entry_id=${reservation.id}::uuid order by a.reward_grant_id for update of a`,
    );
    const allocations = originals.rows.map((a) => {
      if (
        a.expertId !== order.expertId ||
        a.grantExpertId !== order.expertId ||
        BigInt(a.amount) >= 0n
      )
        throw invalidCredit();
      return {
        grantId: a.grantId,
        original: -BigInt(a.amount),
        released: 0n,
        remaining: -BigInt(a.amount),
      };
    });
    if (
      !allocations.length ||
      allocations.reduce((s, a) => s + a.original, 0n) !==
        -BigInt(reservation.amount)
    )
      throw invalidCredit();
    const releases = await tx.execute<{
      id: string;
      expertId: string;
      orderId: string;
      amount: string;
    }>(
      sql`select id,expert_id as "expertId",order_id as "orderId",amount_minor::text amount from expert_referral_ledger_entries where original_entry_id=${reservation.id}::uuid and entry_kind='release' order by id for update`,
    );
    for (const release of releases.rows) {
      if (
        release.expertId !== order.expertId ||
        release.orderId !== order.id ||
        BigInt(release.amount) <= 0n
      )
        throw invalidCredit();
      const parts = await tx.execute<{
        grantId: string;
        expertId: string;
        amount: string;
      }>(
        sql`select reward_grant_id as "grantId",expert_id as "expertId",amount_minor::text amount from expert_referral_ledger_allocations where ledger_entry_id=${release.id}::uuid order by reward_grant_id for update`,
      );
      if (
        !parts.rows.length ||
        parts.rows.reduce((s, a) => s + BigInt(a.amount), 0n) !==
          BigInt(release.amount)
      )
        throw invalidCredit();
      for (const part of parts.rows) {
        const original = allocations.find((a) => a.grantId === part.grantId);
        if (
          !original ||
          part.expertId !== order.expertId ||
          BigInt(part.amount) <= 0n
        )
          throw invalidCredit();
        original.released += BigInt(part.amount);
        original.remaining -= BigInt(part.amount);
        if (original.remaining < 0n) throw invalidCredit();
      }
    }
    result.push({
      id: reservation.id,
      amount: -BigInt(reservation.amount),
      allocations,
    });
  }
  const snapshot = await tx.execute<{ credit: string }>(
    sql`select credit_minor::text credit from expert_residency_orders where id=${order.id}::uuid and expert_id=${order.expertId}::uuid`,
  );
  if (
    !snapshot.rows[0] ||
    result.reduce((s, r) => s + r.amount, 0n) !==
      BigInt(snapshot.rows[0].credit)
  )
    throw invalidCredit();
  return result;
}

/** The order lock is shared by expiry, reversal and settlement. Append only the
 * outstanding inverse to the ORIGINAL grants, preserving historical partials.
 */
export async function releaseLockedExpertResidencyCredit(
  tx: CreditTransaction,
  order: { id: string; expertId: string },
  source: { type: string; id: string; keyPrefix: string },
) {
  const reservations = await readLockedExpertCreditReservations(tx, order);
  for (const reservation of reservations) {
    const remaining = reservation.allocations.filter((a) => a.remaining > 0n);
    const amount = remaining.reduce((s, a) => s + a.remaining, 0n);
    if (amount === 0n) continue;
    const baseKey = `${source.keyPrefix}:${reservation.id}`;
    const occupied = await tx.execute<{ valid: boolean }>(
      sql`select entry_kind='release' and expert_id=${order.expertId}::uuid and order_id=${order.id}::uuid and original_entry_id=${reservation.id}::uuid and source_type=${source.type} and source_id=${source.id}::uuid as valid from expert_referral_ledger_entries where idempotency_key=${baseKey}`,
    );
    if (occupied.rows[0] && !occupied.rows[0].valid) throw invalidCredit();
    // Preserve a historical partial release with this exact source key. A new
    // append-only remainder has a deterministic key; no original is rewritten.
    const key = occupied.rows.length
      ? `${baseKey}:remainder:${amount}`
      : baseKey;
    const release = await tx.execute<{ id: string }>(
      sql`insert into expert_referral_ledger_entries(expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) values(${order.expertId}::uuid,'release',${amount},${order.id}::uuid,${reservation.id}::uuid,${source.type},${source.id}::uuid,${key}) on conflict(idempotency_key) do nothing returning id`,
    );
    // An occupied key with an outstanding balance is not a successful replay.
    if (!release.rows[0]) throw invalidCredit();
    for (const a of remaining)
      await tx.execute(
        sql`insert into expert_referral_ledger_allocations(ledger_entry_id,reward_grant_id,expert_id,amount_minor) values(${release.rows[0].id}::uuid,${a.grantId}::uuid,${order.expertId}::uuid,${a.remaining})`,
      );
  }
  return reservations;
}

/** Caller owns the order row lock and transaction; never opens a nested transaction. */
export async function expireLockedExpertResidencyOrder(
  tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
  order: { id: string; expertId: string },
  deadlineClock: SQL,
): Promise<boolean> {
  const changed = await tx.execute<{ id: string }>(
    sql`update expert_residency_orders set status='expired',updated_at=${deadlineClock} where id=${order.id}::uuid and expert_id=${order.expertId}::uuid and status='payment_pending' and ${deadlineClock} >= payment_deadline returning id`,
  );
  if (!changed.rows[0]) return false;
  await releaseLockedExpertResidencyCredit(tx, order, {
    type: "residency_order",
    id: order.id,
    keyPrefix: "release",
  });
  return true;
}

export class PostgresExpertResidencyRepository {
  readonly #controls: PostgresExpertReferralControlRepository;
  constructor(private readonly db: DrizzleDb) {
    this.#controls = new PostgresExpertReferralControlRepository(db);
  }

  private async assertNewCommandsEnabled(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
  ): Promise<void> {
    if (!(await this.#controls.lockFeatureControl(tx)).newCommandsEnabled) {
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_DISABLED",
        "Expert residency commands are disabled",
      );
    }
  }

  async createTariffVersion(command: TariffVersionCommand): Promise<TariffRow> {
    validateTariffVersionCommand(command);
    const result = await this.db.execute<TariffRow>(
      sql`insert into expert_residency_tariff_versions (tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash) values (${command.tariffKey},${command.displayName},${command.priceMinor},'RUB',${command.durationSeconds},${command.activeFrom},${command.activeTo},${command.approvalId}::uuid,${command.adminSessionIdHash}) returning id,display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds"`,
    );
    return this.required(result.rows[0], "EXPERT_RESIDENCY_TARIFF_NOT_CREATED");
  }

  async listActiveTariffs(command: {
    expertId: string;
    limit: 20;
  }): Promise<readonly ActiveResidencyTariff[]> {
    if (command.limit !== 20) {
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_TARIFF_LIMIT",
        "Invalid active tariff limit",
      );
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      await this.assertNewCommandsEnabled(tx);
      await this.assertEligibleExpert(tx, command.expertId);
      const result = await tx.execute<TariffRow>(sql`
        select
          id,
          display_name as "displayName",
          price_minor as "priceMinor",
          currency,
          duration_seconds as "durationSeconds", commercial_policy_version as "commercialPolicyVersion", credit_cap_bps as "creditCapBps", individual_services_enabled as "individualServicesEnabled", group_event_limit as "groupEventLimit", statistics_level as "statisticsLevel", support_priority as "supportPriority"
        from expert_residency_tariff_versions
        where active_from <= transaction_timestamp()
          and transaction_timestamp() < active_to
        order by active_from, id
        limit ${command.limit}
      `);
      return result.rows.map((row) => this.toActiveTariff(row));
    });
  }

  async retireTariffVersion(command: {
    tariffVersionId: string;
    retiredAt: Date;
  }): Promise<{ id: string; activeTo: string }> {
    if (!validDate(command.retiredAt))
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_TARIFF",
        "Invalid retirement timestamp",
      );
    const result = await this.db.execute<{
      id: string;
      activeTo: Date | string;
    }>(
      sql`update expert_residency_tariff_versions set active_to=${command.retiredAt} where id=${command.tariffVersionId}::uuid and active_from < ${command.retiredAt} and active_to > ${command.retiredAt} returning id,active_to as "activeTo"`,
    );
    const row = this.required(
      result.rows[0],
      "EXPERT_RESIDENCY_TARIFF_NOT_ACTIVE",
    );
    return { id: row.id, activeTo: dateString(row.activeTo) };
  }

  async quote(input: {
    expertId: string;
    tariffVersionId: string;
  }): Promise<ResidencyQuote> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      await this.assertNewCommandsEnabled(tx);
      await this.assertEligibleExpert(tx, input.expertId);
      const tariff = await this.activeTariff(tx, input.tariffVersionId);
      const available = await this.availableCredit(tx, input.expertId);
      return this.toQuote(tariff, available);
    });
  }

  async createCheckoutOrder(command: {
    expertId: string;
    tariffVersionId: string;
    providerDeadline: Date;
    idempotencyKey: string;
  }): Promise<ResidencyOrder> {
    if (
      !validDate(command.providerDeadline) ||
      command.idempotencyKey.length < 1 ||
      command.idempotencyKey.length > 256
    )
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_CHECKOUT",
        "Invalid checkout command",
      );
    return withSerializableRetry(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level serializable`);
        await this.assertNewCommandsEnabled(tx);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.expertId}, 0))`,
        );
        const prior = await tx.execute<OrderRow>(
          sql`select id,expert_id as "expertId",tariff_version_id as "tariffVersionId",snapshot_display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds",credit_minor as "creditMinor",cash_minor as "cashMinor",commercial_policy_version as "commercialPolicyVersion",credit_cap_bps as "creditCapBps",individual_services_enabled as "individualServicesEnabled",group_event_limit as "groupEventLimit",statistics_level as "statisticsLevel",support_priority as "supportPriority",payment_deadline as "paymentDeadline",provider_deadline as "providerDeadline",status from expert_residency_orders where expert_id=${command.expertId}::uuid and idempotency_key=${command.idempotencyKey} for update`,
        );
        if (prior.rows[0]) {
          const stored = prior.rows[0] as OrderRow & {
            tariffVersionId: string;
          };
          if (
            stored.tariffVersionId !== command.tariffVersionId ||
            command.providerDeadline.getTime() !==
              new Date(stored.providerDeadline).getTime()
          )
            throw new ExpertResidencyCommandError(
              "EXPERT_RESIDENCY_IDEMPOTENCY_CONFLICT",
              "Checkout content conflicts with stored order",
            );
          return this.hydrateOrder(tx, stored);
        }
        await this.assertEligibleExpert(tx, command.expertId, true);
        const tariff = await this.activeTariff(tx, command.tariffVersionId);
        const nowResult = await tx.execute<{ dbNow: Date | string }>(
          sql`select transaction_timestamp() as "dbNow"`,
        );
        const dbNow = new Date(
          this.required(nowResult.rows[0], "EXPERT_RESIDENCY_CLOCK_MISSING")
            .dbNow,
        );
        if (command.providerDeadline <= dbNow)
          throw new ExpertResidencyCommandError(
            "EXPERT_RESIDENCY_DEADLINE_ELAPSED",
            "Provider deadline has elapsed",
          );
        const grants = await tx.execute<{
          id: string;
          expiresAt: Date | string;
          grantedAt: Date | string;
          remainingMinor: bigint | string;
        }>(
          sql`select g.id,g.expires_at as "expiresAt",g.granted_at as "grantedAt",coalesce((select sum(a.amount_minor) from expert_referral_ledger_allocations a where a.reward_grant_id=g.id),0)::bigint as "remainingMinor" from expert_referral_reward_grants g where g.expert_id=${command.expertId}::uuid and g.expires_at > transaction_timestamp() order by g.expires_at,g.granted_at,g.id for update of g`,
        );
        const normalizedGrants = grants.rows.map((g) => ({
          ...g,
          remainingMinor: normalizeDatabaseMoney(
            g.remainingMinor,
            "grant.remainingMinor",
          ),
        }));
        const available = normalizedGrants.reduce(
          (sum, g) => sum + (g.remainingMinor > 0n ? g.remainingMinor : 0n),
          0n,
        );
        const tariffPriceMinor = normalizeDatabaseMoney(
          tariff.priceMinor,
          "tariff.priceMinor",
        );
        const amounts = quoteResidency(
          tariffPriceMinor,
          available,
          tariff.creditCapBps,
        );
        let remaining = amounts.creditMinor;
        const allocations: {
          grantId: string;
          amountMinor: bigint;
          expiresAt: Date;
        }[] = [];
        for (const grant of normalizedGrants) {
          if (remaining === 0n) break;
          if (grant.remainingMinor <= 0n) continue;
          const amount =
            grant.remainingMinor < remaining ? grant.remainingMinor : remaining;
          allocations.push({
            grantId: grant.id,
            amountMinor: amount,
            expiresAt: new Date(grant.expiresAt),
          });
          remaining -= amount;
        }
        if (remaining !== 0n)
          throw new ExpertResidencyCommandError(
            "EXPERT_RESIDENCY_BALANCE_CHANGED",
            "Credit balance changed",
          );
        const deadline = allocations.reduce(
          (d, a) => minPaymentDeadline(d, a.expiresAt),
          command.providerDeadline,
        );
        const inserted = await tx.execute<{ id: string }>(
          sql`insert into expert_residency_orders (expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,commercial_policy_version,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,payment_deadline,provider_deadline,status,idempotency_key) values (${command.expertId}::uuid,${tariff.id}::uuid,${tariff.displayName},${tariffPriceMinor},'RUB',${tariff.durationSeconds},${amounts.creditMinor},${amounts.cashMinor},${tariff.commercialPolicyVersion},${tariff.creditCapBps},${tariff.individualServicesEnabled},${tariff.groupEventLimit},${tariff.statisticsLevel},${tariff.supportPriority},${deadline},${command.providerDeadline},'payment_pending',${command.idempotencyKey}) returning id`,
        );
        const orderId = this.required(
          inserted.rows[0],
          "EXPERT_RESIDENCY_ORDER_NOT_CREATED",
        ).id;
        if (amounts.creditMinor > 0n) {
          const entry = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,source_type,source_id,idempotency_key) values (${command.expertId}::uuid,'reservation',${-amounts.creditMinor},${orderId}::uuid,'residency_order',${orderId}::uuid,${`checkout:${command.expertId}:${command.idempotencyKey}`}) returning id`,
          );
          const entryId = this.required(
            entry.rows[0],
            "EXPERT_RESIDENCY_RESERVATION_NOT_CREATED",
          ).id;
          for (const allocation of allocations)
            await tx.execute(
              sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) values (${entryId}::uuid,${allocation.grantId}::uuid,${command.expertId}::uuid,${-allocation.amountMinor})`,
            );
        }
        return {
          id: orderId,
          expertId: command.expertId,
          ...this.toQuote(tariff, available),
          paymentDeadline: deadline.toISOString(),
          status: "payment_pending",
          allocations: allocations.map((a) => ({
            grantId: a.grantId,
            amountMinor: a.amountMinor.toString(),
          })),
        };
      }),
    );
  }

  async releaseExpiredOrders(
    limit = 100,
  ): Promise<{ examined: number; released: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_LIMIT",
        "Invalid release limit",
      );
    return this.db.transaction(async (tx) => {
      const orders = await tx.execute<{ id: string; expertId: string }>(
        sql`select id,expert_id as "expertId" from expert_residency_orders where status='payment_pending' and transaction_timestamp() >= payment_deadline order by payment_deadline,id limit ${limit} for update skip locked`,
      );
      let released = 0;
      for (const order of orders.rows) {
        if (
          await expireLockedExpertResidencyOrder(
            tx,
            order,
            sql`transaction_timestamp()`,
          )
        )
          released++;
      }
      return { examined: orders.rows.length, released };
    });
  }

  async balance(expertId: string) {
    const result = await this.db.execute<{
      availableCreditMinor: bigint;
      reservedCreditMinor: bigint;
      nearestExpiryAt: Date | string | null;
      debtMinor: bigint;
    }>(
      sql`with live_grants as (
        select coalesce(sum(a.amount_minor),0)::bigint as available,
          min(g.expires_at) filter (where coalesce(r.remaining,0) > 0) as nearest_expiry
        from expert_referral_reward_grants g
        join expert_referral_ledger_allocations a on a.reward_grant_id=g.id
        left join lateral (select sum(a2.amount_minor)::bigint as remaining from expert_referral_ledger_allocations a2 where a2.reward_grant_id=g.id) r on true
        where g.expert_id=${expertId}::uuid and g.expires_at > transaction_timestamp()
      ), totals as (
        select coalesce(sum(amount_minor),0)::bigint as net,
          coalesce(-sum(amount_minor) filter (where entry_kind in ('reservation','release')),0)::bigint as reserved
        from expert_referral_ledger_entries where expert_id=${expertId}::uuid
      ) select greatest(l.available-greatest(-t.net,0),0)::bigint as "availableCreditMinor",
        greatest(t.reserved,0)::bigint as "reservedCreditMinor", l.nearest_expiry as "nearestExpiryAt",
        greatest(-t.net,0)::bigint as "debtMinor" from live_grants l cross join totals t`,
    );
    const row = result.rows[0] ?? {
      availableCreditMinor: 0n,
      reservedCreditMinor: 0n,
      nearestExpiryAt: null,
      debtMinor: 0n,
    };
    return {
      availableCreditMinor: normalizeDatabaseMoney(
        row.availableCreditMinor,
        "balance.available",
      ).toString(),
      reservedCreditMinor: normalizeDatabaseMoney(
        row.reservedCreditMinor,
        "balance.reserved",
      ).toString(),
      nearestExpiryAt:
        row.nearestExpiryAt === null ? null : dateString(row.nearestExpiryAt),
      debtMinor: normalizeDatabaseMoney(
        row.debtMinor,
        "balance.debt",
      ).toString(),
    };
  }

  private async assertEligibleExpert(
    executor: Pick<DrizzleDb, "execute">,
    expertId: string,
    lock = false,
  ) {
    const result = await executor.execute<{
      active: boolean;
      verified: boolean;
    }>(
      sql`select active,verified from experts where id=${expertId}::uuid ${lock ? sql`for update` : sql``}`,
    );
    if (
      result.rows.length !== 1 ||
      !result.rows[0]!.active ||
      !result.rows[0]!.verified
    )
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_EXPERT_NOT_ELIGIBLE",
        "Expert is not eligible",
      );
  }
  private async activeTariff(executor: Pick<DrizzleDb, "execute">, id: string) {
    const result = await executor.execute<TariffRow>(
      sql`select id,display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds",commercial_policy_version as "commercialPolicyVersion",credit_cap_bps as "creditCapBps",individual_services_enabled as "individualServicesEnabled",group_event_limit as "groupEventLimit",statistics_level as "statisticsLevel",support_priority as "supportPriority" from expert_residency_tariff_versions where id=${id}::uuid and active_from <= transaction_timestamp() and transaction_timestamp() < active_to`,
    );
    if (result.rows.length !== 1)
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_TARIFF_NOT_ACTIVE",
        "Tariff is not active",
      );
    return result.rows[0]!;
  }
  private async availableCredit(
    executor: Pick<DrizzleDb, "execute">,
    expertId: string,
  ) {
    const result = await executor.execute<{ available: bigint | string }>(
      sql`with live as (
        select coalesce(sum(a.amount_minor),0)::bigint as amount
        from expert_referral_reward_grants g
        join expert_referral_ledger_allocations a on a.reward_grant_id=g.id
        where g.expert_id=${expertId}::uuid and g.expires_at > transaction_timestamp()
      ), ledger as (
        select coalesce(sum(amount_minor),0)::bigint as net
        from expert_referral_ledger_entries where expert_id=${expertId}::uuid
      ) select greatest(live.amount-greatest(-ledger.net,0),0)::bigint as available
      from live cross join ledger`,
    );
    return normalizeDatabaseMoney(
      result.rows[0]?.available ?? 0n,
      "availableCredit",
    );
  }
  private toQuote(t: TariffRow, available: bigint): ResidencyQuote {
    const priceMinor = normalizeDatabaseMoney(
      t.priceMinor,
      "tariff.priceMinor",
    );
    const q = quoteResidency(priceMinor, available, t.creditCapBps);
    return {
      tariffVersionId: t.id,
      displayName: t.displayName,
      ...parseMoneySnapshot({ priceMinor, ...q }),
      currency: "RUB",
      durationSeconds: t.durationSeconds,
      commercialPolicyVersion: t.commercialPolicyVersion,
      creditCapBps: t.creditCapBps,
      individualServicesEnabled: t.individualServicesEnabled,
      groupEventLimit: t.groupEventLimit,
      statisticsLevel: t.statisticsLevel,
      supportPriority: t.supportPriority,
    };
  }
  private toActiveTariff(tariff: TariffRow): ActiveResidencyTariff {
    if (
      tariff.currency !== "RUB" ||
      tariff.displayName.trim().length === 0 ||
      tariff.displayName.length > MAX_DISPLAY_NAME_LENGTH ||
      !Number.isSafeInteger(tariff.durationSeconds) ||
      tariff.durationSeconds < 1
    ) {
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_TARIFF_PROJECTION",
        "Invalid active tariff projection",
      );
    }
    return {
      tariffVersionId: tariff.id,
      displayName: tariff.displayName,
      priceMinor: normalizeDatabaseMoney(
        tariff.priceMinor,
        "tariff.priceMinor",
      ).toString(),
      currency: "RUB",
      durationSeconds: tariff.durationSeconds,
      commercialPolicyVersion: tariff.commercialPolicyVersion,
      creditCapBps: tariff.creditCapBps,
      individualServicesEnabled: tariff.individualServicesEnabled,
      groupEventLimit: tariff.groupEventLimit,
      statisticsLevel: tariff.statisticsLevel,
      supportPriority: tariff.supportPriority,
    };
  }
  private async hydrateOrder(
    tx: Pick<DrizzleDb, "execute">,
    row: OrderRow,
  ): Promise<ResidencyOrder> {
    const allocations = await tx.execute<{
      grantId: string;
      amountMinor: bigint;
    }>(
      sql`select a.reward_grant_id as "grantId",-a.amount_minor as "amountMinor" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id join expert_referral_reward_grants g on g.id=a.reward_grant_id where e.order_id=${row.id}::uuid and e.entry_kind='reservation' order by g.expires_at,g.granted_at,g.id`,
    );
    return {
      id: row.id,
      expertId: row.expertId,
      tariffVersionId: (row as OrderRow & { tariffVersionId: string })
        .tariffVersionId,
      displayName: row.displayName,
      priceMinor: normalizeDatabaseMoney(
        row.priceMinor,
        "order.priceMinor",
      ).toString(),
      currency: "RUB",
      durationSeconds: row.durationSeconds,
      commercialPolicyVersion: row.commercialPolicyVersion,
      creditCapBps: row.creditCapBps,
      individualServicesEnabled: row.individualServicesEnabled,
      groupEventLimit: row.groupEventLimit,
      statisticsLevel: row.statisticsLevel,
      supportPriority: row.supportPriority,
      creditMinor: normalizeDatabaseMoney(
        row.creditMinor,
        "order.creditMinor",
      ).toString(),
      cashMinor: normalizeDatabaseMoney(
        row.cashMinor,
        "order.cashMinor",
      ).toString(),
      paymentDeadline: dateString(row.paymentDeadline),
      status: row.status,
      allocations: allocations.rows.map((a) => ({
        grantId: a.grantId,
        amountMinor: normalizeDatabaseMoney(
          a.amountMinor,
          "allocation.amountMinor",
        ).toString(),
      })),
    };
  }
  private required<T>(value: T | undefined, code: string): T {
    if (value === undefined)
      throw new ExpertResidencyCommandError(
        code,
        "Required database row missing",
      );
    return value;
  }
}
