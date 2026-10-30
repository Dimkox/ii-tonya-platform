// 0083 hand-authored migration is authoritative; this mirrors its reconstructed catalogue.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
export const earlyBirdLaunchKitJobs = pgTable(
  "early_bird_launch_kit_jobs",
  {
    id: uuid("id").primaryKey().default(sql.raw("gen_random_uuid()")),
    userId: uuid("user_id").notNull(),
    expertId: uuid("expert_id").notNull(),
    contentVersion: text("content_version").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    status: text("status").notNull().default(sql.raw("'pending'")),
    attemptId: uuid("attempt_id"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    messageIds: jsonb("message_ids"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql.raw("clock_timestamp()")),
  },
  (t) => [
    foreignKey({
      name: "early_bird_launch_kit_jobs_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    unique("early_bird_launch_kit_jobs_user_id_content_version_key").on(
      t.userId,
      t.contentVersion,
    ),
    check(
      "early_bird_launch_kit_jobs_content_version_check",
      sql.raw("content_version = 'early-bird-launch.v1'::text"),
    ),
    check(
      "early_bird_launch_kit_jobs_payload_digest_check",
      sql.raw(
        "payload_digest = 'sha256:68ae1b75b98db4ab821e3f41dfe2f2100ac440c75a559d9b33faeb543edb5ff1'::text",
      ),
    ),
    check(
      "early_bird_launch_kit_jobs_status_check",
      sql.raw(
        "status = ANY (ARRAY['pending'::text, 'dispatched'::text, 'delivered'::text, 'uncertain'::text, 'cancelled'::text])",
      ),
    ),
    check(
      "early_bird_launch_kit_jobs_check",
      sql.raw(
        "status = 'pending'::text AND attempt_id IS NULL AND dispatched_at IS NULL AND message_ids IS NULL AND finished_at IS NULL OR status = 'dispatched'::text AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NULL AND finished_at IS NULL OR (status = ANY (ARRAY['uncertain'::text, 'cancelled'::text])) AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NULL AND finished_at IS NOT NULL OR status = 'delivered'::text AND attempt_id IS NOT NULL AND dispatched_at IS NOT NULL AND message_ids IS NOT NULL AND jsonb_typeof(message_ids) = 'array'::text AND jsonb_array_length(message_ids) = 2 AND finished_at IS NOT NULL",
      ),
    ),
  ],
);
