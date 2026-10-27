import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  renderResidentReviewMessage,
  type ResidentMessageInput,
  type ResidentDraft,
  type ResidentReviewAction,
} from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import {
  lockExpertManagerAuthority,
  type ExpertManagerTransaction as Tx,
} from "./expert-manager-authority.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import { PostgresExpertVerificationRepository } from "./expert-verification-repository.js";
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const uuid = /^[0-9a-f-]{36}$/u;
interface Source extends Record<string, unknown> {
  id: string;
  userId: string;
  revision: number;
  generation: number;
  submittedRevision: number;
  draft: ResidentDraft;
  botId: string;
  botKey: string;
  chatId: string;
  status: string;
  activeRequestId: string | null;
  now: string;
  deadline: string;
  reapplyAt: string;
}
export interface ResidentReviewPreviewInput extends ResidentMessageInput {
  applicationId: string;
  expectedRevision: number;
  expectedGeneration: number;
}
export interface ResidentReviewTransport {
  send(input: {
    botId: string;
    botKey: string;
    chatId: string;
    text: string;
    signal: AbortSignal;
  }): Promise<{ botId: string; chatId: string; messageId: string }>;
}
export class PostgresResidentReviewRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      messagingConsentPolicyVersion: string;
      providerMode: "test" | "live";
      notifier?: ResidentReviewTransport;
    },
  ) {}
  private async tx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='10000ms'`);
      await tx.execute(sql`set local lock_timeout='2000ms'`);
      return work(tx);
    });
  }
  private async source(
    tx: Tx,
    applicationId: string,
    historicalRecovery = false,
  ): Promise<Source> {
    if (!uuid.test(applicationId)) throw Error("resident_review_invalid");
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from expert_sales_form_bridges where application_id=${applicationId}::uuid`,
      )
    ).rows[0];
    if (!initial) throw Error("resident_review_unavailable");
    await lockClientConsentSubject(tx, initial.userId);
    const f = (
      await tx.execute<Source>(
        sql`select f.id,f.user_id as "userId",f.revision,f.check_generation as generation,f.submitted_revision as "submittedRevision",f.submitted_draft as draft,f.bot_id as "botId",f.bot_key as "botKey",f.chat_id as "chatId",f.status,f.active_request_id as "activeRequestId",clock_timestamp()::text as now,(clock_timestamp()+interval '48 hours')::text as deadline,(clock_timestamp()+interval '1 month')::text as "reapplyAt" from residents_applications f join expert_sales_form_bridges b on b.form_id=f.id join users u on u.id=f.user_id and u.active where b.application_id=${applicationId}::uuid and (${historicalRecovery} or f.is_current) and f.form_version=2 and f.submitted_at is not null for update of f`,
      )
    ).rows[0];
    if (
      !f ||
      !(await captureClientConsentAuthority(tx, {
        subjectId: f.userId,
        botKey: f.botKey,
        chatId: f.chatId,
        externalUserId: f.chatId,
        messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
      }))
    )
      throw Error("resident_review_unavailable");
    return f;
  }
  async preview(sessionHash: string, raw: ResidentReviewPreviewInput) {
    const input = structuredClone(raw);
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash),
        f = await this.source(tx, input.applicationId);
      if (
        f.status !== "UNDER_REVIEW" ||
        f.revision !== input.expectedRevision ||
        f.generation !== input.expectedGeneration
      )
        throw Error("resident_preview_stale");
      if (
        input.name !== undefined ||
        input.deadline !== undefined ||
        input.reapplyAt !== undefined
      )
        throw Error("resident_message_facts_server_owned");
      const name = null; // Intake has no applicant-name field; use a neutral greeting.
      const variables = {
        key: input.key,
        name: name ?? null,
        ...(input.questions ? { questions: input.questions } : {}),
        ...(input.tone ? { tone: input.tone } : {}),
      };
      const rendered = renderResidentReviewMessage({
        ...variables,
        ...(input.editedText === undefined
          ? {}
          : { editedText: input.editedText }),
      });
      if (
        input.key === "REJECT_INSUFFICIENT_PROOF" &&
        !(
          await tx.execute(
            sql`select 1 from resident_information_requests r join resident_check_generations g on g.request_id=r.id and g.generation=${f.generation} where r.application_id=${f.id}::uuid and r.status in('completed','timeout')`,
          )
        ).rows.length
      )
        throw Error("resident_information_first");
      await lockExpertManagerAuthority(tx, sessionHash);
      const p = (
        await tx.execute<{ id: string; expiresAt: string }>(
          sql`insert into resident_review_previews(application_id,user_id,manager_id,session_hash,revision,generation,template_key,template_version,action,reason_code,questions,final_text,final_hash,variables) values(${f.id}::uuid,${f.userId}::uuid,${managerId}::uuid,${sessionHash},${f.revision},${f.generation},${input.key},1,${rendered.action},${input.key},${JSON.stringify(input.questions ?? [])}::jsonb,${rendered.text},${hash(rendered.text)},${JSON.stringify(variables)}::jsonb) returning id,expires_at::text as "expiresAt"`,
        )
      ).rows[0]!;
      return {
        previewId: p.id,
        text: rendered.text,
        hash: hash(rendered.text),
        expiresAt: p.expiresAt,
        action: rendered.action,
        revision: f.revision,
        generation: f.generation,
      };
    });
  }
  async confirm(
    sessionHash: string,
    applicationId: string,
    previewId: string,
    finalHash: string,
  ) {
    if (!uuid.test(previewId) || !/^[0-9a-f]{64}$/u.test(finalHash))
      throw Error("resident_review_invalid");
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash),
        f = await this.source(tx, applicationId);
      const prior = (
        await tx.execute<{
          id: string;
          action: ResidentReviewAction;
          finalHash: string;
        }>(
          sql`select id,action,final_hash as "finalHash" from resident_review_events where preview_id=${previewId}::uuid and manager_id=${managerId}::uuid and session_hash=${sessionHash} and attempt_id=${f.id}::uuid`,
        )
      ).rows[0];
      if (prior) {
        if (prior.finalHash !== finalHash)
          throw Error("resident_preview_stale");
        return { eventId: prior.id, action: prior.action, replay: true };
      }
      const p = (
        await tx.execute<{
          action: ResidentReviewAction;
          templateKey: string;
          text: string;
          hash: string;
        }>(
          sql`select action,template_key as "templateKey",final_text as text,final_hash as hash from resident_review_previews where id=${previewId}::uuid and application_id=${f.id}::uuid and manager_id=${managerId}::uuid and session_hash=${sessionHash} and revision=${f.revision} and generation=${f.generation} and expires_at>clock_timestamp() for update`,
        )
      ).rows[0];
      if (!p || p.hash !== finalHash || f.status !== "UNDER_REVIEW")
        throw Error("resident_preview_stale");
      await lockExpertManagerAuthority(tx, sessionHash);
      const e = (
        await tx.execute<{ id: string; deadline: string | null }>(
          sql`insert into resident_review_events(attempt_id,preview_id,manager_id,session_hash,source_revision,source_generation,submitted_revision,submitted_digest,action,reason_code,template_key,template_version,final_hash) values(${f.id}::uuid,${previewId}::uuid,${managerId}::uuid,${sessionHash},${f.revision},${f.generation},${f.submittedRevision},'',${p.action},${p.templateKey},${p.templateKey},1,${p.hash}) returning id,deadline::text`,
        )
      ).rows[0]!;
      if (p.action === "INFO_REQUESTED") {
        await tx.execute(
          sql`update resident_information_requests set status='superseded' where application_id=${f.id}::uuid and status='open'`,
        );
        await tx.execute(
          sql`insert into resident_information_requests(id,application_id,user_id,questions,deadline) select ${e.id}::uuid,application_id,user_id,questions,${e.deadline}::timestamptz from resident_review_previews where id=${previewId}::uuid`,
        );
      }
      await tx.execute(
        sql`update resident_review_messages set status='cancelled' where application_id=${f.id}::uuid and status='pending'`,
      );
      await tx.execute(
        sql`update residents_applications set status=${p.action.startsWith("REJECT_") ? "REJECTED" : p.action},progress=${p.action === "INFO_REQUESTED" ? "MANAGER_REVIEW" : "DONE"},active_request_id=${p.action === "INFO_REQUESTED" ? e.id : null}::uuid,revision=revision+1 where id=${f.id}::uuid`,
      );
      if (p.action !== "INFO_REQUESTED")
        await new PostgresExpertVerificationRepository(
          this.db,
          this.policy,
        ).decide(
          {
            sessionHash,
            applicationId,
            decision: p.action.startsWith("APPROVED") ? "approved" : "rejected",
            reasonCode: p.templateKey.toLowerCase(),
            idempotencyKey: `resident-preview:${previewId}`,
          },
          tx,
        );
      await tx.execute(
        sql`insert into resident_review_messages(event_id,application_id,user_id,consent_version,final_text,final_hash) values(${e.id}::uuid,${f.id}::uuid,${f.userId}::uuid,${this.policy.messagingConsentPolicyVersion},${p.text},${p.hash})`,
      );
      return { eventId: e.id, action: p.action, replay: false };
    });
  }
  async closeUnknown(
    sessionHash: string,
    applicationId: string,
    eventId: string,
  ) {
    if (!uuid.test(eventId)) throw Error("resident_review_invalid");
    return this.tx(async (tx) => {
      const managerId = await lockExpertManagerAuthority(tx, sessionHash),
        f = await this.source(tx, applicationId, true);
      const m = (
        await tx.execute(
          sql`select 1 from resident_review_messages where event_id=${eventId}::uuid and application_id=${f.id}::uuid and status in('dispatched','unknown') for update`,
        )
      ).rows[0];
      if (!m) throw Error("resident_recovery_unavailable");
      await lockExpertManagerAuthority(tx, sessionHash);
      await tx.execute(
        sql`insert into resident_review_recoveries(event_id,manager_id,session_hash) values(${eventId}::uuid,${managerId}::uuid,${sessionHash})`,
      );
      await tx.execute(
        sql`update resident_review_messages set status='cancelled',completed_at=clock_timestamp() where event_id=${eventId}::uuid`,
      );
      return { eventId, status: "closed_without_resend" as const };
    });
  }
  async expireRequests(limit = 20, sessionHash?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw Error("resident_batch_invalid");
    if (sessionHash !== undefined)
      await this.tx((tx) => lockExpertManagerAuthority(tx, sessionHash));
    // Exclude ineligible owners before LIMIT so they cannot starve valid due work.
    const due = (
      await this.db.execute<{ id: string; userId: string; formId: string }>(
        sql`select r.id,r.user_id as "userId",r.application_id as "formId" from resident_information_requests r join residents_applications f on f.id=r.application_id and f.is_current and f.active_request_id=r.id and f.status='INFO_REQUESTED' join users u on u.id=f.user_id and u.active join channel_identities ci on ci.id=f.channel_identity_id and ci.user_id=f.user_id and ci.provider='telegram' and ci.status='active' and ci.bot_key=f.bot_key and ci.external_id=f.telegram_user_id and ci.external_chat_id=f.chat_id where r.status='open' and r.deadline<=clock_timestamp() order by r.deadline,r.id limit ${limit}`,
      )
    ).rows;
    let count = 0;
    for (const r of due) {
      // A separate transaction is a subject boundary; revalidate under identity locks.
      count += await this.tx(async (tx) => {
        await lockClientConsentSubject(tx, r.userId);
        if (sessionHash !== undefined)
          await lockExpertManagerAuthority(tx, sessionHash);
        const current = (
          await tx.execute(
            sql`select r.id from resident_information_requests r join residents_applications f on f.id=r.application_id and f.is_current and f.active_request_id=r.id and f.status='INFO_REQUESTED' join users u on u.id=f.user_id and u.active join channel_identities ci on ci.id=f.channel_identity_id and ci.user_id=f.user_id and ci.provider='telegram' and ci.status='active' and ci.bot_key=f.bot_key and ci.external_id=f.telegram_user_id and ci.external_chat_id=f.chat_id where r.id=${r.id}::uuid and r.status='open' and r.deadline<=clock_timestamp() for update of r,f for share of ci,u`,
          )
        ).rows[0];
        if (!current) return 0;
        await tx.execute(
          sql`update resident_information_requests set status='timeout',completed_at=clock_timestamp() where id=${r.id}::uuid`,
        );
        await tx.execute(
          sql`insert into resident_check_generations(application_id,generation,submitted_revision,supplement_revision,request_id,status) select id,check_generation+1,submitted_revision,revision+1,active_request_id,'manual_review' from residents_applications where id=${r.formId}::uuid`,
        );
        await tx.execute(
          sql`update residents_applications set status='UNDER_REVIEW',progress='MANAGER_REVIEW',active_request_id=null,check_generation=check_generation+1,revision=revision+1 where id=${r.formId}::uuid`,
        );
        await tx.execute(
          sql`update resident_review_messages set status='cancelled' where event_id=${r.id}::uuid and status='pending'`,
        );
        return 1;
      });
    }
    return count;
  }
  async listDueMaterialJobs(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw Error("resident_batch_invalid");
    await this.expireRequests(limit);
    return (
      await this.db.execute<{ jobId: string }>(
        sql`select event_id as "jobId" from resident_review_messages where status='pending' and attempts<3 order by created_at,event_id limit ${limit}`,
      )
    ).rows;
  }
  private async deliverySource(tx: Tx, id: string) {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from resident_review_messages where event_id=${id}::uuid`,
      )
    ).rows[0];
    if (!initial) return null;
    await lockClientConsentSubject(tx, initial.userId);
    const row = (
      await tx.execute<{
        userId: string;
        botId: string;
        botKey: string;
        chatId: string;
        text: string;
        status: string;
        consentVersion: string;
      }>(
        sql`select m.user_id as "userId",f.bot_id as "botId",f.bot_key as "botKey",f.chat_id as "chatId",m.final_text as text,m.status,m.consent_version as "consentVersion" from resident_review_messages m join residents_applications f on f.id=m.application_id and f.user_id=m.user_id and f.is_current join resident_review_events e on e.id=m.event_id and e.attempt_id=f.id join users u on u.id=f.user_id and u.active where m.event_id=${id}::uuid and m.final_hash=e.final_hash and ((e.action='INFO_REQUESTED' and f.active_request_id=e.id and f.status='INFO_REQUESTED' and e.deadline>clock_timestamp() and exists(select 1 from resident_information_requests r where r.id=e.id and r.status='open')) or (e.action in('REJECT_SOFT','REJECT_HARD') and f.status='REJECTED') or (e.action in('APPROVED_BASIC','APPROVED_EXCLUSIVE') and f.status=e.action)) for update of m for share of f,u`,
      )
    ).rows[0];
    if (
      !row ||
      row.consentVersion !== this.policy.messagingConsentPolicyVersion ||
      !(await captureClientConsentAuthority(tx, {
        subjectId: row.userId,
        botKey: row.botKey,
        chatId: row.chatId,
        externalUserId: row.chatId,
        messagingPolicyVersion: row.consentVersion,
      }))
    )
      return null;
    return row;
  }
  async deliverMaterials(id: string, { signal }: { signal: AbortSignal }) {
    if (!uuid.test(id)) return { kind: "cancelled" as const };
    if (!this.policy.notifier) return { kind: "unavailable" as const };
    const ready = await this.tx(async (tx) => {
      const r = await this.deliverySource(tx, id);
      if (!r) {
        await tx.execute(
          sql`update resident_review_messages set status='cancelled' where event_id=${id}::uuid and status='pending'`,
        );
        return false;
      }
      if (r.status !== "pending" || signal.aborted) return false;
      await tx.execute(
        sql`update resident_review_messages set status='dispatched',attempts=attempts+1,dispatched_at=clock_timestamp() where event_id=${id}::uuid`,
      );
      return true;
    });
    if (!ready) return { kind: "cancelled" as const };
    try {
      return await this.tx(async (tx) => {
        const r = await this.deliverySource(tx, id);
        if (!r || signal.aborted) {
          // No provider call has occurred: stale authority is definitely unsent.
          await tx.execute(
            sql`update resident_review_messages set status='cancelled',completed_at=clock_timestamp() where event_id=${id}::uuid and status='dispatched'`,
          );
          return { kind: "cancelled" as const };
        }
        if (r.status !== "dispatched") return { kind: "cancelled" as const };
        try {
          const receipt = await this.policy.notifier!.send({
            botId: r.botId,
            botKey: r.botKey,
            chatId: r.chatId,
            text: r.text,
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          });
          if (
            receipt.botId !== r.botId ||
            receipt.chatId !== r.chatId ||
            !/^[1-9][0-9]{0,19}$/u.test(receipt.messageId)
          )
            return { kind: "unknown_outcome" as const };
          await tx.execute(
            sql`update resident_review_messages set status='delivered',receipt=${receipt.messageId},completed_at=clock_timestamp() where event_id=${id}::uuid and status='dispatched'`,
          );
          return { kind: "delivered" as const };
        } catch {
          return { kind: "unknown_outcome" as const };
        }
      });
    } catch {
      return { kind: "unknown_outcome" as const };
    }
  }
}
