import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

export type StandardSnapshot = {
  invoiceId: string;
  userId: string;
  operationId: string;
  idempotencyKey: string;
  pricingPolicy: "wave1_standard_v1";
  ruleVersion: "expert_separated_sales_v3";
  priceKind: "discounted" | "full_price";
  promotionEligible: boolean;
  participantKind: "expert" | "space";
  mode: "test" | "live";
  baseMonthlyMinor: string;
  onboardingMinor: "300000";
  subscriptionMinor: string;
  totalMinor: string;
  baseOfferShownAt: string;
  quotedAt: string;
  expiresAt: string;
  launchAt: string;
};
type Input = {
  userId: string;
  baseId: string;
  choiceId: string;
  operationId: string;
  invoiceId: string;
  idempotencyKey: string;
  receiptContactId: string;
  requestExpiresAt: string;
  mode: "test" | "live";
};
type Sealer = ((snapshot: StandardSnapshot) => {
  digest: string;
  ciphertext: string;
  keyReference: string;
}) & {
  fingerprint(snapshot: StandardSnapshot): {
    digest: string;
    keyReference: string;
  };
};
type PriceRow = {
  base: string;
  monthly: string;
  participant: "expert" | "space";
  offer: string;
  quote: string;
  expiry: string;
  launch: string;
  eligible: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Draft 0081/0087 only. The quote is checked by DB triggers and contact is rechecked under the subject lock. */
export class PostgresEarlyBirdStandardSnapshotPrepare {
  constructor(private readonly db: DrizzleDb) {}
  async prepare(
    input: Input,
    seal: Sealer,
  ): Promise<{ kind: "prepared" | "replay" | "unavailable" }> {
    if (
      ![
        input.userId,
        input.baseId,
        input.choiceId,
        input.operationId,
        input.invoiceId,
        input.idempotencyKey,
        input.receiptContactId,
      ].every((value) => uuid.test(value)) ||
      (input.mode !== "test" && input.mode !== "live") ||
      !Number.isFinite(Date.parse(input.requestExpiresAt))
    )
      throw new Error("early_bird_prepare_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout','4000ms',true)`,
      );
      await lockClientConsentSubject(tx, input.userId);
      const receipt = await tx.execute(
        sql`select id from early_bird_receipt_contacts where id=${input.receiptContactId}::uuid and user_id=${input.userId}::uuid and choice_id=${input.choiceId}::uuid and expires_at=${input.requestExpiresAt}::timestamptz and expires_at>clock_timestamp() and early_bird_receipt_authorized(user_id,choice_id) for share`,
      );
      if (receipt.rows.length !== 1) return { kind: "unavailable" };
      const prior = (
        await tx.execute<{
          exact: boolean;
          digest: string;
          keyReference: string;
          base: string;
          monthly: string;
          participant: "expert" | "space";
          offer: string;
          quote: string;
          expiry: string;
          launch: string;
          eligible: boolean;
        }>(sql`
    select (i.id=${input.operationId}::uuid and i.invoice_id=${input.invoiceId}::uuid and i.idempotency_key=${input.idempotencyKey}::uuid and i.base_id=${input.baseId}::uuid and i.choice_id=${input.choiceId}::uuid and i.grant_id is null and i.pricing_policy='wave1_standard_v1' and i.provider_mode=${input.mode} and i.status='prepared' and cfg.active and i.base_offer_shown_at=b.base_offer_shown_at and i.expires_at=b.base_offer_shown_at+interval '240 hours' and i.launch_at=cfg.client_start_at and r.idempotency_key=i.idempotency_key and r.user_id=i.user_id and r.request_digest=i.request_digest and r.body_version=1 and r.expires_at=${input.requestExpiresAt}::timestamptz and r.expires_at>clock_timestamp()) as exact,
    i.request_digest as digest,r.key_reference as "keyReference",i.base_monthly_minor::text as base,i.subscription_minor::text as monthly,i.participant_kind as participant,
    to_char(i.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as offer,to_char(i.quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as quote,
    to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expiry,to_char(i.launch_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as launch,i.promotion_eligible as eligible
    from early_bird_composite_intents i join expert_sales_bases b on b.id=i.base_id and b.user_id=i.user_id join early_bird_launch_configs cfg on cfg.id=i.config_id left join early_bird_composite_requests r on r.intent_id=i.id where i.user_id=${input.userId}::uuid and i.status in ('prepared','unknown','settled') for update of i`)
      ).rows;
      const snapshot = (row: PriceRow): StandardSnapshot => ({
        invoiceId: input.invoiceId,
        userId: input.userId,
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        pricingPolicy: "wave1_standard_v1",
        ruleVersion: "expert_separated_sales_v3",
        priceKind:
          BigInt(row.monthly) < BigInt(row.base) ? "discounted" : "full_price",
        promotionEligible: row.eligible,
        participantKind: row.participant,
        mode: input.mode,
        baseMonthlyMinor: row.base,
        onboardingMinor: "300000",
        subscriptionMinor: row.monthly,
        totalMinor: (BigInt(row.monthly) + 300000n).toString(),
        baseOfferShownAt: row.offer,
        quotedAt: row.quote,
        expiresAt: row.expiry,
        launchAt: row.launch,
      });
      if (prior.length) {
        if (prior.length !== 1 || prior[0]?.exact !== true)
          return { kind: "unavailable" };
        const fingerprint = seal.fingerprint(snapshot(prior[0]));
        return {
          kind:
            fingerprint.digest === prior[0].digest &&
            fingerprint.keyReference === prior[0].keyReference
              ? "replay"
              : "unavailable",
        };
      }
      const rows = (
        await tx.execute<PriceRow>(sql`
    with q as materialized (select early_bird_current_time() as now)
    select b.base_tariff_amount::text as base, greatest(500000,(b.base_tariff_amount*(10000-case when q.now<b.base_offer_shown_at+interval '96 hours' then 4000 when q.now<b.base_offer_shown_at+interval '168 hours' then 3000 when q.now<b.base_offer_shown_at+interval '240 hours' then 2000 else 0 end)+5000)/10000)::text as monthly,b.participant_kind as participant,
    to_char(b.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as offer,to_char(q.now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as quote,
    to_char((b.base_offer_shown_at+interval '240 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expiry,to_char(cfg.client_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as launch,q.now<b.base_offer_shown_at+interval '240 hours' as eligible
    from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_positive_price_snapshots s on s.positive_choice_id=c.positive_choice_id and s.user_id=c.user_id and s.base_id=c.base_id join early_bird_launch_configs cfg on cfg.active cross join q
    where b.id=${input.baseId}::uuid and b.user_id=${input.userId}::uuid and c.id=${input.choiceId}::uuid and c.choice='now' and s.policy_version='wave1_standard_v1' and s.grant_id is null and s.onboarding_minor=300000 and not exists(select 1 from owner_test_pricing_grants g where g.user_id=b.user_id and g.revoked_at is null and g.provider_mode='live') and early_bird_wave_active(q.now) and early_bird_composite_qualification(b.user_id,c.id) and expert_card_current_messaging_authority(b.user_id,b.consent_version) for share of b,c,s,cfg`)
      ).rows;
      if (rows.length !== 1) return { kind: "unavailable" };
      const first = seal(snapshot(rows[0]!));
      const inserted = (
        await tx.execute<{ quotedAt: string }>(sql`
    insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,config_id,pricing_policy,provider_mode,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest)
    select ${input.operationId}::uuid,${input.invoiceId}::uuid,b.user_id,b.id,c.id,cfg.id,'wave1_standard_v1',${input.mode},${input.idempotencyKey}::uuid,300000,${rows[0]!.monthly}::bigint,${(BigInt(rows[0]!.monthly) + 300000n).toString()}::bigint,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours',cfg.client_start_at,${first.digest}
    from expert_sales_bases b join early_bird_choices c on c.id=${input.choiceId}::uuid and c.base_id=b.id and c.user_id=b.user_id join early_bird_launch_configs cfg on cfg.active where b.id=${input.baseId}::uuid and b.user_id=${input.userId}::uuid returning to_char(quoted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "quotedAt"`)
      ).rows;
      if (inserted.length !== 1) throw new Error("early_bird_prepare_source");
      const actual = seal(
        snapshot({ ...rows[0]!, quote: inserted[0]!.quotedAt }),
      );
      if (
        actual.digest !== first.digest ||
        actual.keyReference !== first.keyReference
      )
        throw new Error("early_bird_prepare_quote_changed");
      await tx.execute(
        sql`insert into early_bird_composite_requests(intent_id,user_id,idempotency_key,request_digest,body_version,ciphertext,key_reference,expires_at) values(${input.operationId}::uuid,${input.userId}::uuid,${input.idempotencyKey}::uuid,${actual.digest},1,${actual.ciphertext},${actual.keyReference},${input.requestExpiresAt}::timestamptz)`,
      );
      return { kind: "prepared" };
    });
  }
}
