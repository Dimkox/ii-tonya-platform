import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  qualityNeedsReview,
  renderResidentWorkNotice,
  type ResidentLifecycleCase,
  type ResidentLifecycleCaseKind,
  type ResidentWorkNoticeKind,
  type ResidentWorkOutcome,
  type ResidentWorkTransport,
} from "@ii-tonya/contracts";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import { lockExpertManagerAuthority } from "./expert-manager-authority.js";
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const id =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = (text: string) =>
  "sha256:" + createHash("sha256").update(text).digest("hex");
const iso = (value: string | Date) => new Date(value).toISOString();
const fail = (code: string): never => {
  throw new Error(code);
};

/** Called within the original review/projection transaction and subject barrier. */
export async function enqueueResidentWorkNotice(
  tx: Tx,
  userId: string,
  kind: ResidentWorkNoticeKind,
  reviewId: string | null,
) {
  const d = (
    await tx.execute<{
      id: string;
      botId: string;
      botKey: string;
      chatId: string;
      policy: string;
      identityId: string;
    }>(sql`
    select d.id,d.work_bot_id as "botId",d.work_bot_key as "botKey",d.work_chat_id as "chatId",d.messaging_policy_version as policy,ci.id as "identityId"
    from expert_card_drafts d join channel_identities ci on ci.user_id=d.user_id and ci.bot_key=d.work_bot_key and ci.provider='telegram' and ci.status='active' and ci.external_id=d.work_chat_id and ci.external_chat_id=d.work_chat_id
    where d.user_id=${userId}::uuid for share of d,ci`)
  ).rows;
  if (d.length !== 1) return;
  const row = d[0]!;
  const consent = await captureClientConsentAuthority(tx, {
    subjectId: userId,
    botKey: row.botKey,
    chatId: row.chatId,
    externalUserId: row.chatId,
    messagingPolicyVersion: row.policy,
  });
  if (!consent) return;
  await tx.execute(
    sql`insert into resident_lifecycle_subjects(user_id) values(${userId}::uuid) on conflict do nothing`,
  );
  await tx.execute(
    sql`insert into resident_work_notices(user_id,draft_id,kind,review_id,target_bot_id,target_bot_key,target_chat_id,identity_id,consent_authority) values(${userId}::uuid,${row.id}::uuid,${kind},${reviewId}::uuid,${row.botId},${row.botKey},${row.chatId},${row.identityId}::uuid,${JSON.stringify(consent)}::jsonb) on conflict do nothing`,
  );
}

export async function recordResidentFirstActivation(
  tx: Tx,
  input: { userId: string; expertId: string; orderId: string },
) {
  await tx.execute(
    sql`insert into resident_lifecycle_subjects(user_id) values(${input.userId}::uuid) on conflict do nothing`,
  );
  const changed = (
    await tx.execute(
      sql`update resident_lifecycle_subjects set expert_id=${input.expertId}::uuid,activation_kind='first_projection',activation_order_id=${input.orderId}::uuid,activated_at=clock_timestamp() where user_id=${input.userId}::uuid and activation_kind is null returning user_id`,
    )
  ).rows.length;
  if (changed)
    await enqueueResidentWorkNotice(tx, input.userId, "first_activation", null);
}

/** First usable verified main checkout, never an unissued/unknown order deadline. */
export async function recordResidentMainInvoice(
  tx: Tx,
  userId: string,
  orderId: string,
) {
  await tx.execute(
    sql`insert into resident_lifecycle_subjects(user_id) values(${userId}::uuid) on conflict do nothing`,
  );
  await tx.execute(
    sql`update resident_lifecycle_subjects set first_main_invoice_order_id=${orderId}::uuid,first_main_invoice_at=clock_timestamp() where user_id=${userId}::uuid and first_main_invoice_at is null and activation_kind is null and not exists(select 1 from expert_residency_renewal_attempts where order_id=${orderId}::uuid)`,
  );
}

type Notice = {
  id: string;
  userId: string;
  draftId: string;
  kind: ResidentWorkNoticeKind;
  reviewId: string | null;
  state: string;
  targetBotId: string;
  targetBotKey: string;
  targetChatId: string;
  identityId: string;
  consent: unknown;
  attemptCount: number;
  lastAttemptId: string | null;
};
const noticeColumns = sql`n.id,n.user_id as "userId",n.draft_id as "draftId",n.kind,n.review_id as "reviewId",n.state,n.target_bot_id as "targetBotId",n.target_bot_key as "targetBotKey",n.target_chat_id as "targetChatId",n.identity_id as "identityId",n.consent_authority as consent,n.attempt_count as "attemptCount",n.last_attempt_id as "lastAttemptId"`;
const caseColumns = sql`id,user_id as "residentId",generation as "sourceId",application_id as "applicationId",kind,status,revision,created_at as "createdAt",due_at as "dueAt",window_start as "windowStart",window_end as "windowEnd",numerator,denominator,missing_provenance as "missingProvenance",resolution,resolved_at as "resolvedAt"`;
export class PostgresResidentLifecycleCompletionRepository {
  private accepting = true;
  private receipts = new Map<
    string,
    Extract<ResidentWorkOutcome, { kind: "applied" }>["receipt"]
  >();
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      workBotId: string;
      workBotKey: string;
      messagingConsentPolicyVersion: string;
      transport?: ResidentWorkTransport;
    },
  ) {
    if (
      !/^[1-9][0-9]{0,15}$/u.test(policy.workBotId) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(policy.workBotKey) ||
      !policy.messagingConsentPolicyVersion
    )
      fail("resident_lifecycle_configuration_invalid");
  }
  stopAccepting() {
    this.accepting = false;
  }
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='15000ms'`);
      await tx.execute(sql`set local lock_timeout='1500ms'`);
      return fn(tx);
    });
  }
  private async authority(tx: Tx, row: Notice): Promise<boolean> {
    if (
      row.targetBotId !== this.policy.workBotId ||
      row.targetBotKey !== this.policy.workBotKey
    )
      return false;
    const current =
      (
        await tx.execute(
          sql`select ci.id from channel_identities ci join users u on u.id=ci.user_id and u.active join expert_card_drafts d on d.id=${row.draftId}::uuid and d.user_id=u.id where ci.id=${row.identityId}::uuid and ci.user_id=${row.userId}::uuid and ci.status='active' and ci.provider='telegram' and ci.bot_key=${row.targetBotKey} and ci.external_id=${row.targetChatId} and ci.external_chat_id=${row.targetChatId} and d.work_bot_id=${row.targetBotId} and d.work_bot_key=${row.targetBotKey} and d.work_chat_id=${row.targetChatId} for share of ci,u,d`,
        )
      ).rows.length === 1;
    if (!current) return false;
    const consent = await captureClientConsentAuthority(tx, {
      subjectId: row.userId,
      botKey: row.targetBotKey,
      chatId: row.targetChatId,
      externalUserId: row.targetChatId,
      messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
    });
    return (
      !!consent &&
      (
        await tx.execute<{ valid: boolean }>(
          sql`select ${JSON.stringify(consent)}::jsonb=${JSON.stringify(row.consent)}::jsonb as valid`,
        )
      ).rows[0]?.valid === true
    );
  }
  private async content(
    tx: Tx,
    row: Notice,
  ): Promise<
    { kind: "current"; text: string } | { kind: "defer" } | { kind: "stale" }
  > {
    const state = (
      await tx.execute<{
        published: boolean;
        eligible: boolean;
        revision: number;
        status: string;
        reviewId: string | null;
      }>(
        sql`select exists(select 1 from experts_published where user_id=d.user_id) as published,exists(select 1 from experts_published p join experts e on e.id=p.expert_id and e.active and e.verified where p.user_id=d.user_id and p.active and exists(select 1 from expert_residency_current_coverage(p.expert_id) c where c.source_order_id=p.paid_order_id and c.ends_at=p.next_billing_date) and not exists(select 1 from expert_residency_lifecycle l where l.user_id=p.user_id and l.status='paused') and not exists(select 1 from expert_referral_abuse_holds h where h.expert_id=p.expert_id and h.status='open') and exists(select 1 from expert_onboarding_applications a where a.id=d.application_id and a.verification_status='approved' and a.archived_at is null)) as eligible,d.revision,d.status,d.approved_review_id as "reviewId" from expert_card_drafts d where d.id=${row.draftId}::uuid and d.user_id=${row.userId}::uuid for share of d`,
      )
    ).rows[0];
    if (!state) return { kind: "stale" };
    if (row.kind === "first_activation")
      return state.eligible
        ? {
            kind: "current",
            text: renderResidentWorkNotice(row.kind, null, true),
          }
        : { kind: "defer" };
    const review = (
      await tx.execute<{
        revision: number;
        action: string;
        reason: string | null;
      }>(
        sql`select revision,action,return_reason as reason from expert_card_reviews where id=${row.reviewId}::uuid and draft_id=${row.draftId}::uuid and user_id=${row.userId}::uuid for share`,
      )
    ).rows[0];
    if (
      !review ||
      review.revision !== state.revision ||
      (row.kind === "card_approved"
        ? state.reviewId !== row.reviewId || state.status !== "approved"
        : state.status !== "changes_requested" ||
          review.action !== "return_changes" ||
          (
            await tx.execute<{ id: string }>(
              sql`select id from expert_card_reviews where draft_id=${row.draftId}::uuid order by created_at desc,id desc limit 1`,
            )
          ).rows[0]?.id !== row.reviewId)
    )
      return { kind: "stale" };
    return {
      kind: "current",
      text: renderResidentWorkNotice(row.kind, review.reason, state.published),
    };
  }
  private async control(tx: Tx): Promise<boolean> {
    await tx.execute(
      sql`insert into resident_work_bot_state(bot_key) values(${this.policy.workBotKey}) on conflict do nothing`,
    );
    await tx.execute(
      sql`select bot_key from resident_work_bot_state where bot_key=${this.policy.workBotKey} for update`,
    );
    return (
      (
        await tx.execute<{ allowed: boolean }>(
          sql`select not paused and not_before<=clock_timestamp() as allowed from resident_work_bot_state where bot_key=${this.policy.workBotKey}`,
        )
      ).rows[0]?.allowed === true
    );
  }
  async deliverNotice(noticeId: string): Promise<string> {
    if (!id.test(noticeId)) return fail("resident_lifecycle_invalid");
    if (!this.accepting || !this.policy.transport) return "disabled";
    const claim = await this.tx(async (tx) => {
      const hint = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from resident_work_notices where id=${noticeId}::uuid`,
        )
      ).rows[0];
      if (!hint) return null;
      await lockClientConsentSubject(tx, hint.userId);
      const allowed = await this.control(tx);
      const n = (
        await tx.execute<Notice>(
          sql`select ${noticeColumns} from resident_work_notices n where n.id=${noticeId}::uuid and n.available_at<=clock_timestamp() for update`,
        )
      ).rows[0];
      if (!n || n.state !== "pending" || n.attemptCount >= 3) return null;
      if (!(await this.authority(tx, n))) {
        await tx.execute(
          sql`update resident_work_notices set state='cancelled' where id=${noticeId}::uuid`,
        );
        return null;
      }
      const content = await this.content(tx, n);
      if (content.kind === "stale") {
        await tx.execute(
          sql`update resident_work_notices set state='cancelled' where id=${noticeId}::uuid`,
        );
        return null;
      }
      if (!allowed || content.kind === "defer" || !this.accepting) {
        await tx.execute(
          sql`update resident_work_notices set available_at=clock_timestamp()+interval '1 minute' where id=${noticeId}::uuid`,
        );
        return null;
      }
      const attemptId = randomUUID(),
        payloadDigest = digest(content.text);
      await tx.execute(
        sql`insert into resident_work_notice_attempts(id,notice_id,sequence,payload_digest) values(${attemptId}::uuid,${noticeId}::uuid,${n.attemptCount + 1},${payloadDigest})`,
      );
      await tx.execute(
        sql`update resident_work_notices set state='unknown',attempt_count=attempt_count+1,last_attempt_id=${attemptId}::uuid where id=${noticeId}::uuid`,
      );
      return { n, attemptId, payloadDigest, text: content.text };
    });
    if (!claim) return "deferred_or_terminal";
    try {
      const result = await this.tx(async (tx) => {
        await lockClientConsentSubject(tx, claim.n.userId);
        const allowed = await this.control(tx);
        const n = (
          await tx.execute<Notice>(
            sql`select ${noticeColumns} from resident_work_notices n where n.id=${noticeId}::uuid and n.last_attempt_id=${claim.attemptId}::uuid and n.state='unknown' for update`,
          )
        ).rows[0];
        if (!n) return "cancelled";
        const authority = await this.authority(tx, n),
          content = await this.content(tx, n);
        if (!authority || content.kind === "stale") {
          await tx.execute(
            sql`update resident_work_notice_attempts set state='cancelled' where id=${claim.attemptId}::uuid and state='unknown'`,
          );
          await tx.execute(
            sql`update resident_work_notices set state='cancelled' where id=${noticeId}::uuid`,
          );
          return "cancelled";
        }
        if (!allowed || !this.accepting || content.kind === "defer") {
          // Proven no wire call occurred: discard this unsent claim without spending a wire budget.
          await tx.execute(
            sql`delete from resident_work_notice_attempts where id=${claim.attemptId}::uuid and state='unknown'`,
          );
          const previous = (
            await tx.execute<{ id: string }>(
              sql`select id from resident_work_notice_attempts where notice_id=${noticeId}::uuid order by sequence desc limit 1`,
            )
          ).rows[0];
          await tx.execute(
            sql`update resident_work_notices set state='pending',attempt_count=attempt_count-1,last_attempt_id=${previous?.id ?? null}::uuid,available_at=clock_timestamp()+interval '1 minute' where id=${noticeId}::uuid`,
          );
          return "deferred";
        }
        if (digest(content.text) !== claim.payloadDigest) return "unknown";
        const deadline = (
          await tx.execute<{ deadline: string | Date }>(
            sql`select clock_timestamp()+interval '8 seconds' as deadline`,
          )
        ).rows[0]!.deadline;
        let outcome: ResidentWorkOutcome;
        try {
          outcome = await this.policy.transport!.send({
            botKey: n.targetBotKey,
            chatId: n.targetChatId,
            text: content.text,
            deadline: iso(deadline),
          });
        } catch {
          outcome = { kind: "unknown", reasonCode: "delivery_uncertain" };
        }
        if (
          outcome.kind === "applied" &&
          outcome.receipt.botKey === n.targetBotKey &&
          outcome.receipt.chatId === n.targetChatId &&
          Number.isSafeInteger(outcome.receipt.messageId) &&
          outcome.receipt.messageId > 0
        ) {
          this.receipts.set(claim.attemptId, outcome.receipt);
          await tx.execute(
            sql`update resident_work_notice_attempts set state='delivered',receipt=${JSON.stringify(outcome.receipt)}::jsonb where id=${claim.attemptId}::uuid and state='unknown'`,
          );
          await tx.execute(
            sql`update resident_work_notices set state='delivered' where id=${noticeId}::uuid`,
          );
          return "delivered";
        }
        if (outcome.kind === "not_applied") {
          const seconds = Math.min(
            86400,
            Math.max(1, outcome.retryAfterSeconds ?? 60),
          );
          await tx.execute(
            sql`update resident_work_notice_attempts set state='not_applied' where id=${claim.attemptId}::uuid`,
          );
          await tx.execute(
            sql`update resident_work_bot_state set not_before=greatest(not_before,clock_timestamp()+${seconds}*interval '1 second') where bot_key=${this.policy.workBotKey}`,
          );
          await tx.execute(
            sql`update resident_work_notices set state=${n.attemptCount >= 3 ? "cancelled" : "pending"},available_at=clock_timestamp()+${seconds}*interval '1 second' where id=${noticeId}::uuid`,
          );
          return "deferred";
        }
        if ("pauseBot" in outcome && outcome.pauseBot)
          await tx.execute(
            sql`update resident_work_bot_state set paused=true where bot_key=${this.policy.workBotKey}`,
          );
        if (outcome.kind === "failed") {
          await tx.execute(
            sql`update resident_work_notice_attempts set state='cancelled' where id=${claim.attemptId}::uuid`,
          );
          await tx.execute(
            sql`update resident_work_notices set state='cancelled' where id=${noticeId}::uuid`,
          );
          return "cancelled";
        }
        return "unknown";
      });
      if (result === "delivered") this.receipts.delete(claim.attemptId);
      return result;
    } catch {
      return "unknown";
    }
  }
  /** Only validated receipts captured by this process can repair a lost DB acknowledgement. */
  async recoverReceipts(): Promise<void> {
    for (const [attemptId, receipt] of this.receipts) {
      const done = await this.tx(async (tx) => {
        const hint = (
          await tx.execute<{ userId: string }>(
            sql`select n.user_id as "userId" from resident_work_notices n join resident_work_notice_attempts a on a.notice_id=n.id where a.id=${attemptId}::uuid`,
          )
        ).rows[0];
        if (!hint) return true;
        await lockClientConsentSubject(tx, hint.userId);
        const n = (
          await tx.execute<Notice>(
            sql`select ${noticeColumns} from resident_work_notices n where n.last_attempt_id=${attemptId}::uuid for update`,
          )
        ).rows[0];
        if (!n || n.state === "cancelled" || n.state === "delivered")
          return true;
        if (!(await this.authority(tx, n))) return true;
        if (
          n.targetBotKey !== receipt.botKey ||
          n.targetChatId !== receipt.chatId
        )
          return false;
        await tx.execute(
          sql`update resident_work_notice_attempts set state='delivered',receipt=${JSON.stringify(receipt)}::jsonb where id=${attemptId}::uuid and state='unknown'`,
        );
        await tx.execute(
          sql`update resident_work_notices set state='delivered' where id=${n.id}::uuid and state='unknown'`,
        );
        return true;
      });
      if (done) this.receipts.delete(attemptId);
    }
  }
  async deliverBatch(limit = 5): Promise<number> {
    await this.recoverReceipts();
    if (!this.accepting || !this.policy.transport) return 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      return fail("resident_lifecycle_invalid");
    const rows = (
      await this.db.execute<{ id: string }>(
        sql`select id from resident_work_notices where target_bot_key=${this.policy.workBotKey} and state='pending' and attempt_count<3 and available_at<=clock_timestamp() order by available_at,id limit ${limit}`,
      )
    ).rows;
    let delivered = 0;
    for (const row of rows) {
      if (!this.accepting) break;
      if ((await this.deliverNotice(row.id)) === "delivered") delivered++;
    }
    return delivered;
  }
  async processBatch(limit = 20): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      return fail("resident_lifecycle_invalid");
    const candidates = (
      await this.db.execute<{ userId: string }>(
        sql`select s.user_id as "userId" from resident_lifecycle_subjects s join users u on u.id=s.user_id and u.active where s.last_scanned_at<clock_timestamp()-interval '15 minutes' order by s.last_scanned_at,s.user_id limit ${limit}`,
      )
    ).rows;
    let examined = 0;
    for (const row of candidates) {
      if (!this.accepting) break;
      await this.tx(async (tx) => {
        await lockClientConsentSubject(tx, row.userId);
        const s = (
          await tx.execute<{ expertId: string | null; activated: boolean }>(
            sql`select expert_id as "expertId",activation_kind is not null as activated from resident_lifecycle_subjects where user_id=${row.userId}::uuid and last_scanned_at<clock_timestamp()-interval '15 minutes' for update`,
          )
        ).rows[0];
        if (!s) return;
        await tx.execute(
          sql`update resident_lifecycle_subjects set last_scanned_at=clock_timestamp() where user_id=${row.userId}::uuid`,
        );
        await this.acquisition(tx, row.userId, s.activated);
        if (s.expertId) await this.quality(tx, row.userId, s.expertId);
        await tx.execute(
          sql`insert into resident_lifecycle_cases(user_id,kind,generation) select n.user_id,'notice_unknown',n.id::text from resident_work_notices n where n.user_id=${row.userId}::uuid and n.state='unknown' and exists(select 1 from resident_work_notice_attempts a where a.id=n.last_attempt_id and a.created_at<clock_timestamp()-interval '1 minute') on conflict do nothing`,
        );
        await tx.execute(
          sql`update resident_lifecycle_cases c set status='resolved',revision=revision+1,resolution='source_resolved',resolved_at=clock_timestamp() where c.user_id=${row.userId}::uuid and c.kind='notice_unknown' and c.status='open' and not exists(select 1 from resident_work_notices n where n.id::text=c.generation and n.state='unknown')`,
        );
        examined++;
      });
    }
    return examined;
  }
  private async acquisition(tx: Tx, userId: string, activated: boolean) {
    const d = (
      await tx.execute<{
        draftId: string;
        applicationId: string;
        reviewId: string;
        initialReviewId: string;
        approvedAt: string | Date;
        deliveredAt: string | Date | null;
        promo: boolean;
        approvalDue: boolean;
        promotionDue: boolean;
      }>(sql`select d.id as "draftId",d.application_id as "applicationId",r.id as "reviewId",first_review.id as "initialReviewId",first_review.created_at as "approvedAt",j.delivered_at as "deliveredAt",(exists(select 1 from expert_card_promo_confirmations p where p.review_id=r.id and p.proof_digest=expert_card_proof_digest(d.id,r.id)) or exists(select 1 from expert_application_promo_confirmations p where p.application_id=d.application_id and p.user_id=d.user_id and p.proof_digest=(select 'sha256:'||encode(digest(coalesce(string_agg(id::text||':'||kind||':'||reference,E'\n' order by created_at,id),''),'sha256'),'hex') from expert_application_promo_proofs where application_id=d.application_id and user_id=d.user_id))) as promo,first_review.created_at<clock_timestamp()-interval '7 days' as "approvalDue",j.delivered_at<clock_timestamp()-interval '7 days' as "promotionDue" from expert_card_drafts d join expert_onboarding_applications a on a.id=d.application_id and a.verification_status='approved' and a.archived_at is null join expert_card_reviews r on r.id=d.approved_review_id and r.revision=d.revision join lateral(select id,created_at from expert_card_reviews where draft_id=d.id and action='approve' order by created_at,id limit 1) first_review on true left join lateral(
       select delivered_at from (
        select j.delivered_at from expert_card_material_jobs j join expert_card_material_templates t on t.id=j.template_id and t.content_version=j.content_version and t.status='approved' where j.review_id=r.id and j.user_id=d.user_id and j.revision=d.revision and j.status='delivered' and j.delivery_receipt is not null and j.target_bot_id=d.work_bot_id and j.target_chat_id=d.work_chat_id
        union all select j.delivered_at from expert_application_material_jobs j join expert_card_material_templates t on t.id=j.template_id and t.content_version=j.content_version and t.status='approved' where j.application_id=d.application_id and j.user_id=d.user_id and j.status='delivered' and j.delivery_receipt is not null and j.target_bot_id=d.work_bot_id and j.target_chat_id=d.work_chat_id
       ) usable order by delivered_at desc limit 1) j on true where d.user_id=${userId}::uuid and d.status='approved' for share of d,a,r`)
    ).rows[0];
    const wanted: {
      kind: ResidentLifecycleCaseKind;
      generation: string;
      due: string | Date;
    }[] = [];
    if (!activated && d) {
      if (!d.promo) {
        if (!d.deliveredAt && d.approvalDue)
          wanted.push({
            kind: "materials_missing",
            generation: d.initialReviewId,
            due: new Date(new Date(d.approvedAt).getTime() + 7 * 86400000),
          });
        if (d.deliveredAt && d.promotionDue)
          wanted.push({
            kind: "promotion_overdue",
            generation: d.reviewId,
            due: new Date(new Date(d.deliveredAt).getTime() + 7 * 86400000),
          });
      } else {
        const order = (
          await tx.execute<{
            firstId: string;
            firstAt: string | Date;
            due: boolean;
            unknown: boolean;
            settled: boolean;
          }>(
            sql`with initial as (select coalesce(s.first_main_invoice_order_id,m.order_id) order_id,coalesce(s.first_main_invoice_at,m.created_at) created_at,s.first_main_invoice_at is null as unissued from resident_lifecycle_subjects s join lateral(select order_id,created_at from expert_card_main_orders m where m.user_id=s.user_id and m.application_id=${d.applicationId}::uuid and not exists(select 1 from expert_residency_renewal_attempts x where x.order_id=m.order_id) order by m.created_at,m.order_id limit 1)m on true where s.user_id=${userId}::uuid) select initial.order_id as "firstId",initial.created_at as "firstAt",initial.created_at<clock_timestamp()-interval '3 days' as due,(initial.unissued or not exists(select 1 from expert_personal_offer_state st join expert_residency_orders o on o.id=st.order_id where st.user_id=${userId}::uuid and st.payment_url is not null and o.status='payment_pending' and o.payment_deadline>clock_timestamp()) or exists(select 1 from expert_residency_provider_operations op join expert_card_main_orders m on m.order_id=op.order_id where m.user_id=${userId}::uuid and op.operation_kind='create_payment' and op.status in('claimed','unknown_outcome'))) as unknown,exists(select 1 from expert_card_main_orders m join expert_residency_orders o on o.id=m.order_id where m.user_id=${userId}::uuid and o.status='settled') as settled from initial`,
          )
        ).rows[0];
        if (order?.due && !order.settled)
          wanted.push({
            kind: order.unknown
              ? "payment_reconciliation"
              : "main_payment_overdue",
            generation: order.firstId,
            due: new Date(new Date(order.firstAt).getTime() + 3 * 86400000),
          });
      }
    }
    for (const item of wanted)
      await tx.execute(
        sql`insert into resident_lifecycle_cases(user_id,application_id,kind,generation,due_at) values(${userId}::uuid,${d!.applicationId}::uuid,${item.kind},${item.generation},${iso(item.due)}::timestamptz) on conflict do nothing`,
      );
    const keys = wanted.map((x) => x.kind + ":" + x.generation);
    await tx.execute(
      sql`update resident_lifecycle_cases set status='resolved',revision=revision+1,resolution='source_resolved',resolved_at=clock_timestamp() where user_id=${userId}::uuid and status='open' and kind in('materials_missing','promotion_overdue','main_payment_overdue','payment_reconciliation') and not ((kind||':'||generation)=any(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))))`,
    );
  }
  private async quality(tx: Tx, userId: string, expertId: string) {
    const clock = (
      await tx.execute<{ now: string | Date; day: string }>(
        sql`with instant as materialized(select clock_timestamp() as now) select now,(now at time zone 'UTC')::date::text as day from instant`,
      )
    ).rows[0]!;
    if (
      (
        await tx.execute(
          sql`select 1 from resident_lifecycle_cases where user_id=${userId}::uuid and kind='quality_window' and generation=${clock.day}`,
        )
      ).rows.length
    )
      return;
    const counts = (
      await tx.execute<{
        numerator: number;
        denominator: number;
        missing: number;
      }>(sql`
      with cohort as (select r.*,
       (exists(select 1 from audit_events a where a.object_type='reservation' and a.object_id=r.id and a.actor_type='client' and a.actor_id=r.user_id and a.action='reservation.reserve' and a.decision='reserved' and a.reason_code='slot_selected') or exists(select 1 from booking_waitlist_entries w join booking_waitlist_command_receipts j on j.waitlist_entry_id=w.id and j.command_type='join' and j.actor_user_id=w.user_id and j.idempotency_key=w.join_idempotency_key join client_booking_receipts b on b.reservation_id=r.id and b.user_id=w.user_id and b.choice_digest=w.choice_digest where w.promoted_reservation_id=r.id and w.user_id=r.user_id and w.slot_id=r.slot_id and j.request_hash='sha256:'||encode(digest(convert_to(w.user_id::text,'UTF8')||decode('00','hex')||convert_to(w.choice_digest::text,'UTF8'),'sha256'),'hex'))) as submitted,
       exists(select 1 from audit_events a where a.object_type='reservation' and a.object_id=r.id and a.actor_type='expert' and a.actor_id=r.expert_id and a.action='reservation.expert_cancel' and a.decision='cancelled_by_expert' and a.reason_code='expert_cancel') as human_decline
       from reservations r where r.expert_id=${expertId}::uuid and r.created_at>=${iso(clock.now)}::timestamptz-interval '30 days' and r.created_at<${iso(clock.now)}::timestamptz and r.status in('booked','completed','no_show','cancelled_by_client','cancelled_by_expert'))
      select count(*) filter(where submitted and status='cancelled_by_expert' and human_decline)::integer as numerator,count(*) filter(where submitted)::integer as denominator,count(*) filter(where not submitted)::integer as missing from cohort`)
    ).rows[0]!;
    const alert = qualityNeedsReview(counts.numerator, counts.denominator);
    await tx.execute(
      sql`insert into resident_lifecycle_cases(user_id,kind,generation,status,window_start,window_end,numerator,denominator,missing_provenance) values(${userId}::uuid,'quality_window',${clock.day},${alert ? "open" : "no_action"},${iso(clock.now)}::timestamptz-interval '30 days',${iso(clock.now)}::timestamptz,${counts.numerator},${counts.denominator},${counts.missing}) on conflict do nothing`,
    );
  }
  private decodeCase(row: ResidentLifecycleCase): ResidentLifecycleCase {
    return {
      ...row,
      createdAt: iso(row.createdAt),
      dueAt: row.dueAt ? iso(row.dueAt) : null,
      windowStart: row.windowStart ? iso(row.windowStart) : null,
      windowEnd: row.windowEnd ? iso(row.windowEnd) : null,
      resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : null,
    };
  }
  async listCases(sessionHash: string): Promise<ResidentLifecycleCase[]> {
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const rows = (
        await tx.execute<ResidentLifecycleCase & Record<string, unknown>>(
          sql`select ${caseColumns} from resident_lifecycle_cases where status='open' order by created_at,id limit 50`,
        )
      ).rows;
      await lockExpertManagerAuthority(tx, sessionHash);
      return rows.map((row) => this.decodeCase(row));
    });
  }
  async readCase(
    sessionHash: string,
    caseId: string,
  ): Promise<ResidentLifecycleCase | null> {
    if (!id.test(caseId)) return fail("resident_lifecycle_invalid");
    return this.tx(async (tx) => {
      await lockExpertManagerAuthority(tx, sessionHash);
      const row = (
        await tx.execute<ResidentLifecycleCase & Record<string, unknown>>(
          sql`select ${caseColumns} from resident_lifecycle_cases where id=${caseId}::uuid`,
        )
      ).rows[0];
      await lockExpertManagerAuthority(tx, sessionHash);
      return row ? this.decodeCase(row) : null;
    });
  }
  async closeCase(input: {
    sessionHash: string;
    id: string;
    expectedRevision: number;
    idempotencyKey: string;
    resolution: string;
  }): Promise<{ replay: boolean }> {
    if (
      !id.test(input.id) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey) ||
      typeof input.resolution !== "string" ||
      !input.resolution.trim() ||
      input.resolution.length > 2000 ||
      !input.resolution.isWellFormed()
    )
      return fail("resident_lifecycle_invalid");
    return this.tx(async (tx) => {
      const manager = await lockExpertManagerAuthority(tx, input.sessionHash);
      const hint = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from resident_lifecycle_cases where id=${input.id}::uuid`,
        )
      ).rows[0];
      if (!hint) return fail("resident_lifecycle_not_found");
      await lockClientConsentSubject(tx, hint.userId);
      const row = (
        await tx.execute<{
          status: string;
          revision: number;
          key: string | null;
          manager: string | null;
          resolution: string | null;
        }>(
          sql`select status,revision,command_key as key,manager_id as manager,resolution from resident_lifecycle_cases where id=${input.id}::uuid for update`,
        )
      ).rows[0];
      await lockExpertManagerAuthority(tx, input.sessionHash);
      if (!row) return fail("resident_lifecycle_not_found");
      if (
        row.key === input.idempotencyKey &&
        row.manager === manager &&
        row.resolution === input.resolution &&
        row.revision === input.expectedRevision + 1
      )
        return { replay: true };
      if (row.status !== "open" || row.revision !== input.expectedRevision)
        return fail("resident_lifecycle_conflict");
      await tx.execute(
        sql`update resident_lifecycle_cases set status='resolved',revision=revision+1,resolution=${input.resolution},manager_id=${manager}::uuid,command_key=${input.idempotencyKey},resolved_at=clock_timestamp() where id=${input.id}::uuid`,
      );
      return { replay: false };
    });
  }
}
