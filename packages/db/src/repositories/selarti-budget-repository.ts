import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type SqlExecutor = Pick<DrizzleDb, "execute">;
export type SelartiBudgetAdmission =
  | {
      readonly outcome: "admitted" | "warning";
      readonly reservedRubMinor: bigint;
    }
  | {
      readonly outcome: "soft_stop" | "hard_stop";
      readonly reservedRubMinor: 0n;
    };

const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;
const asBigInt = (value: bigint | string) =>
  typeof value === "bigint" ? value : BigInt(value);

export async function reserveSelartiCost(
  tx: SqlExecutor,
  input: {
    requestId: string;
    payloadHash: string;
    userId: string;
    dialogueId: string;
    occurredAt: string;
  },
): Promise<SelartiBudgetAdmission> {
  const month = input.occurredAt.slice(0, 7);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"selarti-budget:" + month},0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"selarti-user:" + input.userId},0))`,
  );
  const existing = (
    await tx.execute<{ payloadHash: string; reserved: bigint }>(
      sql`select payload_hash "payloadHash",reserved_rub_minor reserved from selarti_cost_reservations where request_id=${input.requestId}`,
    )
  ).rows[0];
  if (existing) {
    if (existing.payloadHash !== input.payloadHash)
      throw new Error("selarti_budget_reservation_conflict");
    return {
      outcome: "admitted",
      reservedRubMinor: asBigInt(existing.reserved),
    };
  }
  const policy = (
    await tx.execute<{
      id: string;
      version: number;
      globalCap: bigint;
      globalWarning: bigint;
      globalSoft: bigint;
      userWarning: bigint;
      userSoft: bigint;
      userHard: bigint;
      quote: bigint;
      uplift: number;
      perRequest: bigint;
      perUnit: bigint;
      units: bigint;
      rateVersion: string;
      modelVersion: string;
    }>(
      sql`select id,version,global_cap_rub_minor "globalCap",global_warning_rub_minor "globalWarning",global_soft_rub_minor "globalSoft",per_user_warning_rub_minor "userWarning",per_user_soft_rub_minor "userSoft",per_user_hard_rub_minor "userHard",official_usd_rub_quote_micros quote,selarti_uplift_bps uplift,usd_micros_per_request "perRequest",usd_micros_per_unit "perUnit",worst_case_billable_units units,rate_version "rateVersion",model_version "modelVersion" from selarti_budget_policies where status='approved' and effective_from<=${input.occurredAt}::timestamptz and (effective_to is null or effective_to>${input.occurredAt}::timestamptz) order by version desc limit 1 for share`,
    )
  ).rows[0];
  if (!policy) return { outcome: "hard_stop", reservedRubMinor: 0n };
  const revenue = asBigInt(
    (
      await tx.execute<{ amount: bigint | string }>(
        sql`select coalesce(sum(cash_minor),0)::bigint amount from expert_residency_orders where status='settled' and settled_at>${input.occurredAt}::timestamptz-interval '30 days' and settled_at<=${input.occurredAt}::timestamptz`,
      )
    ).rows[0]?.amount ?? 0n,
  );
  if (revenue <= 0n) {
    await tx.execute(
      sql`insert into selarti_budget_alerts(request_id,policy_version,outcome,amount_rub_minor) values(${input.requestId},${policy.version},'hard_stop',0) on conflict do nothing`,
    );
    return { outcome: "hard_stop", reservedRubMinor: 0n };
  }
  const quote = asBigInt(policy.quote);
  const perRequest = asBigInt(policy.perRequest);
  const perUnit = asBigInt(policy.perUnit);
  const units = asBigInt(policy.units);
  const effectiveQuote = ceilDiv(quote * 11_000n, 10_000n);
  const worstUsd = perRequest + perUnit * units;
  const cost = ceilDiv(worstUsd * effectiveQuote * 100n, 1_000_000_000_000n);
  if (cost <= 0n) throw new Error("selarti_budget_cost_invalid");
  const exposure = await tx.execute<{ global: bigint; user: bigint }>(sql`
    with current_exposure as (
      select r.user_id,case
        when f.outcome='not_applied' then 0::bigint
        when f.outcome='applied' then f.actual_rub_minor
        else r.reserved_rub_minor end amount
      from selarti_cost_reservations r
      left join lateral (select outcome,actual_rub_minor from selarti_actual_usage_facts where request_id=r.request_id order by created_at desc,id desc limit 1) f on true
      where r.period_start=date_trunc('month',${input.occurredAt}::timestamptz)::date
    ) select coalesce(sum(amount),0)::bigint global,coalesce(sum(amount) filter(where user_id=${input.userId}::uuid),0)::bigint "user" from current_exposure
  `);
  const globalUsed = asBigInt(exposure.rows[0]?.global ?? 0n);
  const userUsed = asBigInt(exposure.rows[0]?.user ?? 0n);
  const globalCap = asBigInt(policy.globalCap);
  const globalSoft = asBigInt(policy.globalSoft);
  const globalWarning = asBigInt(policy.globalWarning);
  const userHard = asBigInt(policy.userHard);
  const userSoft = asBigInt(policy.userSoft);
  const userWarning = asBigInt(policy.userWarning);
  const authoritativeHard =
    globalCap < revenue / 10n ? globalCap : revenue / 10n;
  const projectedGlobal = globalUsed + cost;
  const projectedUser = userUsed + cost;
  let outcome: SelartiBudgetAdmission["outcome"] = "admitted";
  if (projectedGlobal > authoritativeHard || projectedUser > userHard)
    outcome = "hard_stop";
  else if (projectedGlobal > globalSoft || projectedUser > userSoft)
    outcome = "soft_stop";
  else if (projectedGlobal > globalWarning || projectedUser > userWarning)
    outcome = "warning";
  if (outcome === "soft_stop" || outcome === "hard_stop") {
    await tx.execute(
      sql`insert into selarti_budget_alerts(request_id,policy_version,outcome,amount_rub_minor) values(${input.requestId},${policy.version},${outcome},${cost}) on conflict do nothing`,
    );
    return { outcome, reservedRubMinor: 0n };
  }
  await tx.execute(
    sql`insert into selarti_cost_reservations(request_id,payload_hash,policy_id,policy_version,user_id,dialogue_id,period_start,official_usd_rub_quote_micros,effective_usd_rub_quote_micros,selarti_uplift_bps,usd_micros_per_request,usd_micros_per_unit,worst_case_billable_units,worst_case_usd_micros,reserved_rub_minor,rate_version,model_version,created_at) values(${input.requestId},${input.payloadHash},${policy.id}::uuid,${policy.version},${input.userId}::uuid,${input.dialogueId}::uuid,date_trunc('month',${input.occurredAt}::timestamptz)::date,${quote},${effectiveQuote},${policy.uplift},${perRequest},${perUnit},${units},${worstUsd},${cost},${policy.rateVersion},${policy.modelVersion},${input.occurredAt}::timestamptz)`,
  );
  if (outcome === "warning")
    await tx.execute(
      sql`insert into selarti_budget_alerts(request_id,policy_version,outcome,amount_rub_minor) values(${input.requestId},${policy.version},'warning',${cost}) on conflict do nothing`,
    );
  return { outcome, reservedRubMinor: cost };
}

export class PostgresSelartiBudgetRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly metric?: (
      outcome: "released" | "reconciled" | "overrun" | "unknown",
    ) => void,
  ) {}
  async recordOutcome(input: {
    requestId: string;
    factId: string;
    outcome: "unknown" | "not_applied" | "applied";
    actualUsdMicros?: bigint;
  }): Promise<"recorded" | "duplicate" | "conflict"> {
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          requestId: input.requestId,
          factId: input.factId,
          outcome: input.outcome,
          actualUsdMicros: input.actualUsdMicros?.toString(),
        }),
      )
      .digest("hex");
    const committed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.requestId},0))`,
      );
      const existing = (
        await tx.execute<{ payloadHash: string }>(
          sql`select payload_hash "payloadHash" from selarti_actual_usage_facts where fact_id=${input.factId}`,
        )
      ).rows[0];
      if (existing)
        return {
          result:
            existing.payloadHash === hash
              ? ("duplicate" as const)
              : ("conflict" as const),
          metrics: [] as const,
        };
      const reservation = (
        await tx.execute<{ reserved: bigint; effectiveQuote: bigint }>(
          sql`select reserved_rub_minor reserved,effective_usd_rub_quote_micros "effectiveQuote" from selarti_cost_reservations where request_id=${input.requestId} for update`,
        )
      ).rows[0];
      if (!reservation) throw new Error("selarti_budget_reservation_missing");
      if (
        input.outcome === "applied" &&
        (input.actualUsdMicros === undefined || input.actualUsdMicros < 0n)
      )
        throw new Error("selarti_actual_usage_invalid");
      if (input.outcome !== "applied" && input.actualUsdMicros !== undefined)
        throw new Error("selarti_actual_usage_invalid");
      const reserved = asBigInt(reservation.reserved);
      const effectiveQuote = asBigInt(reservation.effectiveQuote);
      const actualRubMinor =
        input.outcome === "applied"
          ? ceilDiv(
              input.actualUsdMicros! * effectiveQuote * 100n,
              1_000_000_000_000n,
            )
          : null;
      const terminal = (
        await tx.execute<{ payloadHash: string }>(
          sql`select payload_hash "payloadHash" from selarti_actual_usage_facts where request_id=${input.requestId} and outcome in ('not_applied','applied') limit 1`,
        )
      ).rows[0];
      if (terminal)
        return {
          result:
            terminal.payloadHash === hash
              ? ("duplicate" as const)
              : ("conflict" as const),
          metrics: [] as const,
        };
      const priorUnknown = (
        await tx.execute<{ payloadHash: string }>(
          sql`select payload_hash "payloadHash" from selarti_actual_usage_facts where request_id=${input.requestId} and outcome='unknown' limit 1`,
        )
      ).rows[0];
      if (input.outcome === "unknown" && priorUnknown)
        return {
          result:
            priorUnknown.payloadHash === hash
              ? ("duplicate" as const)
              : ("conflict" as const),
          metrics: [] as const,
        };
      await tx.execute(
        sql`insert into selarti_actual_usage_facts(fact_id,request_id,payload_hash,outcome,actual_usd_micros,actual_rub_minor) values(${input.factId},${input.requestId},${hash},${input.outcome},${input.actualUsdMicros ?? null},${actualRubMinor})`,
      );
      if (input.outcome === "unknown") {
        await tx.execute(
          sql`insert into selarti_budget_alerts(request_id,policy_version,outcome,amount_rub_minor) select request_id,policy_version,'unknown',reserved_rub_minor from selarti_cost_reservations where request_id=${input.requestId} on conflict do nothing`,
        );
      } else if (input.outcome === "not_applied") {
        await tx.execute(
          sql`insert into selarti_cost_adjustments(request_id,kind,amount_rub_minor,fact_id) values(${input.requestId},'released',${reserved},${input.factId}) on conflict(request_id,kind) do nothing`,
        );
      } else {
        const actual = actualRubMinor!;
        const consumed = actual < reserved ? actual : reserved;
        await tx.execute(
          sql`insert into selarti_cost_adjustments(request_id,kind,amount_rub_minor,fact_id) values(${input.requestId},'consumed',${consumed},${input.factId}) on conflict(request_id,kind) do nothing`,
        );
        if (actual < reserved)
          await tx.execute(
            sql`insert into selarti_cost_adjustments(request_id,kind,amount_rub_minor,fact_id) values(${input.requestId},'unused_released',${reserved - actual},${input.factId}) on conflict(request_id,kind) do nothing`,
          );
        if (actual > reserved) {
          await tx.execute(
            sql`insert into selarti_cost_adjustments(request_id,kind,amount_rub_minor,fact_id) values(${input.requestId},'overrun',${actual - reserved},${input.factId}) on conflict(request_id,kind) do nothing`,
          );
          await tx.execute(
            sql`insert into selarti_budget_alerts(request_id,policy_version,outcome,amount_rub_minor) select request_id,policy_version,'overrun',${actual - reserved} from selarti_cost_reservations where request_id=${input.requestId} on conflict do nothing`,
          );
        }
      }
      const metrics: ("released" | "reconciled" | "overrun" | "unknown")[] =
        input.outcome === "unknown"
          ? ["unknown"]
          : input.outcome === "not_applied"
            ? ["released"]
            : actualRubMinor! > reserved
              ? ["reconciled", "overrun"]
              : ["reconciled"];
      return { result: "recorded" as const, metrics };
    });
    for (const outcome of committed.metrics) this.metric?.(outcome);
    return committed.result;
  }
}
