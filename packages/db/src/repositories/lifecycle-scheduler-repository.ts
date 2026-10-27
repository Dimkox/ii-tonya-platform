import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";
import {
  captureClientConsentAuthority,
  lockClientConsentSubject,
} from "./client-consent-authority.js";
import { currentConsentGrantedSql } from "./consent-current.js";

export type LifecycleJobType =
  | "booking_reminder_48h"
  | "booking_reminder_24h"
  | "booking_reminder_1h"
  | "weekly_checkup"
  | "post_visit_feedback"
  | "coupon_expiry_14d"
  | "coupon_expiry_7d";

export interface LifecycleBatchResult {
  readonly examined: number;
  readonly materialized: number;
  readonly cancelled: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const BOT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const BOOKING_JOB_TYPES = new Set<LifecycleJobType>([
  "booking_reminder_48h",
  "booking_reminder_24h",
  "booking_reminder_1h",
]);
const MAX_BATCH_SIZE = 500;

type ClaimedJob = {
  id: string;
  leaseToken: string;
  jobType: LifecycleJobType;
};

type EligibleReminder = {
  reservationId: string;
  userId: string;
  startsAt: Date | string;
  timezone: string | null;
  dialogueId: string;
  botKey: string;
  chatId: string;
  meetingUrl: string | null;
};

export function assertLifecycleReservationId(id: string): void {
  if (!UUID_RE.test(id)) throw new Error("Invalid reservation UUID");
}

export function assertLifecycleCancellationReason(reason: string): void {
  if (!REASON_RE.test(reason)) {
    throw new Error("Invalid lifecycle cancellation reason");
  }
}

function assertBatch(command: { now: Date; batchSize: number }): void {
  if (!Number.isFinite(command.now.getTime())) {
    throw new Error("Invalid lifecycle batch time");
  }
  if (
    !Number.isSafeInteger(command.batchSize) ||
    command.batchSize < 1 ||
    command.batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error("Invalid lifecycle batch size");
  }
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("lifecycle_invalid_meeting_time");
  }
  return date;
}

function safeTimezone(value: string | null): string {
  const candidate = value?.trim() || "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "Europe/Moscow";
  }
}

function reminderText(
  jobType: LifecycleJobType,
  startsAt: Date,
  timezoneValue: string | null,
  meetingUrlValue: string | null,
): string {
  if (!BOOKING_JOB_TYPES.has(jobType)) {
    throw new Error("lifecycle_unsupported_job_type");
  }
  const timezone = safeTimezone(timezoneValue);
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const lead =
    jobType === "booking_reminder_48h"
      ? "через 2 дня"
      : jobType === "booking_reminder_24h"
        ? "через 1 день"
        : "через 1 час";
  const base = `Напоминаю: встреча с экспертом ${lead}, ${formatter.format(startsAt)} (${timezone}).`;
  if (jobType === "booking_reminder_48h" || meetingUrlValue === null) {
    return base;
  }
  try {
    const meetingUrl = new URL(meetingUrlValue);
    if (meetingUrl.protocol !== "https:" || meetingUrl.href.length > 2_048) {
      return base;
    }
    return `${base} Ссылка: ${meetingUrl.href}`;
  } catch {
    return base;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function numericCount(value: number | string | undefined): number {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("lifecycle_invalid_count");
  }
  return count;
}

export class PostgresLifecycleSchedulerRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly messagingConsentPolicyVersion: string,
    private readonly botKey: string,
  ) {
    if (!POLICY_RE.test(messagingConsentPolicyVersion)) {
      throw new Error("messaging consent policy version required");
    }
    if (!BOT_KEY_RE.test(botKey)) {
      throw new Error("client Telegram bot key required");
    }
  }

  async scheduleReservationLifecycle(reservationId: string): Promise<number> {
    assertLifecycleReservationId(reservationId);
    return this.db.transaction(async (tx) => {
      const subject = (
        await tx.execute<{ userId: string }>(sql`
          select user_id as "userId" from reservations
          where id=${reservationId}::uuid
        `)
      ).rows[0];
      if (!subject) return 0;
      await lockClientConsentSubject(tx, subject.userId);
      const eligible = (
        await tx.execute<{
          startsAt: Date | string;
          databaseNow: Date | string;
        }>(sql`
          select s.starts_at as "startsAt",clock_timestamp() as "databaseNow"
          from reservations r
          join slots s on s.id=r.slot_id
          join users u on u.id=r.user_id and u.active=true
          where r.id=${reservationId}::uuid
            and r.user_id=${subject.userId}::uuid
            and r.status='booked'
            and s.starts_at > clock_timestamp()
            and ${currentConsentGrantedSql({
              userExpression: sql`r.user_id`,
              purpose: "client_messaging",
              policyVersion: sql`${this.messagingConsentPolicyVersion}`,
            })}
            and exists (
              select 1 from dialogues d
              where d.user_id=r.user_id and d.provider='telegram'
                and d.bot_key=${this.botKey}
                and d.external_chat_id ~ '^[1-9][0-9]{0,19}$'
            )
          for update of r,s
        `)
      ).rows[0];
      if (!eligible) return 0;

      const startsAt = asDate(eligible.startsAt);
      const databaseNow = asDate(eligible.databaseNow);
      const occurrenceKey = startsAt.toISOString();
      const candidates = [
        ["booking_reminder_48h", 48 * 60 * 60 * 1_000],
        ["booking_reminder_24h", 24 * 60 * 60 * 1_000],
        ["booking_reminder_1h", 60 * 60 * 1_000],
      ] as const;
      let inserted = 0;
      for (const [jobType, offsetMs] of candidates) {
        const runAt = new Date(startsAt.getTime() - offsetMs);
        if (runAt.getTime() <= databaseNow.getTime()) continue;
        const result = await tx.execute<{ id: string }>(sql`
          insert into lifecycle_jobs(
            subject_id,subject_kind,job_type,occurrence_key,run_at
          ) values(
            ${reservationId}::uuid,'reservation',${jobType},${occurrenceKey},${runAt}
          )
          on conflict (subject_kind,subject_id,job_type,occurrence_key) do nothing
          returning id
        `);
        inserted += result.rows.length;
      }
      return inserted;
    });
  }

  async cancelReservationLifecycle(
    reservationId: string,
    reason: string,
  ): Promise<number> {
    assertLifecycleReservationId(reservationId);
    assertLifecycleCancellationReason(reason);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        update lifecycle_jobs
        set status='cancelled',cancellation_reason=${reason},lease_token=null,
          lease_until=null,updated_at=clock_timestamp()
        where subject_kind='reservation'
          and subject_id=${reservationId}::uuid
          and status in ('pending','processing','retry_wait')
        returning id
      `);
      return result.rows.length || numericCount(result.rowCount ?? 0);
    });
  }

  async processDueLifecycleBatch(command: {
    now: Date;
    batchSize: number;
  }): Promise<LifecycleBatchResult> {
    assertBatch(command);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        with expired as materialized (
          select id
          from lifecycle_jobs
          where status='processing' and lease_until <= ${command.now}
          order by lease_until,id
          for update skip locked
          limit ${command.batchSize}
        )
        update lifecycle_jobs job
        set status=case
              when job.attempt_count >= 5 then 'dead_letter'
              else 'retry_wait'
            end,
          cancellation_reason=case
              when job.attempt_count >= 5 then 'attempts_exhausted'
              else null
            end,
          lease_token=null,lease_until=null,updated_at=clock_timestamp()
        from expired
        where job.id=expired.id
      `);
      const claimed = await tx.execute<ClaimedJob>(sql`
        with candidates as materialized (
          select id
          from lifecycle_jobs
          where status in ('pending','retry_wait')
            and run_at <= ${command.now}
            and attempt_count < 5
          order by run_at,id
          for update skip locked
          limit ${command.batchSize}
        )
        update lifecycle_jobs job
        set status='processing',lease_token=gen_random_uuid(),
          lease_until=${command.now}::timestamptz+interval '5 minutes',
          attempt_count=job.attempt_count+1,updated_at=clock_timestamp()
        from candidates
        where job.id=candidates.id
        returning job.id,job.lease_token as "leaseToken",job.job_type as "jobType"
      `);

      let materialized = 0;
      let cancelled = 0;
      for (const job of claimed.rows) {
        const prior = await tx.execute<{ id: string }>(sql`
          select id from dialogue_deliveries
          where source='deterministic' and source_id=${job.id}
          limit 1
        `);
        if (prior.rows.length > 0) {
          await tx.execute(sql`
            update lifecycle_jobs
            set status='succeeded',lease_token=null,lease_until=null,
              cancellation_reason=null,updated_at=clock_timestamp()
            where id=${job.id}::uuid and status='processing'
              and lease_token=${job.leaseToken}::uuid
          `);
          continue;
        }

        // Resolve the subject without row locks, then join the shared consent
        // barrier before locking reservation, identity or dialogue rows.
        const subject = (
          await tx.execute<{ userId: string }>(sql`
            select r.user_id as "userId" from lifecycle_jobs job
            join reservations r on job.subject_kind='reservation' and r.id=job.subject_id
            where job.id=${job.id}::uuid
          `)
        ).rows[0];
        if (subject) await lockClientConsentSubject(tx, subject.userId);
        const eligible = (
          await tx.execute<EligibleReminder>(sql`
            select r.id as "reservationId",r.user_id as "userId",
              s.starts_at as "startsAt",cp.timezone,
              d.id as "dialogueId",d.bot_key as "botKey",
              d.external_chat_id as "chatId",r.meeting_url as "meetingUrl"
            from lifecycle_jobs job
            join reservations r
              on job.subject_kind='reservation' and r.id=job.subject_id
            join slots s on s.id=r.slot_id
            join users u on u.id=r.user_id and u.active=true
            left join client_profiles cp on cp.user_id=r.user_id
            join dialogues d on d.user_id=r.user_id and d.provider='telegram'
              and d.bot_key=${this.botKey}
              and d.external_chat_id ~ '^[1-9][0-9]{0,19}$'
            where job.id=${job.id}::uuid and job.status='processing'
              and job.lease_token=${job.leaseToken}::uuid
              and job.job_type in (
                'booking_reminder_48h','booking_reminder_24h','booking_reminder_1h'
              )
              and r.status='booked'
              and s.starts_at > ${command.now}
              and r.user_id=${subject?.userId ?? null}::uuid
            order by d.created_at,d.id
            limit 1
            for update of r,d
          `)
        ).rows[0];

        const consentAuthority = eligible
          ? await captureClientConsentAuthority(tx, {
              subjectId: eligible.userId,
              botKey: eligible.botKey,
              chatId: eligible.chatId,
              messagingPolicyVersion: this.messagingConsentPolicyVersion,
            })
          : undefined;
        if (!eligible || !consentAuthority) {
          const terminal = await tx.execute<{ id: string }>(sql`
            update lifecycle_jobs
            set status='cancelled',cancellation_reason='eligibility_revoked',
              lease_token=null,lease_until=null,updated_at=clock_timestamp()
            where id=${job.id}::uuid and status='processing'
              and lease_token=${job.leaseToken}::uuid
            returning id
          `);
          cancelled += terminal.rows.length;
          continue;
        }

        const sequenceRow = (
          await tx.execute<{ sequence: bigint | number | string }>(sql`
            update dialogues
            set next_delivery_sequence=next_delivery_sequence+1
            where id=${eligible.dialogueId}::uuid
              and user_id=${eligible.userId}::uuid
              and provider='telegram'
            returning next_delivery_sequence as sequence
          `)
        ).rows[0];
        const sequence = Number(sequenceRow?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) {
          throw new Error("lifecycle_dialogue_sequence_missing");
        }

        const text = reminderText(
          job.jobType,
          asDate(eligible.startsAt),
          eligible.timezone,
          eligible.meetingUrl,
        );
        const deliveryId = randomUUID();
        const generatedOutboxId = randomUUID();
        const deliveryKey = `sha256:${digest(`lifecycle-delivery\0${job.id}`)}`;
        const payload = {
          deliveryId,
          dialogueId: eligible.dialogueId,
          sequence,
          botKey: eligible.botKey,
          chatId: eligible.chatId,
          text,
          consentAuthority,
        };
        const payloadHash = digest(JSON.stringify(payload));
        const outbox = await tx.execute<{ id: string }>(sql`
          insert into integration_outbox(
            id,idempotency_key,topic,payload,correlation_id,reconciliation_key,
            payload_hash,dialogue_id,dialogue_sequence
          ) values(
            ${generatedOutboxId}::uuid,${deliveryKey},'telegram.send_text.v1',
            ${JSON.stringify(payload)}::jsonb,${`lifecycle:${job.id}`},${deliveryKey},
            ${payloadHash},${eligible.dialogueId}::uuid,${sequence}
          )
          on conflict (idempotency_key) do nothing
          returning id
        `);
        const persistedOutboxId = outbox.rows[0]?.id;
        if (!persistedOutboxId) {
          throw new Error("lifecycle_outbox_idempotency_conflict");
        }
        await tx.execute(sql`
          insert into dialogue_deliveries(
            id,dialogue_id,dialogue_sequence,source,source_id,outbox_id,payload_hash
          ) values(
            ${deliveryId}::uuid,${eligible.dialogueId}::uuid,${sequence},
            'deterministic',${job.id},${persistedOutboxId}::uuid,${payloadHash}
          )
        `);
        const terminal = await tx.execute<{ id: string }>(sql`
          update lifecycle_jobs
          set status='succeeded',lease_token=null,lease_until=null,
            cancellation_reason=null,updated_at=clock_timestamp()
          where id=${job.id}::uuid and status='processing'
            and lease_token=${job.leaseToken}::uuid
          returning id
        `);
        if (terminal.rows.length !== 1) {
          throw new Error("lifecycle_job_fence_lost");
        }
        materialized += 1;
      }
      return { examined: claimed.rows.length, materialized, cancelled };
    });
  }
}
