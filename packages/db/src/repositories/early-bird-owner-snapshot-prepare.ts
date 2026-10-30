import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
import {
  PostgresEarlyBirdOwnerIntentPrepare,
  type EarlyBirdOwnerIntentPrepareInput,
} from "./early-bird-owner-intent-prepare.js";

export type EarlyBirdOwnerSnapshot = {
  invoiceId: string;
  userId: string;
  operationId: string;
  idempotencyKey: string;
  grantId: string;
  pricingPolicy: "owner_test_10_20_v1";
  priceKind: "fixed_test";
  mode: "live";
  onboardingMinor: "1000";
  subscriptionMinor: "2000";
  totalMinor: "3000";
  baseOfferShownAt: string;
  expiresAt: string;
  launchAt: string;
};
type Input = Omit<
  EarlyBirdOwnerIntentPrepareInput,
  "digest" | "ciphertext" | "keyReference"
> & { receiptContactId?: string };
type Seal = ((snapshot: EarlyBirdOwnerSnapshot) => {
  digest: string;
  ciphertext: string;
  keyReference: string;
}) & {
  fingerprint(snapshot: EarlyBirdOwnerSnapshot): {
    digest: string;
    keyReference: string;
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Internal draft composition. Sealer must synchronously encrypt a canonical request using trusted receipt and fiscal data. */
export class PostgresEarlyBirdOwnerSnapshotPrepare {
  constructor(
    private readonly db: DrizzleDb,
    private readonly timeoutMs = 4000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 30000
    )
      throw new Error("early_bird_prepare_timeout");
  }
  async prepare(
    input: Input,
    seal: Seal,
  ): Promise<{ kind: "prepared" | "replay" | "unavailable" }> {
    if (
      ![
        input.userId,
        input.baseId,
        input.choiceId,
        input.grantId,
        input.operationId,
        input.invoiceId,
        input.idempotencyKey,
      ].every((id) => uuid.test(id)) ||
      (input.receiptContactId !== undefined &&
        !uuid.test(input.receiptContactId))
    )
      throw new Error("early_bird_prepare_invalid");
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${`${this.timeoutMs}ms`}, true)`,
      );
      await lockClientConsentSubject(tx, input.userId);
      if (input.receiptContactId !== undefined) {
        const receipt = await tx.execute(
          sql`select id from early_bird_receipt_contacts where id=${input.receiptContactId}::uuid and user_id=${input.userId}::uuid and choice_id=${input.choiceId}::uuid and expires_at=${input.requestExpiresAt}::timestamptz and expires_at>clock_timestamp() and early_bird_receipt_authorized(user_id,choice_id) for share`,
        );
        if (receipt.rows.length !== 1) return { kind: "unavailable" };
      }
      const row = (
        await tx.execute<{ offer: string; expiry: string; launch: string }>(sql`
        select to_char(b.base_offer_shown_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as offer,
          to_char((b.base_offer_shown_at+interval '240 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expiry,
          to_char(cfg.client_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as launch
        from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id
        join early_bird_positive_price_snapshots s on s.positive_choice_id=c.positive_choice_id and s.user_id=c.user_id and s.base_id=c.base_id
        join owner_test_pricing_grants g on g.id=s.grant_id and g.user_id=b.user_id
        join early_bird_launch_configs cfg on cfg.active
        join users u on u.id=b.user_id
        where b.id=${input.baseId}::uuid and b.user_id=${input.userId}::uuid and c.id=${input.choiceId}::uuid
          and g.id=${input.grantId}::uuid and g.revoked_at is null and g.provider_mode='live' and g.policy_version='owner_test_10_20_v1'
          and s.policy_version='owner_test_10_20_v1' and s.onboarding_minor=1000 and c.choice='now' and u.active
          and cfg.phase='WAVE_1_EARLY_BIRD' and early_bird_wave_active(early_bird_current_time())
          and early_bird_composite_qualification(b.user_id,c.id) and expert_card_current_messaging_authority(b.user_id,b.consent_version)
        for share of b,c,s,g,cfg,u`)
      ).rows[0];
      if (!row) return { kind: "unavailable" };
      const snapshot: EarlyBirdOwnerSnapshot = {
        invoiceId: input.invoiceId,
        userId: input.userId,
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        grantId: input.grantId,
        pricingPolicy: "owner_test_10_20_v1",
        priceKind: "fixed_test",
        mode: "live",
        onboardingMinor: "1000",
        subscriptionMinor: "2000",
        totalMinor: "3000",
        baseOfferShownAt: row.offer,
        expiresAt: row.expiry,
        launchAt: row.launch,
      };
      const prior = (
        await tx.execute<{
          exact: boolean;
          digest: string;
          keyReference: string;
        }>(sql`
        select (i.id=${input.operationId}::uuid and i.invoice_id=${input.invoiceId}::uuid
          and i.idempotency_key=${input.idempotencyKey}::uuid and i.base_id=${input.baseId}::uuid
          and i.choice_id=${input.choiceId}::uuid and i.grant_id=${input.grantId}::uuid
          and i.pricing_policy='owner_test_10_20_v1' and i.price_kind='fixed_test' and i.provider_mode='live'
          and i.onboarding_minor=1000 and i.subscription_minor=2000 and i.total_minor=3000 and i.status='prepared'
          and i.base_offer_shown_at=b.base_offer_shown_at and i.expires_at=b.base_offer_shown_at+interval '240 hours'
          and cfg.active and i.launch_at=cfg.client_start_at
          and r.user_id=i.user_id and r.idempotency_key=i.idempotency_key and r.request_digest=i.request_digest
          and r.body_version=1 and r.expires_at=${input.requestExpiresAt}::timestamptz and r.expires_at>clock_timestamp()) as exact, i.request_digest as digest, r.key_reference as "keyReference"
        from early_bird_composite_intents i
        join expert_sales_bases b on b.id=i.base_id and b.user_id=i.user_id
        join early_bird_launch_configs cfg on cfg.id=i.config_id
        left join early_bird_composite_requests r on r.intent_id=i.id
        where i.user_id=${input.userId}::uuid and i.status in ('prepared','unknown','settled') for update of i`)
      ).rows;
      if (prior.length !== 0) {
        if (prior.length !== 1 || prior[0]?.exact !== true)
          return { kind: "unavailable" };
        const fingerprint = seal.fingerprint(snapshot);
        return {
          kind:
            fingerprint.digest === prior[0].digest &&
            fingerprint.keyReference === prior[0].keyReference
              ? "replay"
              : "unavailable",
        };
      }
      const envelope = seal(snapshot);
      return new PostgresEarlyBirdOwnerIntentPrepare(
        tx as unknown as DrizzleDb,
      ).prepare({ ...input, ...envelope });
    });
  }
}
