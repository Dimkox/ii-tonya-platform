import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const lifecycleJobs = pgTable(
  "lifecycle_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: uuid("subject_id").notNull(),
    subjectKind: text("subject_kind").notNull().default("reservation"),
    jobType: text("job_type").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("lifecycle_jobs_subject_type_unique").on(
      table.subjectKind,
      table.subjectId,
      table.jobType,
      table.occurrenceKey,
    ),
    check(
      "lifecycle_jobs_subject_kind_check",
      sql`${table.subjectKind} in ('reservation','user','coupon')`,
    ),
    check(
      "lifecycle_jobs_occurrence_key_check",
      sql`char_length(${table.occurrenceKey}) between 1 and 128 and ${table.occurrenceKey} !~ '[[:cntrl:]]'`,
    ),
    check(
      "lifecycle_jobs_type_check",
      sql`${table.jobType} in ('booking_reminder_48h','booking_reminder_24h','booking_reminder_1h','weekly_checkup','post_visit_feedback','coupon_expiry_14d','coupon_expiry_7d')`,
    ),
    check(
      "lifecycle_jobs_status_check",
      sql`${table.status} in ('pending','processing','retry_wait','cancelled','succeeded','dead_letter')`,
    ),
    check(
      "lifecycle_jobs_attempt_count_check",
      sql`${table.attemptCount} between 0 and 5`,
    ),
    check(
      "lifecycle_jobs_cancellation_reason_check",
      sql`${table.cancellationReason} is null or (char_length(${table.cancellationReason}) between 1 and 64 and ${table.cancellationReason} ~ '^[a-z][a-z0-9_]*$')`,
    ),
    check(
      "lifecycle_jobs_lease_check",
      sql`(${table.status} = 'processing' and ${table.leaseToken} is not null and ${table.leaseUntil} is not null) or (${table.status} <> 'processing' and ${table.leaseToken} is null and ${table.leaseUntil} is null)`,
    ),
    index("lifecycle_jobs_due_claim_idx")
      .on(table.runAt, table.id)
      .where(sql`${table.status} in ('pending','retry_wait')`),
    index("lifecycle_jobs_lease_idx")
      .on(table.leaseUntil, table.id)
      .where(sql`${table.status} in ('processing')`),
  ],
);
