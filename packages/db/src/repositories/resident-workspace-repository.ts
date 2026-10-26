import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import { enqueueApplicationMaterials } from "./expert-application-materials.js";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Shared with verified settlement: no post-commit activation gap and no new access authority. */
export async function activateResidentWorkspaceInTransaction(
  tx: ExpertCardTransaction,
  userId: string,
  policy: string,
) {
  if (!uuid.test(userId)) return { kind: "denied" as const };
  await lockClientConsentSubject(tx, userId);
  const app = (
    await tx.execute<{ id: string }>(
      sql`select a.id from expert_onboarding_applications a join users u on u.id=a.user_id and u.active where a.user_id=${userId}::uuid and a.verification_status='approved' and a.archived_at is null and a.archive_until_date is null and exists(select 1 from expert_onboarding_invoices i join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.user_id=a.user_id and f.admission='interview' where i.application_id=a.id and i.user_id=a.user_id and i.status='settled' and i.purpose='onboarding' and i.amount_minor=300000) for update of a`,
    )
  ).rows[0];
  if (!app) return { kind: "denied" as const };
  const consent = (
    await tx.execute<{ valid: boolean }>(
      sql`select expert_card_current_messaging_authority(${userId}::uuid,${policy}) as valid`,
    )
  ).rows[0]?.valid;
  if (consent !== true) return { kind: "denied" as const };
  // A fee admits interview only. Missing manager-exception producer is deliberately absent.
  const prior =
    (
      await tx.execute(
        sql`select id from audit_events where action='ACCESS_ACTIVATED' and object_id=${app.id}::uuid`,
      )
    ).rows.length === 1;
  await enqueueApplicationMaterials(tx, app.id, userId);
  await tx.execute(
    sql`update expert_onboarding_applications set onboarding_stage=coalesce(onboarding_stage,'interview'),updated_at=clock_timestamp() where id=${app.id}::uuid`,
  );
  await tx.execute(
    sql`insert into expert_verification_work(application_id,user_id,kind) values(${app.id}::uuid,${userId}::uuid,'interview_ready') on conflict(application_id,kind) do nothing`,
  );
  if (!prior)
    await tx.execute(
      sql`insert into audit_events(actor_type,actor_id,authenticated_session_id_hash,action,object_type,object_id,decision,reason_code,correlation_id,occurred_at,metadata_hash) values('system',${userId}::uuid,${sha(app.id)},'ACCESS_ACTIVATED','expert_onboarding_application',${app.id}::uuid,'applied','paid_onboarding_interview',${`workspace:${sha(app.id)}`},clock_timestamp(),${sha("interview:" + app.id)})`,
    );
  return {
    kind: "activated" as const,
    applicationId: app.id,
    replay: prior,
    access: "interview" as const,
  };
}
export interface WorkspaceNotifier {
  send(input: {
    botId: string;
    botKey: string;
    chatId: string;
    text: string;
    signal: AbortSignal;
  }): Promise<{ botId: string; chatId: string; messageId: string }>;
}
export class PostgresResidentWorkspaceRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly options: {
      messagingConsentPolicyVersion: string;
      notifier?: WorkspaceNotifier;
      workBotId?: string;
      workBotKey?: string;
      workBotUsername?: string;
    },
  ) {}
  private async tx<T>(
    work: (tx: ExpertCardTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      return work(tx);
    });
  }
  async activateResidentWorkspace(userId: string) {
    return this.tx((tx) =>
      activateResidentWorkspaceInTransaction(
        tx,
        userId,
        this.options.messagingConsentPolicyVersion,
      ),
    );
  }
  async listDueMaterialJobs(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("workspace_batch_invalid");
    return this.tx(
      async (tx) =>
        (
          await tx.execute<{ jobId: string }>(
            sql`select id as "jobId" from expert_verification_work where kind='interview_ready' and status='pending' and attempt_id is null order by created_at,id limit ${limit}`,
          )
        ).rows,
    );
  }
  private async current(tx: ExpertCardTransaction, jobId: string) {
    const initial = (
      await tx.execute<{ userId: string }>(
        sql`select user_id as "userId" from expert_verification_work where id=${jobId}::uuid and kind='interview_ready'`,
      )
    ).rows[0];
    if (!initial) return null;
    await lockClientConsentSubject(tx, initial.userId);
    const row = (
      await tx.execute<{
        userId: string;
        applicationId: string;
        status: string;
        attemptId: string | null;
        botId: string;
        botKey: string;
        chatId: string;
      }>(
        sql`select w.user_id as "userId",w.application_id as "applicationId",w.status,w.attempt_id as "attemptId",j.target_bot_id as "botId",j.target_bot_key as "botKey",j.target_chat_id as "chatId" from expert_verification_work w join expert_application_material_jobs j on j.application_id=w.application_id and j.user_id=w.user_id join expert_onboarding_applications a on a.id=w.application_id and a.user_id=w.user_id and a.verification_status='approved' and a.archived_at is null and a.archive_until_date is null join users u on u.id=w.user_id and u.active where w.id=${jobId}::uuid and w.kind='interview_ready' and exists(select 1 from expert_onboarding_invoices i join expert_onboarding_payment_facts f on f.invoice_id=i.id and f.user_id=w.user_id and f.admission='interview' where i.application_id=w.application_id and i.user_id=w.user_id and i.status='settled') for update of w for share of a,u,j`,
      )
    ).rows[0];
    if (!row?.botId || !row.botKey || !row.chatId) return null;
    if (
      !(await captureClientConsentAuthority(tx, {
        subjectId: row.userId,
        botKey: row.botKey,
        chatId: row.chatId,
        externalUserId: row.chatId,
        messagingPolicyVersion: this.options.messagingConsentPolicyVersion,
      }))
    )
      return null;
    return row;
  }
  async deliverMaterials(jobId: string, { signal }: { signal: AbortSignal }) {
    if (!uuid.test(jobId)) return { kind: "cancelled" as const };
    const o = this.options;
    if (
      !o.notifier ||
      !o.workBotId ||
      !o.workBotKey ||
      !o.workBotUsername ||
      !/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(o.workBotUsername)
    )
      return { kind: "unavailable" as const };
    const attemptId = randomUUID();
    const prepared = await this.tx(async (tx) => {
      const j = await this.current(tx, jobId);
      if (!j) {
        const stored = (
          await tx.execute<{ status: string }>(
            sql`select status from expert_verification_work where id=${jobId}::uuid and kind='interview_ready' for update`,
          )
        ).rows[0];
        if (stored?.status === "unknown_outcome")
          return { kind: "unknown_outcome" as const };
        if (stored?.status === "completed")
          return { kind: "already_delivered" as const };
        // A lost original identity/admission cannot starve later valid pending work.
        await tx.execute(
          sql`update expert_verification_work set status='cancelled' where id=${jobId}::uuid and kind='interview_ready' and status='pending' and attempt_id is null`,
        );
        return { kind: "cancelled" as const };
      }
      if (j.status === "completed")
        return { kind: "already_delivered" as const };
      if (j.status === "unknown_outcome" || j.attemptId)
        return { kind: "unknown_outcome" as const };
      if (j.status !== "pending") return { kind: "cancelled" as const };
      if (signal.aborted) return { kind: "unavailable" as const };
      await tx.execute(
        sql`update expert_verification_work set attempt_id=${attemptId}::uuid,attempted_at=clock_timestamp(),status='unknown_outcome' where id=${jobId}::uuid`,
      );
      const handoff = await issueOwnedWorkHandoff(tx, {
        userId: j.userId,
        applicationId: j.applicationId,
        sourceBotKey: j.botKey,
        externalId: j.chatId,
        targetBotId: o.workBotId!,
        targetBotKey: o.workBotKey!,
        revokeExisting: false,
      });
      return { kind: "prepared" as const, token: handoff.token };
    });
    if (prepared.kind !== "prepared") return prepared;
    // Durable unknown precedes any external disclosure. Subject lock fences withdrawal/erasure.
    return this.tx(async (tx) => {
      const j = await this.current(tx, jobId);
      if (
        !j ||
        signal.aborted ||
        j.attemptId !== attemptId ||
        j.status !== "unknown_outcome"
      )
        return { kind: "unknown_outcome" as const };
      try {
        const receipt = await o.notifier!.send({
          botId: j.botId,
          botKey: j.botKey,
          chatId: j.chatId,
          text: `Доступ открыт! Перейдите в рабочий кабинет: https://t.me/${o.workBotUsername}?start=card_${prepared.token}`,
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        });
        if (
          receipt.botId !== j.botId ||
          receipt.chatId !== j.chatId ||
          !/^[1-9][0-9]{0,19}$/u.test(receipt.messageId)
        )
          return { kind: "unknown_outcome" as const };
        await tx.execute(
          sql`update expert_verification_work set status='completed',delivery_message_id=${receipt.messageId} where id=${jobId}::uuid and attempt_id=${attemptId}::uuid`,
        );
        return { kind: "delivered" as const };
      } catch {
        return { kind: "unknown_outcome" as const };
      }
    });
  }
}
/** The same owner-bound token mechanism serves explicit requests and notifications. */
export async function issueOwnedWorkHandoff(
  tx: ExpertCardTransaction,
  input: {
    userId: string;
    applicationId: string;
    sourceBotKey: string;
    externalId: string;
    targetBotId: string;
    targetBotKey: string;
    revokeExisting?: boolean;
  },
) {
  if (input.revokeExisting !== false)
    await tx.execute(
      sql`update expert_card_handoffs set consumed_at=clock_timestamp() where user_id=${input.userId}::uuid and consumed_at is null`,
    );
  const token = randomBytes(32).toString("base64url");
  const row = (
    await tx.execute<{ expiresAt: string }>(
      sql`insert into expert_card_handoffs(token_digest,user_id,application_id,source_bot_key,external_id,target_bot_id,target_bot_key) values(${`sha256:${sha(token)}`},${input.userId}::uuid,${input.applicationId}::uuid,${input.sourceBotKey},${input.externalId},${input.targetBotId},${input.targetBotKey}) returning to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "expiresAt"`,
    )
  ).rows[0]!;
  return { token, expiresAt: row.expiresAt };
}
