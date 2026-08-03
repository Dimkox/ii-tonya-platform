import { sql } from "drizzle-orm";
import { quoteResidency } from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import { withSerializableRetry } from "./message-repository.js";

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
export interface ResidencyQuote {
  tariffVersionId: string;
  displayName: string;
  priceMinor: string;
  currency: "RUB";
  durationSeconds: number;
  creditMinor: string;
  cashMinor: string;
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
  priceMinor: bigint;
  currency: "RUB";
  durationSeconds: number;
};
type OrderRow = TariffRow & {
  expertId: string;
  paymentDeadline: Date | string;
  status: "payment_pending" | "expired";
  creditMinor: bigint;
  cashMinor: bigint;
};

export class PostgresExpertResidencyRepository {
  constructor(private readonly db: DrizzleDb) {}

  async createTariffVersion(command: TariffVersionCommand): Promise<TariffRow> {
    if (
      !validDate(command.activeFrom) ||
      !validDate(command.activeTo) ||
      command.activeTo <= command.activeFrom ||
      command.durationSeconds < 86400 ||
      command.durationSeconds > 315360000
    )
      throw new ExpertResidencyCommandError(
        "EXPERT_RESIDENCY_INVALID_TARIFF",
        "Invalid tariff version",
      );
    const result = await this.db.execute<TariffRow>(
      sql`insert into expert_residency_tariff_versions (tariff_key,display_name,price_minor,currency,duration_seconds,active_from,active_to,approval_id,admin_session_id_hash) values (${command.tariffKey},${command.displayName},${command.priceMinor},'RUB',${command.durationSeconds},${command.activeFrom},${command.activeTo},${command.approvalId}::uuid,${command.adminSessionIdHash}) returning id,display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds"`,
    );
    return this.required(result.rows[0], "EXPERT_RESIDENCY_TARIFF_NOT_CREATED");
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
    const [tariff, available] = await Promise.all([
      this.activeTariff(this.db, input.tariffVersionId),
      this.availableCredit(this.db, input.expertId),
    ]);
    await this.assertEligibleExpert(this.db, input.expertId);
    return this.toQuote(tariff, available);
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.expertId}, 0))`,
        );
        const prior = await tx.execute<OrderRow>(
          sql`select id,expert_id as "expertId",tariff_version_id as "tariffVersionId",snapshot_display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds",credit_minor as "creditMinor",cash_minor as "cashMinor",payment_deadline as "paymentDeadline",status from expert_residency_orders where expert_id=${command.expertId}::uuid and idempotency_key=${command.idempotencyKey} for update`,
        );
        if (prior.rows[0]) {
          const stored = prior.rows[0] as OrderRow & {
            tariffVersionId: string;
          };
          const expiry = await tx.execute<{
            earliestExpiryAt: Date | string | null;
          }>(
            sql`select min(g.expires_at) as "earliestExpiryAt" from expert_referral_ledger_entries e join expert_referral_ledger_allocations a on a.ledger_entry_id=e.id join expert_referral_reward_grants g on g.id=a.reward_grant_id where e.order_id=${stored.id}::uuid and e.entry_kind='reservation'`,
          );
          const expected =
            expiry.rows[0]?.earliestExpiryAt == null
              ? command.providerDeadline
              : minPaymentDeadline(
                  command.providerDeadline,
                  new Date(expiry.rows[0].earliestExpiryAt),
                );
          if (
            stored.tariffVersionId !== command.tariffVersionId ||
            expected.getTime() !== new Date(stored.paymentDeadline).getTime()
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
          remainingMinor: bigint;
        }>(
          sql`select g.id,g.expires_at as "expiresAt",g.granted_at as "grantedAt",coalesce((select sum(a.amount_minor) from expert_referral_ledger_allocations a where a.reward_grant_id=g.id),0)::bigint as "remainingMinor" from expert_referral_reward_grants g where g.expert_id=${command.expertId}::uuid and g.expires_at > transaction_timestamp() order by g.expires_at,g.granted_at,g.id for update of g`,
        );
        const available = grants.rows.reduce(
          (sum, g) => sum + (g.remainingMinor > 0n ? g.remainingMinor : 0n),
          0n,
        );
        const amounts = quoteResidency(tariff.priceMinor, available);
        let remaining = amounts.creditMinor;
        const allocations: {
          grantId: string;
          amountMinor: bigint;
          expiresAt: Date;
        }[] = [];
        for (const grant of grants.rows) {
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
          sql`insert into expert_residency_orders (expert_id,tariff_version_id,snapshot_display_name,price_minor,currency,duration_seconds,credit_minor,cash_minor,payment_deadline,status,idempotency_key) values (${command.expertId}::uuid,${tariff.id}::uuid,${tariff.displayName},${tariff.priceMinor},'RUB',${tariff.durationSeconds},${amounts.creditMinor},${amounts.cashMinor},${deadline},'payment_pending',${command.idempotencyKey}) returning id`,
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
        const changed = await tx.execute<{ id: string }>(
          sql`update expert_residency_orders set status='expired',updated_at=transaction_timestamp() where id=${order.id}::uuid and status='payment_pending' and transaction_timestamp() >= payment_deadline returning id`,
        );
        if (!changed.rows[0]) continue;
        const reservations = await tx.execute<{
          id: string;
          amountMinor: bigint;
        }>(
          sql`select id,amount_minor as "amountMinor" from expert_referral_ledger_entries where order_id=${order.id}::uuid and entry_kind='reservation' for update`,
        );
        for (const reservation of reservations.rows) {
          const release = await tx.execute<{ id: string }>(
            sql`insert into expert_referral_ledger_entries (expert_id,entry_kind,amount_minor,order_id,original_entry_id,source_type,source_id,idempotency_key) values (${order.expertId}::uuid,'release',${-reservation.amountMinor},${order.id}::uuid,${reservation.id}::uuid,'residency_order',${order.id}::uuid,${`release:${reservation.id}`}) on conflict (idempotency_key) do nothing returning id`,
          );
          if (release.rows[0])
            await tx.execute(
              sql`insert into expert_referral_ledger_allocations (ledger_entry_id,reward_grant_id,expert_id,amount_minor) select ${release.rows[0].id}::uuid,reward_grant_id,expert_id,-amount_minor from expert_referral_ledger_allocations where ledger_entry_id=${reservation.id}::uuid`,
            );
        }
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
      sql`select available_credit_minor as "availableCreditMinor",reserved_credit_minor as "reservedCreditMinor",nearest_expiry_at as "nearestExpiryAt",debt_minor as "debtMinor" from expert_referral_balances where expert_id=${expertId}::uuid`,
    );
    const row = result.rows[0] ?? {
      availableCreditMinor: 0n,
      reservedCreditMinor: 0n,
      nearestExpiryAt: null,
      debtMinor: 0n,
    };
    return {
      availableCreditMinor: row.availableCreditMinor.toString(),
      reservedCreditMinor: row.reservedCreditMinor.toString(),
      nearestExpiryAt:
        row.nearestExpiryAt === null ? null : dateString(row.nearestExpiryAt),
      debtMinor: row.debtMinor.toString(),
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
      sql`select id,display_name as "displayName",price_minor as "priceMinor",currency,duration_seconds as "durationSeconds" from expert_residency_tariff_versions where id=${id}::uuid and active_from <= transaction_timestamp() and transaction_timestamp() < active_to`,
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
    const result = await executor.execute<{ available: bigint }>(
      sql`select greatest(coalesce(sum(a.amount_minor),0),0)::bigint as available from expert_referral_reward_grants g join expert_referral_ledger_allocations a on a.reward_grant_id=g.id where g.expert_id=${expertId}::uuid and g.expires_at > transaction_timestamp()`,
    );
    return result.rows[0]?.available ?? 0n;
  }
  private toQuote(t: TariffRow, available: bigint): ResidencyQuote {
    const q = quoteResidency(t.priceMinor, available);
    return {
      tariffVersionId: t.id,
      displayName: t.displayName,
      ...parseMoneySnapshot({ priceMinor: t.priceMinor, ...q }),
      currency: "RUB",
      durationSeconds: t.durationSeconds,
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
      priceMinor: row.priceMinor.toString(),
      currency: "RUB",
      durationSeconds: row.durationSeconds,
      creditMinor: row.creditMinor.toString(),
      cashMinor: row.cashMinor.toString(),
      paymentDeadline: dateString(row.paymentDeadline),
      status: row.status,
      allocations: allocations.rows.map((a) => ({
        grantId: a.grantId,
        amountMinor: a.amountMinor.toString(),
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
