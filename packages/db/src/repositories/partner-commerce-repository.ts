import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { calculatePartnerShadowQuote, type PartnerParticipantKind, type PartnerPolicySnapshot, type PartnerShadowQuote } from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";

type Common = { readonly userId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly correlationId: string };
type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
type PolicyRow = Record<string, unknown> & { policyVersionId: string; policyVersion: number; kind: "CENTER" | "ORGANIZER"; standardPriceMinor: number | string; referredSixPriceMinor: number | string; referredTenPriceMinor: number | string; onlineOnlySurchargeMinor: number | string; cityMillionPlusSurchargeMinor: number | string; currency: "RUB"; durationSeconds: number; eventEntitlements: { bands: readonly { readonly capacity: number; readonly count: number }[] }; residentCommissionBps: 1000; nonresidentCommissionBps: 1500; nonresidentCardFeeMinor: number | string };

export type PartnerShadowQuoteResult =
  | { readonly kind: "quote_created"; readonly quote: PartnerShadowQuote }
  | { readonly kind: "replay"; readonly result: PartnerShadowQuoteResult }
  | { readonly kind: "conflict" | "not_found" | "invalid_transition" };
export type PartnerCommandResult =
  | { readonly kind: "started" | "kind_selected" | "confirmed" | "profile_ready"; readonly participantId: string }
  | { readonly kind: "replay"; readonly result: PartnerCommandResult }
  | { readonly kind: "conflict" | "not_found" | "invalid_transition" | "duplicate_kind" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{64}$/u;
const validInput = (input: Common) => UUID.test(input.userId) && HASH.test(input.payloadDigest) && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u.test(input.idempotencyKey) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.correlationId);
const digest = (action: string, objectId: string, correlationId: string, decision: string) => createHash("sha256").update(`${action}|${objectId}|${correlationId}|${decision}`).digest("hex");
const policy = (row: PolicyRow): PartnerPolicySnapshot => ({ policyVersionId: row.policyVersionId, policyVersion: row.policyVersion, kind: row.kind, standardPriceMinor: Number(row.standardPriceMinor), referredSixPriceMinor: Number(row.referredSixPriceMinor), referredTenPriceMinor: Number(row.referredTenPriceMinor), onlineOnlySurchargeMinor: Number(row.onlineOnlySurchargeMinor) as 300000, cityMillionPlusSurchargeMinor: Number(row.cityMillionPlusSurchargeMinor) as 500000, currency: row.currency, durationSeconds: row.durationSeconds as 2592000, eventEntitlements: row.eventEntitlements.bands, residentCommissionBps: row.residentCommissionBps, nonresidentCommissionBps: row.nonresidentCommissionBps, nonresidentCardFeeMinor: Number(row.nonresidentCardFeeMinor) as 450000 });

export class PostgresPartnerCommerceRepository {
  constructor(private readonly db: DrizzleDb) {}

  private async mutation<T extends PartnerCommandResult | PartnerShadowQuoteResult>(input: Common & { readonly participantId?: string }, action: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!validInput(input)) throw new Error("partner_commerce_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId} || ':' || ${input.idempotencyKey}, 0))`);
      const prior = await tx.execute<Record<string, unknown> & { payloadHash: string; result: T }>(sql`select payload_hash as "payloadHash", result from partner_command_receipts where user_id=${input.userId}::uuid and idempotency_key=${input.idempotencyKey} for update`);
      if (prior.rows[0]) return prior.rows[0].payloadHash === input.payloadDigest ? prior.rows[0].result : ({ kind: "conflict" } as T);
      const result = await work(tx);
      const objectId = input.participantId ?? input.userId;
      const decision = ["not_found", "invalid_transition", "duplicate_kind"].includes(result.kind) ? "denied" : "allowed";
      await tx.execute(sql`insert into partner_command_receipts (user_id,command,idempotency_key,payload_hash,result) values (${input.userId}::uuid,${action},${input.idempotencyKey},${input.payloadDigest},${JSON.stringify(result)}::jsonb)`);
      await tx.execute(sql`insert into audit_events (actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values ('user',${input.userId}::uuid,'partner-commerce',${action},'partner_commerce',${objectId}::uuid,${decision},${result.kind},${input.correlationId},transaction_timestamp(),${digest(action, objectId, input.correlationId, decision)})`);
      return result;
    }) as Promise<T>;
  }

  async start(input: Common): Promise<PartnerCommandResult> {
    return this.mutation(input, "partner_onboarding", async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`insert into commercial_participants (user_id,participant_kind,onboarding_state) values (${input.userId}::uuid,null,'started') on conflict (user_id) where participant_kind is null do nothing returning id`);
      if (inserted.rows[0]) return { kind: "started", participantId: inserted.rows[0].id };
      const existing = await tx.execute<{ id: string }>(sql`select id from commercial_participants where user_id=${input.userId}::uuid and participant_kind is null for update`);
      return existing.rows[0] ? { kind: "started", participantId: existing.rows[0].id } : { kind: "duplicate_kind" };
    });
  }

  async selectKind(input: Common & { participantId: string; kind: PartnerParticipantKind }): Promise<PartnerCommandResult> {
    return this.mutation(input, "partner_onboarding", async (tx) => {
      const row = await tx.execute<{ state: string; kind: string | null }>(sql`select onboarding_state as state,participant_kind as kind from commercial_participants where id=${input.participantId}::uuid and user_id=${input.userId}::uuid for update`);
      if (!row.rows[0]) return { kind: "not_found" };
      if (row.rows[0].state !== "started" || row.rows[0].kind !== null) return { kind: "invalid_transition" };
      const duplicate = await tx.execute(sql`select 1 from commercial_participants where user_id=${input.userId}::uuid and participant_kind=${input.kind} limit 1`);
      if (duplicate.rows[0]) return { kind: "duplicate_kind" };
      await tx.execute(sql`update commercial_participants set participant_kind=${input.kind},onboarding_state='kind_selected' where id=${input.participantId}::uuid`);
      return { kind: "kind_selected", participantId: input.participantId };
    });
  }

  async confirmKind(input: Common & { participantId: string }): Promise<PartnerCommandResult> {
    return this.mutation(input, "partner_onboarding", async (tx) => {
      const row = await tx.execute<{ state: string }>(sql`select onboarding_state as state from commercial_participants where id=${input.participantId}::uuid and user_id=${input.userId}::uuid for update`);
      if (!row.rows[0]) return { kind: "not_found" };
      if (row.rows[0].state !== "kind_selected") return { kind: "invalid_transition" };
      await tx.execute(sql`update commercial_participants set onboarding_state='profile_incomplete' where id=${input.participantId}::uuid`);
      return { kind: "confirmed", participantId: input.participantId };
    });
  }

  async upsertOrganizationProfile(input: Common & { participantId: string; displayName: string; city: string; cityMillionPlus: boolean; onlineOnly: boolean }): Promise<PartnerCommandResult> {
    return this.mutation(input, "partner_onboarding", async (tx) => {
      const row = await tx.execute<{ kind: string; state: string }>(sql`select participant_kind as kind,onboarding_state as state from commercial_participants where id=${input.participantId}::uuid and user_id=${input.userId}::uuid for update`);
      if (!row.rows[0]) return { kind: "not_found" };
      if (!['CENTER', 'ORGANIZER'].includes(row.rows[0].kind) || row.rows[0].state !== "profile_incomplete") return { kind: "invalid_transition" };
      await tx.execute(sql`insert into organization_profiles (participant_id,participant_kind,legal_name,city,online_only,city_million_plus,verification_state) values (${input.participantId}::uuid,${row.rows[0].kind},${input.displayName},${input.city},${input.onlineOnly},${input.cityMillionPlus},'verified') on conflict (participant_id) do update set legal_name=excluded.legal_name,city=excluded.city,online_only=excluded.online_only,city_million_plus=excluded.city_million_plus`);
      await tx.execute(sql`update commercial_participants set onboarding_state='profile_ready' where id=${input.participantId}::uuid`);
      return { kind: "profile_ready", participantId: input.participantId };
    });
  }

  async listActivePolicies(input: { kind: "CENTER" | "ORGANIZER" }): Promise<ReadonlyArray<PartnerPolicySnapshot>> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<PolicyRow>(sql`with clock as (select transaction_timestamp() as now) select p.policy_version_id as "policyVersionId",p.policy_version as "policyVersion",p.partner_kind as kind,p.standard_price_minor as "standardPriceMinor",p.referred_six_price_minor as "referredSixPriceMinor",p.referred_ten_price_minor as "referredTenPriceMinor",p.online_only_surcharge_minor as "onlineOnlySurchargeMinor",p.city_million_plus_surcharge_minor as "cityMillionPlusSurchargeMinor",p.currency,p.duration_seconds as "durationSeconds",p.event_entitlements as "eventEntitlements",p.resident_commission_bps as "residentCommissionBps",p.nonresident_commission_bps as "nonresidentCommissionBps",p.nonresident_card_fee_minor as "nonresidentCardFeeMinor" from partner_tariff_policy_versions p,cLOCK where p.partner_kind=${input.kind} and p.status='approved' and p.effective_from <= clock.now and (p.effective_to is null or p.effective_to > clock.now) order by p.policy_version desc`);
      return rows.rows.map(policy);
    });
  }

  async createShadowQuote(input: Common & { participantId: string }): Promise<PartnerShadowQuoteResult> {
    return this.mutation(input, "partner_quote", async (tx) => {
      const participant = await tx.execute<{ kind: "CENTER" | "ORGANIZER"; state: string; onlineOnly: boolean; cityMillionPlus: boolean }>(sql`select p.participant_kind as kind,p.onboarding_state as state,o.online_only as "onlineOnly",o.city_million_plus as "cityMillionPlus" from commercial_participants p join organization_profiles o on o.participant_id=p.id where p.id=${input.participantId}::uuid and p.user_id=${input.userId}::uuid for update`);
      const owner = participant.rows[0];
      if (!owner) return { kind: "not_found" };
      if (owner.state !== "profile_ready") return { kind: "invalid_transition" };
      const rows = await tx.execute<PolicyRow>(sql`with clock as (select transaction_timestamp() as now) select p.id as "policyId",p.policy_version_id as "policyVersionId",p.policy_version as "policyVersion",p.partner_kind as kind,p.standard_price_minor as "standardPriceMinor",p.referred_six_price_minor as "referredSixPriceMinor",p.referred_ten_price_minor as "referredTenPriceMinor",p.online_only_surcharge_minor as "onlineOnlySurchargeMinor",p.city_million_plus_surcharge_minor as "cityMillionPlusSurchargeMinor",p.currency,p.duration_seconds as "durationSeconds",p.event_entitlements as "eventEntitlements",p.resident_commission_bps as "residentCommissionBps",p.nonresident_commission_bps as "nonresidentCommissionBps",p.nonresident_card_fee_minor as "nonresidentCardFeeMinor" from partner_tariff_policy_versions p,clock where p.partner_kind=${owner.kind} and p.status='approved' and p.effective_from <= clock.now and (p.effective_to is null or p.effective_to > clock.now) order by p.policy_version desc limit 1`);
      const row = rows.rows[0];
      if (!row) return { kind: "invalid_transition" };
      const quote = calculatePartnerShadowQuote({ kind: owner.kind, qualifiedExpertCount: 0, onlineOnly: owner.onlineOnly, cityMillionPlus: owner.cityMillionPlus, policy: policy(row) });
      const inserted = await tx.execute<{ id: string }>(sql`insert into partner_shadow_quotes (participant_id,policy_id,policy_version_id,policy_version,partner_kind,qualified_expert_count,tier,base_price_minor,online_only_surcharge_minor,city_million_plus_surcharge_minor,final_price_minor,currency,duration_seconds,event_entitlements,resident_commission_bps,nonresident_commission_bps,nonresident_card_fee_minor) values (${input.participantId}::uuid,${row.policyId}::uuid,${quote.policyVersionId},${quote.policyVersion},${quote.kind},${quote.qualifiedExpertCount},${quote.tier},${quote.basePriceMinor},${quote.onlineOnlySurchargeMinor},${quote.cityMillionPlusSurchargeMinor},${quote.finalPriceMinor},${quote.currency},${quote.durationSeconds},${JSON.stringify({ bands: quote.eventEntitlements })}::jsonb,${quote.residentCommissionBps},${quote.nonresidentCommissionBps},${quote.nonresidentCardFeeMinor}) returning id`);
      if (!inserted.rows[0]) return { kind: "invalid_transition" };
      return { kind: "quote_created", quote };
    }) as Promise<PartnerShadowQuoteResult>;
  }
}
