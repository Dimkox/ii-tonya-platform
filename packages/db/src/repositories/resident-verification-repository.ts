import { bridgeSeparatedSalesForm } from "./expert-separated-sales-repository.js";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  applyResidentPatch,
  residentForm,
  residentPolicyV2,
  residentV2TextFields,
  residentDocumentFields,
  type ResidentPolicy,
  type ResidentField,
  type ResidentDraft,
  type ResidentDocument,
} from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import type { ExpertPromoCommand } from "./expert-promo-repository.js";
export interface ResidentSnapshot extends Record<string, unknown> {
  formVersion?: 1 | 2;
  activeRequestId?: string | null;
  checkGeneration?: number;
  informationRequest?: {
    id: string;
    questions: string[];
    deadline: string;
    remainingSeconds: number;
  } | null;
  currentField?: ResidentField | null;
  policyVersion?: string;
  educationRequirement?: ResidentPolicy["education"];
  id: string;
  revision: number;
  draft: ResidentDraft;
  status: string;
  progress: string;
  replay: boolean;
}
export type ResidentMutation = ExpertPromoCommand & {
  action:
    | "start"
    | "patch"
    | "submit"
    | "followup"
    | "question"
    | "complete"
    | "reapply";
  expectedRevision?: number;
  applicationId?: string;
  patch?: unknown;
  requestId?: string;
  questionNumber?: number;
  answer?: string;
  documents?: ResidentDocument[];
  field?: ResidentField;
};
function fail(code: string): never {
  throw new Error(code);
}
export class PostgresResidentVerificationRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
      fieldPolicy?: ResidentPolicy;
    },
  ) {}
  async mutate(raw: ResidentMutation): Promise<ResidentSnapshot> {
    const input = {
      ...raw,
      ...(raw.patch === undefined ? {} : { patch: structuredClone(raw.patch) }),
      ...(raw.documents === undefined
        ? {}
        : { documents: structuredClone(raw.documents) }),
    };
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      !/^[1-9][0-9]{0,19}$/u.test(input.telegramUserId) ||
      input.chatId !== input.telegramUserId
    )
      fail("resident_identity_unavailable");
    if (
      !/^[\x21-\x7e]{1,200}$/u.test(input.requestKey) ||
      !/^[0-9a-f]{64}$/u.test(input.requestDigest) ||
      ![
        "start",
        "patch",
        "submit",
        "followup",
        "question",
        "complete",
        "reapply",
      ].includes(input.action)
    )
      fail("resident_invalid_request");

    if (
      input.field !== undefined &&
      ![
        "roles",
        "primaryRole",
        "category",
        "tax",
        "city",
        "socialLinks",
        "motivation",
        "specialization",
        "averageCheckMinor",
        "education",
        "propertyEvidence",
        "capacity",
        "amenities",
        "path",
        "cases",
        "experienceYears",
        ...residentV2TextFields,
        ...residentDocumentFields,
      ].includes(input.field)
    )
      fail("resident_invalid_field");
    if (
      input.action !== "start" &&
      (!Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision! < 0)
    )
      fail("resident_invalid_revision");
    if (
      input.applicationId !== undefined &&
      !/^[0-9a-f-]{36}$/u.test(input.applicationId)
    )
      fail("resident_invalid_request");
    if (input.action === "followup") {
      if (
        input.answer !== undefined &&
        (typeof input.answer !== "string" ||
          !input.answer.trim() ||
          input.answer.length > 3000 ||
          /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(input.answer))
      )
        fail("resident_invalid_answer");
      if (input.documents !== undefined) {
        if (!Array.isArray(input.documents) || input.documents.length < 1)
          fail("resident_invalid_documents");
        applyResidentPatch({}, { education: input.documents }, 2);
      }
      if (input.answer === undefined && input.documents === undefined)
        fail("resident_invalid_answer");
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          digest: input.requestDigest,
          action: input.action,
          expectedRevision: input.expectedRevision,
          applicationId: input.applicationId,
          patch: input.patch,
          answer: input.answer,
          documents: input.documents,
          field: input.field,
          requestId: input.requestId,
          questionNumber: input.questionNumber,
        }),
      )
      .digest("hex");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='4000ms'`);
      await tx.execute(sql`set local lock_timeout='2000ms'`);
      const rows = (
        await tx.execute<{ userId: string; identityId: string }>(
          sql`select ci.id as "identityId",ci.user_id as "userId" from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (rows.length !== 1) return fail("resident_identity_unavailable");
      const userId = rows[0]!.userId;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: input.botKey,
          chatId: input.chatId,
          externalUserId: input.telegramUserId,
          messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
        }))
      )
        fail("resident_identity_unavailable");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`resident-request:${input.botId}:${input.botKey}:${input.requestKey}`},0))`,
      );
      const prior = (
        await tx.execute<{
          userId: string | null;
          digest: string | null;
          operation: string;
          result: ResidentSnapshot | null;
        }>(
          sql`select user_id as "userId",request_digest as digest,operation,result from resident_verification_requests where bot_id=${input.botId} and bot_key=${input.botKey} and request_key=${input.requestKey}`,
        )
      ).rows[0];
      if (prior) {
        if (
          prior.userId !== userId ||
          prior.digest !== fingerprint ||
          prior.operation !== input.action ||
          !prior.result
        )
          fail("resident_idempotency_conflict");
        return { ...prior.result!, replay: true };
      }
      let row = (
        await tx.execute<ResidentSnapshot>(
          sql`select id,form_version as "formVersion",active_request_id as "activeRequestId",check_generation as "checkGeneration",revision,draft,status,progress,current_field as "currentField",policy_version as "policyVersion",education_requirement as "educationRequirement" from residents_applications where user_id=${userId}::uuid and bot_id=${input.botId} and bot_key=${input.botKey} and is_current for update`,
        )
      ).rows[0];
      if (!row && input.action === "start") {
        // Legacy authoritative offers are never moved into the new intake cohort.
        const legacy = (
          await tx.execute<{ yes: boolean }>(
            sql`select exists(select 1 from expert_campaign_quotes where user_id=${userId}::uuid) or exists(select 1 from experts e join expert_residency_orders o on o.expert_id=e.id where e.user_id=${userId}::uuid and o.status='settled') as yes`,
          )
        ).rows[0]?.yes;
        if (legacy) fail("resident_legacy_flow");
        row = (
          await tx.execute<ResidentSnapshot>(
            sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,policy_version,education_requirement) values(${userId}::uuid,${input.botId},${input.botKey},${rows[0]!.identityId}::uuid,${input.telegramUserId},${input.chatId},${(this.policy.fieldPolicy ?? residentPolicyV2).version},${(this.policy.fieldPolicy ?? residentPolicyV2).education}) returning id,form_version as "formVersion",active_request_id as "activeRequestId",check_generation as "checkGeneration",revision,draft,status,progress,current_field as "currentField",policy_version as "policyVersion",education_requirement as "educationRequirement"`,
          )
        ).rows[0];
      }
      if (
        !row ||
        (input.applicationId !== undefined && row.id !== input.applicationId)
      )
        return fail("resident_application_unavailable");
      if (input.action !== "start") {
        const storedPolicy: ResidentPolicy = {
          version: row.policyVersion!,
          education: row.educationRequirement!,
        };
        if (row.revision !== input.expectedRevision)
          fail("resident_revision_conflict");
        if (input.action === "reapply") {
          if (row.status !== "REJECTED") fail("resident_reapply_unavailable");
          await tx.execute(
            sql`update residents_applications set is_current=false,revision=revision+1 where id=${row.id}::uuid`,
          );
          const created = (
            await tx.execute<ResidentSnapshot>(
              sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,attempt_number) select user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id,attempt_number+1 from residents_applications where id=${row.id}::uuid returning id,form_version as "formVersion",revision,draft,status,progress,policy_version as "policyVersion",education_requirement as "educationRequirement"`,
            )
          ).rows[0]!;
          await tx.execute(
            sql`insert into resident_verification_requests(bot_id,bot_key,request_key,user_id,request_digest,operation,result) values(${input.botId},${input.botKey},${input.requestKey},${userId}::uuid,${fingerprint},${input.action},${JSON.stringify(created)}::jsonb)`,
          );
          return { ...created, replay: false };
        }
        if (input.action === "complete") {
          if (
            row.status !== "INFO_REQUESTED" ||
            !input.requestId ||
            input.requestId !== row.activeRequestId
          )
            fail("resident_followup_unavailable");
          const completed = await tx.execute(
            sql`update resident_information_requests set status='completed',completed_at=clock_timestamp() where id=${input.requestId}::uuid and application_id=${row.id}::uuid and status='open' and deadline>clock_timestamp() and (select count(distinct question_number) from resident_verification_application_updates where request_id=${input.requestId}::uuid)=jsonb_array_length(questions)`,
          );
          if (!completed.rowCount) fail("resident_followup_unavailable");
          await tx.execute(
            sql`insert into resident_check_generations(application_id,generation,submitted_revision,supplement_revision,request_id) select id,check_generation+1,submitted_revision,revision+1,active_request_id from residents_applications where id=${row.id}::uuid`,
          );
          row = (
            await tx.execute<ResidentSnapshot>(
              sql`update residents_applications set revision=revision+1,status='UNDER_REVIEW',progress='MANAGER_REVIEW',check_generation=check_generation+1,active_request_id=null where id=${row.id}::uuid returning id,form_version as "formVersion",revision,draft,status,progress,policy_version as "policyVersion",education_requirement as "educationRequirement"`,
            )
          ).rows[0]!;
          await tx.execute(
            sql`insert into resident_verification_requests(bot_id,bot_key,request_key,user_id,request_digest,operation,result) values(${input.botId},${input.botKey},${input.requestKey},${userId}::uuid,${fingerprint},${input.action},${JSON.stringify(row)}::jsonb)`,
          );
          return { ...row, replay: false };
        }
        if (input.action === "followup") {
          if (
            row.formVersion === 2 &&
            (row.status !== "INFO_REQUESTED" ||
              !input.requestId ||
              input.requestId !== row.activeRequestId ||
              !(
                await tx.execute(
                  sql`select 1 from resident_information_requests where id=${input.requestId}::uuid and application_id=${row.id}::uuid and status='open' and deadline>clock_timestamp() and ${input.questionNumber ?? null}::integer between 1 and jsonb_array_length(questions)`,
                )
              ).rows.length)
          )
            fail("resident_followup_unavailable");
          if (input.documents)
            applyResidentPatch(
              {},
              { education: input.documents },
              row.formVersion ?? 1,
            );
          // Supplemental applicant answers never mutate the frozen submitted facts or outcomes.
          if (!["INFO_REQUESTED", "UNDER_REVIEW"].includes(row.status))
            fail("resident_followup_unavailable");
        } else if (row.status !== "PENDING_DOCS")
          fail("resident_submission_frozen");
        const draft =
          input.action === "patch"
            ? applyResidentPatch(row.draft, input.patch, row.formVersion ?? 1)
            : row.draft;
        if (
          input.action === "submit" &&
          residentForm(draft, storedPolicy, row.formVersion ?? 1).missing.length
        )
          fail("resident_incomplete");
        const submitting = input.action === "submit";
        const updated = (
          await tx.execute<ResidentSnapshot>(
            sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,current_field=${input.field ?? null},revision=revision+1,status=${submitting ? "UNDER_REVIEW" : row.status},progress=${submitting ? "AUTO_CHECK" : row.progress},submitted_draft=${submitting ? sql`${JSON.stringify(draft)}::jsonb` : sql`submitted_draft`},submitted_at=${submitting ? sql`clock_timestamp()` : sql`submitted_at`},updated_at=clock_timestamp() where id=${row.id}::uuid returning id,form_version as "formVersion",active_request_id as "activeRequestId",check_generation as "checkGeneration",revision,draft,status,progress,current_field as "currentField",policy_version as "policyVersion",education_requirement as "educationRequirement"`,
          )
        ).rows[0]!;
        await tx.execute(
          sql`insert into resident_verification_application_updates(application_id,user_id,revision,kind,request_id,question_number,answers) values(${row.id}::uuid,${userId}::uuid,${updated.revision},${input.action},${input.requestId ?? null}::uuid,${input.questionNumber ?? null}::integer,${JSON.stringify(input.action === "patch" ? input.patch : input.action === "followup" ? { ...(input.answer === undefined ? {} : { answer: input.answer }), ...(input.documents === undefined ? {} : { documents: input.documents }) } : input.action === "question" ? { field: input.field } : {})}::jsonb)`,
        );
        if (submitting)
          await tx.execute(
            sql`insert into resident_verification_check_work(application_id,user_id,submitted_revision) values(${row.id}::uuid,${userId}::uuid,${updated.revision}) on conflict(application_id) do nothing`,
          );
        if (submitting)
          await bridgeSeparatedSalesForm(tx, userId, row.id, updated.revision);
        row = updated;
      }
      if (input.action === "start" && row.status === "UNDER_REVIEW")
        await bridgeSeparatedSalesForm(tx, userId, row.id, row.revision);
      const informationRequest = row.activeRequestId
        ? ((
            await tx.execute<{
              id: string;
              questions: string[];
              deadline: string;
              remainingSeconds: number;
            }>(
              sql`select id,questions,deadline::text, greatest(0,extract(epoch from deadline-clock_timestamp()))::integer as "remainingSeconds" from resident_information_requests where id=${row.activeRequestId}::uuid and application_id=${row.id}::uuid and status='open'`,
            )
          ).rows[0] ?? null)
        : null;
      const result = { ...row, informationRequest, replay: false };
      await tx.execute(
        sql`insert into resident_verification_requests(bot_id,bot_key,request_key,user_id,request_digest,operation,result) values(${input.botId},${input.botKey},${input.requestKey},${userId}::uuid,${fingerprint},${input.action},${JSON.stringify(result)}::jsonb)`,
      );
      return result;
    });
  }
}
