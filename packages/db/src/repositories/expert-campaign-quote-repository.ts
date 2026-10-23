import type { DrizzleDb } from "../client.js";
import { and, eq, sql } from "drizzle-orm";
import { calculateExpertCampaignPrice } from "@ii-tonya/domain";
import {
  expertCampaignAnchors,
  expertCampaignQuotes,
} from "../schema/expert-campaign-quotes.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

export interface CreateExpertCampaignQuote {
  userId: string;
  tariffVersionId: string;
  termMonths: 1 | 3;
  idempotencyKey: string;
}
export interface ExpertCampaignQuote {
  id: string;
  userId: string;
  tariffVersionId: string;
  ruleVersion: "expert_energy_start_v1";
  calculationTimestamp: string;
  quotedAt: string;
  expiresAt: string;
  termMonths: 1 | 3;
  durationSeconds: number;
  baseMonthlyMinor: string;
  discountedMonthlyMinor: string;
  monthlyPriceMinor: string;
  priceMinor: string;
  currency: "RUB";
  energyDiscountBps: number;
  startDiscountBps: number;
  floorApplied: boolean;
  displayName: string;
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
}
export type ExpertCampaignQuoteErrorCode =
  | "EXPERT_CAMPAIGN_INVALID_INPUT"
  | "EXPERT_CAMPAIGN_USER_INACTIVE"
  | "EXPERT_CAMPAIGN_TARIFF_INACTIVE"
  | "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT"
  | "EXPERT_CAMPAIGN_TERM_UNAVAILABLE"
  | "EXPERT_CAMPAIGN_EXPIRY_BOUNDARY"
  | "EXPERT_CAMPAIGN_STORAGE";
export class ExpertCampaignQuoteError extends Error {
  constructor(readonly code: ExpertCampaignQuoteErrorCode) {
    super(code);
    this.name = "ExpertCampaignQuoteError";
  }
}

export class PostgresExpertCampaignQuoteRepository {
  constructor(private readonly db: DrizzleDb) {}
  async createQuote(
    input: CreateExpertCampaignQuote,
  ): Promise<ExpertCampaignQuote> {
    const request = parseCommand(input);
    try {
      return await this.db.transaction(
        (tx) => this.createQuoteInTransaction(tx, request),
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (error instanceof ExpertCampaignQuoteError) throw error;
      throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_STORAGE");
    }
  }

  /** Composition shares the caller's identity/consent barrier and replay transaction. */
  async createQuoteInTransaction(
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    input: CreateExpertCampaignQuote,
  ): Promise<ExpertCampaignQuote> {
    const request = parseCommand(input);
    try {
      await lockClientConsentSubject(tx, request.userId);
      const user = (
        await tx.execute<{ active: boolean }>(
          sql`select active from users where id=${request.userId}::uuid for share`,
        )
      ).rows[0];
      if (user?.active !== true)
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_USER_INACTIVE");
      const [prior] = await tx
        .select()
        .from(expertCampaignQuotes)
        .where(
          and(
            eq(expertCampaignQuotes.userId, request.userId),
            eq(expertCampaignQuotes.idempotencyKey, request.idempotencyKey),
          ),
        );
      if (prior) {
        if (
          prior.tariffVersionId !== request.tariffVersionId ||
          prior.termMonths !== request.termMonths
        )
          throw new ExpertCampaignQuoteError(
            "EXPERT_CAMPAIGN_IDEMPOTENCY_CONFLICT",
          );
        return toQuote(prior);
      }
      // No active-time predicate before a potentially blocking row lock.
      // Compare integer milliseconds to CEIL endpoints (preserving fractional
      // source boundaries); validity itself is explicitly floored, never rounded.
      const tariff = (
        await tx.execute<Tariff>(sql`select price_minor::text "priceMinor", currency,
          commercial_policy_version "policy", duration_seconds "durationSeconds",
          ceil(extract(epoch from active_from)*1000)::text "activeFromMs",
          ceil(extract(epoch from active_to)*1000)::text "activeToExclusiveMs",
          floor(extract(epoch from active_to)*1000)::text "activeToMs",
          display_name "displayName", credit_cap_bps "creditCapBps", individual_services_enabled "individualServicesEnabled",
          group_event_limit "groupEventLimit", statistics_level "statisticsLevel", support_priority "supportPriority"
          from expert_residency_tariff_versions where id=${request.tariffVersionId}::uuid for share`)
      ).rows[0];
      const [existingAnchor] = await tx
        .select()
        .from(expertCampaignAnchors)
        .where(
          and(
            eq(expertCampaignAnchors.userId, request.userId),
            eq(expertCampaignAnchors.ruleVersion, RULE),
          ),
        );
      const clock = (
        await tx.execute<{ ms: string }>(
          sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
        )
      ).rows[0];
      const quotedAtMs = Number(clock?.ms);
      if (
        !Number.isSafeInteger(quotedAtMs) ||
        quotedAtMs < 0 ||
        quotedAtMs > MAX_TIME
      )
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_STORAGE");
      if (
        !tariff ||
        tariff.policy !== "expert_residency_v2" ||
        tariff.currency !== "RUB" ||
        tariff.durationSeconds !== 2592000 ||
        !(
          quotedAtMs >= Number(tariff.activeFromMs) &&
          quotedAtMs < Number(tariff.activeToExclusiveMs)
        )
      )
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_TARIFF_INACTIVE");
      const calculationTimestampMs =
        existingAnchor?.calculationTimestamp.getTime() ?? quotedAtMs;
      const elapsed = quotedAtMs - calculationTimestampMs;
      if (request.termMonths === 3 && elapsed >= 144 * HOUR)
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_TERM_UNAVAILABLE");
      const price = calculateExpertCampaignPrice({
        baseMonthlyMinor: BigInt(tariff.priceMinor),
        calculationTimestampMs,
        quotedAtMs,
        termMonths: request.termMonths,
      });
      if (price.priceMinor > 999999999999n)
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_TARIFF_INACTIVE");
      const nextStage =
        elapsed < 72 * HOUR
          ? calculationTimestampMs + 72 * HOUR
          : elapsed < 144 * HOUR
            ? calculationTimestampMs + 144 * HOUR
            : elapsed < 216 * HOUR
              ? calculationTimestampMs + 216 * HOUR
              : Infinity;
      const expiresAtMs = Math.min(
        quotedAtMs + 900000,
        Math.floor(Number(tariff.activeToMs)),
        nextStage,
      );
      if (expiresAtMs <= quotedAtMs || expiresAtMs > MAX_TIME)
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_EXPIRY_BOUNDARY");
      if (!existingAnchor)
        await tx.insert(expertCampaignAnchors).values({
          userId: request.userId,
          ruleVersion: RULE,
          calculationTimestamp: new Date(calculationTimestampMs),
        });
      const [saved] = await tx
        .insert(expertCampaignQuotes)
        .values({
          ...request,
          ...price,
          calculationTimestamp: new Date(calculationTimestampMs),
          quotedAt: new Date(quotedAtMs),
          expiresAt: new Date(expiresAtMs),
          baseMonthlyMinor: BigInt(tariff.priceMinor),
          displayName: tariff.displayName,
          creditCapBps: tariff.creditCapBps,
          individualServicesEnabled: tariff.individualServicesEnabled,
          groupEventLimit: tariff.groupEventLimit,
          statisticsLevel: tariff.statisticsLevel,
          supportPriority: tariff.supportPriority,
        })
        .returning();
      if (!saved) throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_STORAGE");
      return toQuote(saved);
    } catch (error) {
      if (error instanceof ExpertCampaignQuoteError) throw error;
      throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_STORAGE");
    }
  }
}

const RULE = "expert_energy_start_v1";
const HOUR = 3_600_000;
const MAX_TIME = 8_640_000_000_000_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function parseCommand(
  input: CreateExpertCampaignQuote,
): CreateExpertCampaignQuote {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 4 ||
    Object.keys(input).some(
      (key) =>
        !["userId", "tariffVersionId", "termMonths", "idempotencyKey"].includes(
          key,
        ),
    ) ||
    typeof input.userId !== "string" ||
    input.userId.length !== 36 ||
    !uuidPattern.test(input.userId) ||
    typeof input.tariffVersionId !== "string" ||
    input.tariffVersionId.length !== 36 ||
    !uuidPattern.test(input.tariffVersionId) ||
    (input.termMonths !== 1 && input.termMonths !== 3) ||
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.idempotencyKey)
  )
    throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_INVALID_INPUT");
  return {
    userId: input.userId.toLowerCase(),
    tariffVersionId: input.tariffVersionId.toLowerCase(),
    termMonths: input.termMonths,
    idempotencyKey: input.idempotencyKey,
  };
}
interface Tariff extends Record<string, unknown> {
  priceMinor: string;
  currency: string;
  policy: string;
  durationSeconds: number;
  activeFromMs: string;
  activeToMs: string;
  activeToExclusiveMs: string;
  displayName: string;
  creditCapBps: number;
  individualServicesEnabled: boolean;
  groupEventLimit: number;
  statisticsLevel: "basic" | "expanded";
  supportPriority: "standard" | "priority";
}
function toQuote(
  row: typeof expertCampaignQuotes.$inferSelect,
): ExpertCampaignQuote {
  return {
    id: row.id,
    userId: row.userId,
    tariffVersionId: row.tariffVersionId,
    ruleVersion: row.ruleVersion,
    calculationTimestamp: row.calculationTimestamp.toISOString(),
    quotedAt: row.quotedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    termMonths: row.termMonths,
    durationSeconds: row.durationSeconds,
    baseMonthlyMinor: row.baseMonthlyMinor.toString(),
    discountedMonthlyMinor: row.discountedMonthlyMinor.toString(),
    monthlyPriceMinor: row.monthlyPriceMinor.toString(),
    priceMinor: row.priceMinor.toString(),
    currency: row.currency,
    energyDiscountBps: row.energyDiscountBps,
    startDiscountBps: row.startDiscountBps,
    floorApplied: row.floorApplied,
    displayName: row.displayName,
    creditCapBps: row.creditCapBps,
    individualServicesEnabled: row.individualServicesEnabled,
    groupEventLimit: row.groupEventLimit,
    statisticsLevel: row.statisticsLevel,
    supportPriority: row.supportPriority,
  };
}
