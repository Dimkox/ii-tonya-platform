import { calculatePartnerShadowQuote } from "@ii-tonya/domain";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { PostgresPartnerCommerceRepository } from "./partner-commerce-repository.js";

export class PostgresExpertTrialPricingPolicy {
  constructor(private readonly db: DrizzleDb) {}
  async quote(input: Record<string, unknown>) {
    const tariffKey =
      typeof input.tariffKey === "string" ? input.tariffKey : "BASE";
    if (!/^[A-Z][A-Z0-9_]{0,31}$/u.test(tariffKey))
      throw new Error("authoritative_pricing_policy_unavailable");
    const rows = await this.db.execute<{
      priceMinor: number | string;
      policyVersionId: string;
    }>(sql`
      select price_minor as "priceMinor",commercial_policy_version as "policyVersionId"
      from expert_residency_tariff_versions
      where tariff_key=${tariffKey} and commercial_policy_version='expert_residency_v2'
        and active_from <= transaction_timestamp() and transaction_timestamp() < active_to
      order by active_from desc,id desc limit 2`);
    if (rows.rows.length !== 1)
      throw new Error("authoritative_pricing_policy_unavailable");
    return {
      priceMinor: Number(rows.rows[0]!.priceMinor),
      currency: "RUB" as const,
      policyVersionId: rows.rows[0]!.policyVersionId,
    };
  }
}

export class PostgresPartnerTrialPricingPolicy {
  readonly #policies: PostgresPartnerCommerceRepository;
  constructor(db: DrizzleDb) {
    this.#policies = new PostgresPartnerCommerceRepository(db);
  }
  async quote(input: Record<string, unknown>) {
    const kind = input.segment;
    if (kind !== "CENTER" && kind !== "ORGANIZER")
      throw new Error("authoritative_pricing_policy_unavailable");
    const policies = await this.#policies.listActivePolicies({ kind });
    if (policies.length !== 1)
      throw new Error("authoritative_pricing_policy_unavailable");
    const quote = calculatePartnerShadowQuote({
      kind,
      policy: policies[0]!,
      qualifiedExpertCount:
        typeof input.qualifiedExpertCount === "number"
          ? input.qualifiedExpertCount
          : 0,
      onlineOnly: input.onlineOnly === true,
      cityMillionPlus: input.cityMillionPlus === true,
    });
    return {
      priceMinor: quote.finalPriceMinor,
      currency: quote.currency,
      policyVersionId: quote.policyVersionId,
    };
  }
}
