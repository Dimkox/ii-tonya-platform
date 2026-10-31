import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";

export type EarlyBirdOwnerIntentPrepareInput = {
  userId: string;
  baseId: string;
  choiceId: string;
  grantId: string;
  operationId: string;
  invoiceId: string;
  idempotencyKey: string;
  digest: string;
  ciphertext: string;
  keyReference: string;
  requestExpiresAt: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const uuid4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Draft-only persistence for the 0081 schema. The caller must supply an authenticated,
 * encrypted canonical request and its digest; neither encryption nor first-send
 * authorization is provided by this repository. 0081's triggers are mandatory:
 * they validate qualification, consent, grant, source, amount and chronology.
 */
export class PostgresEarlyBirdOwnerIntentPrepare {
  constructor(private readonly db: DrizzleDb) {}

  async prepare(
    input: EarlyBirdOwnerIntentPrepareInput,
  ): Promise<{ kind: "prepared" | "replay" }> {
    const ids = [
      input.userId,
      input.baseId,
      input.choiceId,
      input.grantId,
      input.invoiceId,
    ];
    if (
      ids.some((id) => !uuid.test(id)) ||
      !uuid4.test(input.operationId) ||
      !uuid4.test(input.idempotencyKey) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.digest) ||
      typeof input.ciphertext !== "string" ||
      input.ciphertext.length < 1 ||
      input.ciphertext.length > 262144 ||
      !/^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{1,128}$/u.test(
        input.keyReference,
      ) ||
      !Number.isFinite(Date.parse(input.requestExpiresAt))
    )
      throw new Error("early_bird_prepare_invalid");

    return this.db.transaction(async (tx) => {
      // The trigger and erasure paths use this subject lock as well.
      await lockClientConsentSubject(tx, input.userId);
      const prior = (
        await tx.execute<{ exact: boolean }>(sql`
        select (i.user_id=${input.userId}::uuid and i.base_id=${input.baseId}::uuid and i.choice_id=${input.choiceId}::uuid
          and i.grant_id=${input.grantId}::uuid and i.invoice_id=${input.invoiceId}::uuid
          and i.idempotency_key=${input.idempotencyKey}::uuid and i.request_digest=${input.digest}
          and i.pricing_policy='owner_test_10_20_v1' and i.status='prepared'
          and r.user_id=i.user_id and r.idempotency_key=i.idempotency_key and r.request_digest=i.request_digest
          and r.ciphertext=${input.ciphertext} and r.key_reference=${input.keyReference}
          and r.body_version=1 and r.expires_at=${input.requestExpiresAt}::timestamptz and r.expires_at>clock_timestamp()) as exact
        from early_bird_composite_intents i left join early_bird_composite_requests r on r.intent_id=i.id
        where i.id=${input.operationId}::uuid for update of i`)
      ).rows[0];
      if (prior) {
        if (prior.exact !== true)
          throw new Error("early_bird_prepare_conflict");
        return { kind: "replay" };
      }
      const inserted = await tx.execute(sql`
        insert into early_bird_composite_intents
          (id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest)
        select ${input.operationId}::uuid,${input.invoiceId}::uuid,b.user_id,b.id,c.id,${input.grantId}::uuid,cfg.id,
          'owner_test_10_20_v1',${input.idempotencyKey}::uuid,1000,2000,3000,b.base_offer_shown_at,
          b.base_offer_shown_at+interval '240 hours',cfg.client_start_at,${input.digest}
        from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id
        join early_bird_launch_configs cfg on cfg.active
        where b.id=${input.baseId}::uuid and b.user_id=${input.userId}::uuid and c.id=${input.choiceId}::uuid
        returning id`);
      if (inserted.rows.length !== 1)
        throw new Error("early_bird_prepare_source");
      const request = await tx.execute(sql`
        insert into early_bird_composite_requests(intent_id,user_id,idempotency_key,request_digest,body_version,ciphertext,key_reference,expires_at)
        values(${input.operationId}::uuid,${input.userId}::uuid,${input.idempotencyKey}::uuid,${input.digest},1,${input.ciphertext},${input.keyReference},${input.requestExpiresAt}::timestamptz)
        returning intent_id`);
      if (request.rows.length !== 1)
        throw new Error("early_bird_prepare_request");
      return { kind: "prepared" };
    });
  }
}
