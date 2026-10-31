import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { restoreSettledMainCardProjection } from "./expert-residency-main-projection.js";
import type { DrizzleDb } from "../client.js";
import type {
  ResidencyLifecycle,
  ResidencyOwnerEvent,
  ResidencyOwnerScope,
  ResidencyRenewalBill,
} from "@ii-tonya/contracts";
import {
  beginCardRequest,
  finishCardRequest,
  normalizeCardEvent,
  lockCardActivationGate,
  type ExpertCardTransaction,
  type ExpertCardMaterialTransport,
} from "./expert-card-repository.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import { originalClientConsentSql } from "./consent-current.js";
import {
  PostgresExpertCampaignQuoteRepository,
  ExpertCampaignQuoteError,
} from "./expert-campaign-quote-repository.js";
export class ExpertResidencyLifecycleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpertResidencyLifecycleError";
  }
}
const fail = (code: string): never => {
  throw new ExpertResidencyLifecycleError(code);
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = (value: string) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
export function parseResidencyReturnDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    value.slice(0, 4) === "0000"
  )
    return fail("residency_invalid_return_date");
  const date = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return fail("residency_invalid_return_date");
  return value;
}
export function lifecycleBatchLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 50
  )
    return fail("residency_invalid_batch");
  return value;
}
type ReceiptScope = {
  botId: string;
  chatId: string;
  contentVersion: string;
  payloadDigest: string;
};
export function validateResidencyNoticeReceipt(
  value: unknown,
  expected: ReceiptScope,
): ReceiptScope & { messageIds: readonly string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("residency_notice_receipt_invalid");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join("|") !==
      "botId|chatId|contentVersion|messageIds|payloadDigest" ||
    !Array.isArray(row.messageIds) ||
    row.messageIds.length !== 1 ||
    typeof row.messageIds[0] !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(row.messageIds[0]) ||
    row.botId !== expected.botId ||
    row.chatId !== expected.chatId ||
    row.contentVersion !== expected.contentVersion ||
    row.payloadDigest !== expected.payloadDigest
  )
    return fail("residency_notice_receipt_invalid");
  return { ...expected, messageIds: [row.messageIds[0]] };
}
const iso = (value: string | Date) => {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime()))
    return fail("residency_storage_unavailable");
  return d.toISOString();
};
/** Must be called under the original subject barrier; locks participate in SERIALIZABLE conflict detection. */
export async function lockResidencyLifecycle(
  tx: ExpertCardTransaction,
  userId: string,
): Promise<{ paused: boolean }> {
  await lockClientConsentSubject(tx, userId);
  await tx.execute(
    sql`select user_id from expert_residency_lifecycle where user_id=${userId}::uuid for update`,
  );
  const row = (
    await tx.execute<{ paused: boolean }>(
      sql`select status='paused' as paused from expert_residency_lifecycle where user_id=${userId}::uuid`,
    )
  ).rows[0];
  return { paused: row?.paused === true };
}
export interface RenewalBillCheckoutContext {
  readonly billId: string;
  readonly userId: string;
  readonly expertId: string;
  readonly quoteId: string;
  readonly acceptanceId: string;
  readonly orderId: string | null;
  readonly attemptSequence: number;
}
const checkoutContexts = new WeakMap<
  object,
  { tx: ExpertCardTransaction; orderId?: string }
>();
export async function lockRenewalBillForCheckout(
  tx: ExpertCardTransaction,
  raw: { userId: string; billId: string; quoteId?: string },
): Promise<RenewalBillCheckoutContext> {
  const input = Object.freeze({ ...raw });
  if (
    !uuid.test(input.userId) ||
    !uuid.test(input.billId) ||
    (input.quoteId !== undefined && !uuid.test(input.quoteId))
  )
    return fail("residency_bill_unavailable");
  await lockClientConsentSubject(tx, input.userId);
  const row = (
    await tx.execute<{
      billId: string;
      userId: string;
      expertId: string;
      quoteId: string | null;
      acceptanceId: string | null;
      orderId: string | null;
    }>(
      sql`select id as "billId",user_id as "userId",expert_id as "expertId",quote_id as "quoteId",acceptance_id as "acceptanceId",order_id as "orderId" from expert_residency_renewal_bills where id=${input.billId}::uuid and user_id=${input.userId}::uuid for update`,
    )
  ).rows[0];
  if (
    !row?.quoteId ||
    !row.acceptanceId ||
    (input.quoteId && input.quoteId !== row.quoteId)
  )
    return fail("residency_bill_unavailable");
  const prior = (
    await tx.execute<{
      sequence: number;
      acceptanceId: string;
      orderId: string;
      expired: boolean;
    }>(
      sql`select a.sequence,a.acceptance_id as "acceptanceId",a.order_id as "orderId",(o.status='expired' and o.payment_deadline<=clock_timestamp()) as expired from expert_residency_renewal_attempts a join expert_residency_orders o on o.id=a.order_id where a.bill_id=${input.billId}::uuid order by a.sequence desc limit 1 for update of o`,
    )
  ).rows[0];
  if (
    prior &&
    prior.acceptanceId !== row.acceptanceId &&
    prior.expired !== true
  )
    return fail("residency_bill_order_conflict");
  const attemptSequence = prior
    ? prior.acceptanceId === row.acceptanceId
      ? prior.sequence
      : prior.sequence + 1
    : 1;
  const orderId =
    prior?.acceptanceId === row.acceptanceId ? prior.orderId : null;
  const context = Object.freeze({
    ...row,
    quoteId: row.quoteId,
    acceptanceId: row.acceptanceId,
    orderId,
    attemptSequence,
  });
  checkoutContexts.set(context, { tx });
  return context;
}
export async function finishRenewalBillOrder(
  tx: ExpertCardTransaction,
  context: RenewalBillCheckoutContext,
  orderId: string,
) {
  if (
    checkoutContexts.get(context)?.tx !== tx ||
    (checkoutContexts.get(context)?.orderId !== undefined &&
      checkoutContexts.get(context)?.orderId !== orderId) ||
    !uuid.test(orderId) ||
    (context.orderId && context.orderId !== orderId)
  )
    return fail("residency_bill_order_conflict");
  if (context.orderId || checkoutContexts.get(context)?.orderId) {
    const existing = (
      await tx.execute(
        sql`select order_id from expert_residency_renewal_attempts where bill_id=${context.billId}::uuid and sequence=${context.attemptSequence} and quote_id=${context.quoteId}::uuid and acceptance_id=${context.acceptanceId}::uuid and order_id=${orderId}::uuid`,
      )
    ).rows;
    if (existing.length !== 1) return fail("residency_bill_order_conflict");
  } else
    await tx.execute(
      sql`insert into expert_residency_renewal_attempts(bill_id,sequence,quote_id,acceptance_id,order_id) values(${context.billId}::uuid,${context.attemptSequence},${context.quoteId}::uuid,${context.acceptanceId}::uuid,${orderId}::uuid)`,
    );
  const rows = (
    await tx.execute(
      sql`update expert_residency_renewal_bills set order_id=coalesce(order_id,${orderId}::uuid) where id=${context.billId}::uuid and user_id=${context.userId}::uuid and quote_id=${context.quoteId}::uuid and acceptance_id=${context.acceptanceId}::uuid returning id`,
    )
  ).rows;
  if (rows.length !== 1) return fail("residency_bill_order_conflict");
  checkoutContexts.set(context, { tx, orderId });
}
type Policy = {
  messagingConsentPolicyVersion: string;
  workBotId: string;
  workBotKey: string;
  noticeTransport?: ExpertCardMaterialTransport;
};
export class PostgresExpertResidencyLifecycleRepository {
  private readonly policy: Readonly<Policy>;
  constructor(
    private readonly db: DrizzleDb,
    policy: Policy,
  ) {
    if (
      !policy ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
        policy.messagingConsentPolicyVersion,
      ) ||
      !/^[1-9]\d{0,19}$/u.test(policy.workBotId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(policy.workBotKey)
    )
      fail("residency_configuration_invalid");
    this.policy = Object.freeze({ ...policy });
  }
  private async transaction<T>(
    work: (tx: ExpertCardTransaction) => Promise<T>,
    statementTimeoutMs = 3000,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('statement_timeout',${String(statementTimeoutMs)},true)`,
        );
        await tx.execute(sql`set local lock_timeout='500ms'`);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof ExpertResidencyLifecycleError) throw error;
      if (
        error instanceof Error &&
        "code" in error &&
        ["card_forbidden", "card_idempotency_conflict"].includes(
          String(error.code),
        )
      )
        throw error;
      return fail("residency_storage_unavailable");
    }
  }
  private scope(raw: ResidencyOwnerScope): ResidencyOwnerScope {
    const copy = normalizeCardEvent({
      ...raw,
      requestKey: raw.botId + ":0",
      requestDigest: "0".repeat(64),
    });
    if (
      copy.botId !== this.policy.workBotId ||
      copy.botKey !== this.policy.workBotKey
    )
      return fail("residency_forbidden");
    return copy;
  }
  private async authorized(
    tx: ExpertCardTransaction,
    raw: ResidencyOwnerScope,
  ): Promise<{ userId: string; expertId: string } | null> {
    const scope = this.scope(raw);
    const identities = (
      await tx.execute<{ userId: string }>(
        sql`select ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${scope.botKey} and ci.external_id=${scope.telegramUserId} and ci.external_chat_id=${scope.chatId} and ci.status='active' limit 2`,
      )
    ).rows;
    if (identities.length !== 1) return null;
    const userId = identities[0]!.userId;
    await lockClientConsentSubject(tx, userId);
    if (
      !(await captureClientConsentAuthority(tx, {
        subjectId: userId,
        botKey: scope.botKey,
        chatId: scope.chatId,
        externalUserId: scope.telegramUserId,
        messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
      }))
    )
      return null;
    const expert = (
      await tx.execute<{ expertId: string }>(
        sql`select id as "expertId" from experts where user_id=${userId}::uuid and (exists(select 1 from expert_residency_orders o where o.expert_id=experts.id and o.status in('settled','refunded','charged_back')) or exists(select 1 from experts_published p where p.expert_id=experts.id and p.user_id=experts.user_id and p.wave_intent_id is not null and p.paid_order_id is null)) for update`,
      )
    ).rows[0];
    if (!expert) return null;
    return { userId, expertId: expert.expertId };
  }
  private async ensureState(
    tx: ExpertCardTransaction,
    userId: string,
    expertId: string,
  ) {
    await tx.execute(
      sql`insert into expert_residency_lifecycle(user_id,expert_id,status) values(${userId}::uuid,${expertId}::uuid,'payment_required') on conflict(user_id) do nothing`,
    );
    await tx.execute(
      sql`select user_id from expert_residency_lifecycle where user_id=${userId}::uuid for update`,
    );
  }
  private async waveCapability(tx: ExpertCardTransaction, signature: string) {
    // Resolve private OIDs only after USAGE is independently established.
    const schema = (
      await tx.execute<{ allowed: boolean }>(
        sql`select has_schema_privilege(current_user,'early_bird_private','USAGE') as allowed`,
      )
    ).rows[0]?.allowed;
    if (schema !== true) return false;
    return (
      (
        await tx.execute<{ allowed: boolean }>(
          sql`select coalesce(has_function_privilege(current_user,to_regprocedure(${signature}),'EXECUTE'),false) as allowed`,
        )
      ).rows[0]?.allowed === true
    );
  }
  private async currentWaveCoverageEnd(
    tx: ExpertCardTransaction,
    expertId: string,
  ) {
    if (
      !(await this.waveCapability(
        tx,
        "early_bird_private.public_current_wave_end(uuid)",
      ))
    )
      return null;
    const row = (
      await tx.execute<{ endsAt: string | Date | null }>(
        sql`select early_bird_private.public_current_wave_end(${expertId}::uuid) as "endsAt"`,
      )
    ).rows[0];
    return row?.endsAt ? iso(row.endsAt) : null;
  }
  private async snapshot(
    tx: ExpertCardTransaction,
    userId: string,
    expertId: string,
  ): Promise<ResidencyLifecycle> {
    const waveEnd = await this.currentWaveCoverageEnd(tx, expertId);
    const row = (
      await tx.execute<{
        status: ResidencyLifecycle["status"];
        pausedUntil: string | null;
        paidUntil: string | Date | null;
        revision: number;
      }>(
        sql`select l.status,l.paused_until::text as "pausedUntil",coalesce((select ends_at from expert_residency_current_coverage(l.expert_id)),${waveEnd}::timestamptz,(select max(o.residency_ends_at) from expert_residency_orders o where o.expert_id=l.expert_id and o.status='settled' and o.residency_ends_at<=clock_timestamp())) as "paidUntil",coalesce((select r.revision from expert_card_drafts d join expert_card_reviews r on r.id=coalesce((select v.review_id from resident_card_versions v where v.draft_id=d.id order by v.revision desc limit 1),d.approved_review_id) where d.user_id=l.user_id),(select revision from expert_card_drafts where user_id=l.user_id),0) as revision from expert_residency_lifecycle l where l.user_id=${userId}::uuid`,
      )
    ).rows[0];
    if (!row) return fail("residency_unavailable");
    const bill = (
      await tx.execute<
        Omit<ResidencyRenewalBill, "cycleEnd" | "quote" | "readiness"> & {
          cycleEnd: string | Date;
        }
      >(
        sql`select id,cycle_end as "cycleEnd",tariff_version_id as "tariffVersionId",term_months as "termMonths",quote_id as "quoteId",acceptance_id as "acceptanceId",(select a.order_id from expert_residency_renewal_attempts a where a.bill_id=expert_residency_renewal_bills.id order by a.sequence desc limit 1) as "orderId" from expert_residency_renewal_bills where user_id=${userId}::uuid and cycle_end=coalesce((select ends_at from expert_residency_current_coverage(expert_residency_renewal_bills.expert_id)),${waveEnd}::timestamptz,(select max(residency_ends_at) from expert_residency_orders where expert_id=expert_residency_renewal_bills.expert_id and status='settled' and residency_ends_at<=clock_timestamp() and not exists(select 1 from expert_residency_orders future where future.expert_id=expert_residency_renewal_bills.expert_id and future.status='settled' and future.residency_starts_at>clock_timestamp()))) order by created_at desc limit 1`,
      )
    ).rows[0];
    const quote = bill?.quoteId
      ? (
          await tx.execute<{
            id: string;
            priceMinor: string;
            currency: "RUB";
            termMonths: 1 | 3;
            expiresAt: string | Date;
          }>(
            sql`select id,price_minor::text as "priceMinor",currency,term_months as "termMonths",expires_at as "expiresAt" from expert_campaign_quotes where id=${bill.quoteId}::uuid and user_id=${userId}::uuid`,
          )
        ).rows[0]
      : null;
    let readiness: "ready" | "requires_card" = "requires_card";
    if (bill) {
      const draft = (
        await tx.execute<{ applicationId: string }>(
          sql`select application_id as "applicationId" from expert_card_drafts where user_id=${userId}::uuid and work_bot_id=${this.policy.workBotId} and work_bot_key=${this.policy.workBotKey} and (status='approved' or exists(select 1 from resident_card_versions v where v.draft_id=expert_card_drafts.id))`,
        )
      ).rows[0];
      if (draft) {
        const gate = await lockCardActivationGate(tx, {
          applicationId: draft.applicationId,
          userId,
        });
        if (
          gate?.messagingConsentPolicyVersion ===
          this.policy.messagingConsentPolicyVersion
        )
          readiness = "ready";
      }
    }
    return {
      ...row,
      paidUntil: row.paidUntil ? iso(row.paidUntil) : null,
      bill: bill
        ? {
            ...bill,
            readiness,
            cycleEnd: iso(bill.cycleEnd),
            quote: quote ? { ...quote, expiresAt: iso(quote.expiresAt) } : null,
          }
        : null,
    };
  }
  private async reconcile(
    tx: ExpertCardTransaction,
    userId: string,
    expertId: string,
  ): Promise<{ suspended: boolean; resumed: boolean }> {
    await this.ensureState(tx, userId, expertId);
    const before = (
      await tx.execute<{ status: string; due: boolean }>(
        sql`select status,paused_until<=(clock_timestamp() at time zone 'UTC')::date as due from expert_residency_lifecycle where user_id=${userId}::uuid`,
      )
    ).rows[0]!;
    if (before.status === "paused" && !before.due) {
      await this.hide(tx, userId, expertId);
      // An examined future pause must move behind residents not yet scanned.
      await tx.execute(
        sql`update expert_residency_lifecycle set updated_at=clock_timestamp() where user_id=${userId}::uuid`,
      );
      return { suspended: false, resumed: false };
    }
    const consent = (
      await tx.execute<{ policyVersion: string }>(
        originalClientConsentSql(userId, "client_messaging"),
      )
    ).rows;
    const routing = await this.noticeTarget(tx, userId);
    const main =
      (
        await tx.execute<{ present: boolean }>(
          sql`select exists(select 1 from expert_card_main_orders where user_id=${userId}::uuid) as present`,
        )
      ).rows[0]?.present === true;
    // Clear a due pause before the narrowly bound projection repair. No paid
    // intervals are changed, and failure keeps both projections hidden.
    await tx.execute(
      sql`update expert_residency_lifecycle set status='payment_required',paused_until=null,updated_at=clock_timestamp() where user_id=${userId}::uuid`,
    );
    let eligible = false;
    if (
      routing &&
      consent.length === 1 &&
      consent[0]!.policyVersion === this.policy.messagingConsentPolicyVersion
    ) {
      // A historical main order must not shadow the current Wave entitlement.
      // Dispatch the optional capability only after a separate privilege probe;
      // ordinary legacy principals retain their existing fallback without grants.
      if (
        await this.waveCapability(
          tx,
          "early_bird_private.public_restore_wave_projection(uuid,uuid)",
        )
      ) {
        eligible =
          (
            await tx.execute<{ eligible: boolean }>(
              sql`select early_bird_private.public_restore_wave_projection(${userId}::uuid,${expertId}::uuid) as eligible`,
            )
          ).rows[0]?.eligible === true;
      }
      if (!eligible && main)
        eligible = await restoreSettledMainCardProjection(tx, {
          userId,
          expertId,
        });
      else if (!eligible) {
        await tx.execute(
          sql`select id from experts where id=${expertId}::uuid for update`,
        );
        eligible =
          (
            await tx.execute<{ eligible: boolean }>(
              sql`select e.verified and u.active and not exists(select 1 from expert_referral_abuse_holds where expert_id=e.id and status='open') and exists(select 1 from expert_residency_orders o where o.expert_id=e.id and o.status='settled' and o.residency_starts_at<=clock_timestamp() and o.residency_ends_at>clock_timestamp()) as eligible from experts e join users u on u.id=e.user_id where e.id=${expertId}::uuid`,
            )
          ).rows[0]?.eligible === true;
        if (eligible)
          await tx.execute(
            sql`update experts set active=true,updated_at=clock_timestamp() where id=${expertId}::uuid`,
          );
      }
    }
    if (!eligible) await this.hide(tx, userId, expertId);
    const next = eligible ? "active" : "payment_required";
    await tx.execute(
      sql`update expert_residency_lifecycle set status=${next},paused_until=null,updated_at=clock_timestamp() where user_id=${userId}::uuid`,
    );
    if (before.status !== next)
      await tx.execute(
        sql`insert into expert_residency_lifecycle_audits(user_id,expert_id,action) values(${userId}::uuid,${expertId}::uuid,${before.status === "paused" ? "automatic_return" : eligible ? "restore" : "suspend"})`,
      );
    return {
      suspended: before.status === "active" && !eligible,
      resumed: before.status !== "active" && eligible,
    };
  }
  private async hide(
    tx: ExpertCardTransaction,
    userId: string,
    expertId: string,
  ) {
    await tx.execute(
      sql`update experts_published set active=false,updated_at=clock_timestamp() where user_id=${userId}::uuid and active`,
    );
    await tx.execute(
      sql`update experts set active=false,updated_at=clock_timestamp() where id=${expertId}::uuid and active`,
    );
  }
  async readLifecycle(
    raw: ResidencyOwnerScope,
  ): Promise<ResidencyLifecycle | null> {
    const scope = this.scope(raw);
    return this.transaction(async (tx) => {
      const owner = await this.authorized(tx, scope);
      if (!owner) return null;
      await this.reconcile(tx, owner.userId, owner.expertId);
      return this.snapshot(tx, owner.userId, owner.expertId);
    });
  }
  async requestPause(
    raw: ResidencyOwnerEvent & { returnDate: string },
  ): Promise<ResidencyLifecycle & { replay: boolean }> {
    const event = {
      ...normalizeCardEvent(raw),
      returnDate: parseResidencyReturnDate(raw.returnDate),
    };
    this.scope(event);
    return this.transaction(async (tx) => {
      const request = await beginCardRequest(tx, event, "residency_pause", {
        returnDate: event.returnDate,
      });
      const owner = await this.authorized(tx, event);
      if (!owner) return fail("residency_forbidden");
      await this.ensureState(tx, owner.userId, owner.expertId);
      if (!request.replay) {
        const valid = (
          await tx.execute<{ valid: boolean }>(
            sql`select ${event.returnDate}::date>(clock_timestamp() at time zone 'UTC')::date and ${event.returnDate}::date<=((clock_timestamp() at time zone 'UTC')::date+interval '3 months')::date as valid`,
          )
        ).rows[0]?.valid;
        if (valid !== true) return fail("residency_invalid_return_date");
        await tx.execute(
          sql`update expert_residency_lifecycle set status='paused',paused_until=${event.returnDate}::date,updated_at=clock_timestamp() where user_id=${owner.userId}::uuid`,
        );
        await this.hide(tx, owner.userId, owner.expertId);
        await tx.execute(
          sql`insert into expert_residency_lifecycle_audits(user_id,expert_id,action,return_date) values(${owner.userId}::uuid,${owner.expertId}::uuid,'pause',${event.returnDate}::date)`,
        );
        await finishCardRequest(tx, request);
      }
      return {
        ...(await this.snapshot(tx, owner.userId, owner.expertId)),
        replay: request.replay,
      };
    });
  }
  async resume(
    raw: ResidencyOwnerEvent,
  ): Promise<ResidencyLifecycle & { replay: boolean }> {
    const event = normalizeCardEvent(raw);
    this.scope(event);
    return this.transaction(async (tx) => {
      const request = await beginCardRequest(tx, event, "residency_resume");
      const owner = await this.authorized(tx, event);
      if (!owner) return fail("residency_forbidden");
      await this.ensureState(tx, owner.userId, owner.expertId);
      if (!request.replay) {
        await tx.execute(
          sql`update expert_residency_lifecycle set status='payment_required',paused_until=null,updated_at=clock_timestamp() where user_id=${owner.userId}::uuid`,
        );
        await this.reconcile(tx, owner.userId, owner.expertId);
        await tx.execute(
          sql`insert into expert_residency_lifecycle_audits(user_id,expert_id,action) values(${owner.userId}::uuid,${owner.expertId}::uuid,'resume')`,
        );
        await finishCardRequest(tx, request);
      }
      return {
        ...(await this.snapshot(tx, owner.userId, owner.expertId)),
        replay: request.replay,
      };
    });
  }
  async processLifecycleBatch(
    rawLimit: number,
    options: { signal?: AbortSignal } = {},
  ) {
    const limit = lifecycleBatchLimit(rawLimit);
    const candidates = await this.transaction((tx) =>
      tx.execute<{
        userId: string;
        expertId: string;
      }>(
        sql`select e.user_id as "userId",e.id as "expertId" from experts e join users u on u.id=e.user_id and u.active where (exists(select 1 from expert_residency_orders o where o.expert_id=e.id and o.status in('settled','refunded','charged_back')) or exists(select 1 from experts_published p where p.expert_id=e.id and p.user_id=e.user_id and p.wave_intent_id is not null and p.paid_order_id is null)) order by coalesce((select updated_at from expert_residency_lifecycle where user_id=e.user_id),'epoch'::timestamptz),e.id limit ${limit}`,
      ),
    );
    const result = {
      examined: 0,
      billsCreated: 0,
      noticesCreated: 0,
      suspended: 0,
      resumed: 0,
    };
    for (const candidate of candidates.rows) {
      if (options.signal?.aborted) break;
      const changed = await this.transaction(async (tx) => {
        await lockClientConsentSubject(tx, candidate.userId);
        const active = (
          await tx.execute<{ active: boolean }>(
            sql`select active from users where id=${candidate.userId}::uuid for share`,
          )
        ).rows[0]?.active;
        if (active !== true) return null;
        await tx.execute(
          sql`select id from experts where id=${candidate.expertId}::uuid for update`,
        );
        const state = await this.reconcile(
          tx,
          candidate.userId,
          candidate.expertId,
        );
        const waveEnd = await this.currentWaveCoverageEnd(
          tx,
          candidate.expertId,
        );
        const cycle = (
          await tx.execute<{
            sourceOrderId: string;
            cycleEnd: string | Date;
            tariffVersionId: string;
            termMonths: 1 | 3;
            billDue: boolean;
            stage: string;
          }>(
            sql`select o.id as "sourceOrderId",o.residency_ends_at as "cycleEnd",o.tariff_version_id as "tariffVersionId",coalesce(q.term_months,1) as "termMonths",clock_timestamp()>=o.residency_ends_at-interval '7 days' as "billDue",case when clock_timestamp()>=o.residency_ends_at+interval '7 days' then 'archive_offer' when clock_timestamp()>=o.residency_ends_at then 'overdue' when clock_timestamp()>=o.residency_ends_at-interval '1 day' then 'one_day' else 'seven_days' end as stage from expert_residency_orders o left join expert_campaign_quotes q on q.id=o.campaign_quote_id where o.expert_id=${candidate.expertId}::uuid and o.status='settled' and (o.id=(select source_order_id from expert_residency_current_coverage(o.expert_id)) or (${waveEnd}::timestamptz is null and not exists(select 1 from expert_residency_current_coverage(o.expert_id)) and o.residency_ends_at<=clock_timestamp() and not exists(select 1 from expert_residency_orders future where future.expert_id=o.expert_id and future.status='settled' and future.residency_starts_at>clock_timestamp()))) order by o.residency_ends_at desc,o.id limit 1 for share of o`,
          )
        ).rows[0];
        let billsCreated = 0,
          noticesCreated = 0;
        if (cycle?.billDue) {
          const inserted = (
            await tx.execute<{ id: string }>(
              sql`insert into expert_residency_renewal_bills(user_id,owner_audit_id,expert_id,cycle_end,source_order_id,tariff_version_id,term_months) values(${candidate.userId}::uuid,${candidate.userId}::uuid,${candidate.expertId}::uuid,${cycle.cycleEnd}::timestamptz,${cycle.sourceOrderId}::uuid,${cycle.tariffVersionId}::uuid,${cycle.termMonths}) on conflict(expert_id,cycle_end) do nothing returning id`,
            )
          ).rows[0];
          if (inserted) {
            billsCreated = 1;
            try {
              const quote = await new PostgresExpertCampaignQuoteRepository(
                this.db,
              ).createQuoteInTransaction(tx, {
                userId: candidate.userId,
                tariffVersionId: cycle.tariffVersionId,
                termMonths: cycle.termMonths,
                idempotencyKey: "renewal-provisional:" + inserted.id,
              });
              await tx.execute(
                sql`update expert_residency_renewal_bills set quote_id=${quote.id}::uuid where id=${inserted.id}::uuid`,
              );
            } catch (error) {
              if (
                !(error instanceof ExpertCampaignQuoteError) ||
                ![
                  "EXPERT_CAMPAIGN_TARIFF_INACTIVE",
                  "EXPERT_CAMPAIGN_TERM_UNAVAILABLE",
                  "EXPERT_CAMPAIGN_EXPIRY_BOUNDARY",
                ].includes(error.code)
              )
                throw error;
            }
          }
          if (await this.noticeTarget(tx, candidate.userId)) {
            const notice = (
              await tx.execute(
                sql`insert into expert_residency_lifecycle_notices(user_id,expert_id,cycle_end,stage) values(${candidate.userId}::uuid,${candidate.expertId}::uuid,${cycle.cycleEnd}::timestamptz,${cycle.stage}) on conflict(expert_id,cycle_end,stage) do nothing returning id`,
              )
            ).rows;
            noticesCreated = notice.length;
          }
        }
        return { ...state, billsCreated, noticesCreated };
      });
      if (changed) {
        result.examined++;
        result.billsCreated += changed.billsCreated;
        result.noticesCreated += changed.noticesCreated;
        result.suspended += Number(changed.suspended);
        result.resumed += Number(changed.resumed);
      }
    }
    return result;
  }
  async listDueNotices(
    rawLimit: number,
  ): Promise<readonly { noticeId: string }[]> {
    const limit = lifecycleBatchLimit(rawLimit);
    return (
      await this.transaction((tx) =>
        tx.execute<{ noticeId: string }>(
          sql`select n.id as "noticeId" from expert_residency_lifecycle_notices n where n.status in('waiting_content','pending') and n.attempt_id is null and exists(select 1 from expert_card_material_templates t where t.content_version='lifecycle.'||n.stage||'.v1' and t.status='approved' and t.assets='[]'::jsonb) order by n.created_at,n.id limit ${limit}`,
        ),
      )
    ).rows;
  }
  private async noticeTarget(tx: ExpertCardTransaction, userId: string) {
    await lockClientConsentSubject(tx, userId);
    const rows = (
      await tx.execute<{ chatId: string }>(
        sql`select ci.external_chat_id as "chatId" from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.user_id=${userId}::uuid and ci.provider='telegram' and ci.bot_key=${this.policy.workBotKey} and ci.status='active' and ci.external_id=ci.external_chat_id for share of ci,u`,
      )
    ).rows;
    if (rows.length !== 1) return null;
    const chatId = rows[0]!.chatId;
    if (
      !/^[1-9]\d{0,19}$/u.test(chatId) ||
      !(await captureClientConsentAuthority(tx, {
        subjectId: userId,
        botKey: this.policy.workBotKey,
        chatId,
        externalUserId: chatId,
        messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
      }))
    )
      return null;
    return chatId;
  }
  private async noticeCurrent(
    tx: ExpertCardTransaction,
    noticeId: string,
  ): Promise<boolean> {
    const row = (
      await tx.execute<{ current: boolean }>(
        sql`select n.cycle_end=coalesce((select ends_at from expert_residency_current_coverage(n.expert_id)),(select max(residency_ends_at) from expert_residency_orders where expert_id=n.expert_id and status='settled' and residency_ends_at<=clock_timestamp() and not exists(select 1 from expert_residency_orders future where future.expert_id=n.expert_id and future.status='settled' and future.residency_starts_at>clock_timestamp()))) and n.stage=(case when clock_timestamp()>=n.cycle_end+interval '7 days' then 'archive_offer' when clock_timestamp()>=n.cycle_end then 'overdue' when clock_timestamp()>=n.cycle_end-interval '1 day' then 'one_day' when clock_timestamp()>=n.cycle_end-interval '7 days' then 'seven_days' else '' end) as current from expert_residency_lifecycle_notices n where n.id=${noticeId}::uuid`,
      )
    ).rows[0];
    return row?.current === true;
  }
  async deliverNotice(
    noticeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<{
    kind:
      | "delivered"
      | "already_delivered"
      | "unknown_outcome"
      | "cancelled"
      | "unavailable"
      | "waiting_content";
  }> {
    if (!uuid.test(noticeId)) return fail("residency_invalid_notice");
    if (!this.policy.noticeTransport || options.signal?.aborted)
      return { kind: "unavailable" };
    const claimed = await this.transaction(async (tx) => {
      const known = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from expert_residency_lifecycle_notices where id=${noticeId}::uuid`,
        )
      ).rows[0];
      if (!known) return { kind: "cancelled" as const };
      const chatId = await this.noticeTarget(tx, known.userId);
      const job = (
        await tx.execute<{
          status: string;
          attemptId: string | null;
          stage: string;
        }>(
          sql`select status,attempt_id as "attemptId",stage from expert_residency_lifecycle_notices where id=${noticeId}::uuid and user_id=${known.userId}::uuid for update`,
        )
      ).rows[0];
      if (!job) return { kind: "cancelled" as const };
      if (!chatId || !(await this.noticeCurrent(tx, noticeId))) {
        if (job.status !== "delivered")
          await tx.execute(
            sql`update expert_residency_lifecycle_notices set status='cancelled' where id=${noticeId}::uuid`,
          );
        return { kind: "cancelled" as const };
      }
      if (job.status === "delivered")
        return { kind: "already_delivered" as const };
      if (job.attemptId || job.status === "unknown_outcome")
        return { kind: "unknown_outcome" as const };
      if (job.status === "cancelled") return { kind: "cancelled" as const };
      const template = (
        await tx.execute<{ id: string; contentVersion: string; text: string }>(
          sql`select id,content_version as "contentVersion",text_body as text from expert_card_material_templates where content_version=${"lifecycle." + job.stage + ".v1"} and status='approved' and assets='[]'::jsonb for share`,
        )
      ).rows[0];
      if (!template) return { kind: "waiting_content" as const };
      const payload = { text: template.text, assets: [] };
      const payloadDigest = hash(JSON.stringify(payload));
      const attemptId = randomUUID();
      await tx.execute(
        sql`update expert_residency_lifecycle_notices set status='unknown_outcome',attempt_id=${attemptId}::uuid,attempted_at=clock_timestamp(),target_bot_id=${this.policy.workBotId},target_chat_id=${chatId},template_version=${template.contentVersion},payload_digest=${payloadDigest} where id=${noticeId}::uuid`,
      );
      return {
        kind: "claimed" as const,
        userId: known.userId,
        chatId,
        attemptId,
        templateId: template.id,
        contentVersion: template.contentVersion,
        payloadDigest,
        payload,
      };
    });
    if (claimed.kind !== "claimed") return claimed;
    try {
      return await this.transaction(async (tx) => {
        const chatId = await this.noticeTarget(tx, claimed.userId);
        const job = (
          await tx.execute<{ id: string }>(
            sql`select id from expert_residency_lifecycle_notices where id=${noticeId}::uuid and user_id=${claimed.userId}::uuid and attempt_id=${claimed.attemptId}::uuid and status='unknown_outcome' for update`,
          )
        ).rows[0];
        if (
          !job ||
          chatId !== claimed.chatId ||
          options.signal?.aborted ||
          !(await this.noticeCurrent(tx, noticeId))
        )
          return { kind: "unknown_outcome" as const };
        const template = (
          await tx.execute<{ text: string }>(
            sql`select text_body as text from expert_card_material_templates where id=${claimed.templateId}::uuid and content_version=${claimed.contentVersion} and status='approved' and assets='[]'::jsonb for share`,
          )
        ).rows[0];
        if (
          !template ||
          hash(JSON.stringify({ text: template.text, assets: [] })) !==
            claimed.payloadDigest
        )
          return { kind: "unknown_outcome" as const };
        // A future approved notice can become effective while a content lock
        // waits. Re-read original evidence and stage after every blocking gate.
        if (
          (await this.noticeTarget(tx, claimed.userId)) !== claimed.chatId ||
          !(await this.noticeCurrent(tx, noticeId))
        )
          return { kind: "unknown_outcome" as const };
        const signal = options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000);
        const receipt = validateResidencyNoticeReceipt(
          await this.policy.noticeTransport!.send({
            botId: this.policy.workBotId,
            botKey: this.policy.workBotKey,
            userId: claimed.userId,
            chatId: claimed.chatId,
            reviewId: noticeId,
            revision: 1,
            contentVersion: claimed.contentVersion,
            payloadDigest: claimed.payloadDigest,
            payload: claimed.payload,
            signal,
          }),
          {
            botId: this.policy.workBotId,
            chatId: claimed.chatId,
            contentVersion: claimed.contentVersion,
            payloadDigest: claimed.payloadDigest,
          },
        );
        await tx.execute(
          sql`update expert_residency_lifecycle_notices set status='delivered',receipt=${JSON.stringify(receipt)}::jsonb,delivered_at=clock_timestamp() where id=${noticeId}::uuid and attempt_id=${claimed.attemptId}::uuid`,
        );
        return { kind: "delivered" as const };
      }, 11000);
    } catch {
      return { kind: "unknown_outcome" };
    }
  }
}
