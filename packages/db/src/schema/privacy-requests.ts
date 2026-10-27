import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { privacyDeletionJobs } from "./audit.js";

export const clientErasureRequests = pgTable(
  "client_erasure_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    receiptDigest: text("receipt_digest").notNull(),
    receiptRevokedAt: timestamp("receipt_revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    jobId: uuid("job_id"),
  },
  (table) => [
    foreignKey({
      name: "client_erasure_requests_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    unique("client_erasure_requests_subject_unique").on(table.userId),
    unique("client_erasure_requests_digest_unique").on(table.receiptDigest),
    unique("client_erasure_requests_job_unique").on(table.jobId),
    check(
      "client_erasure_requests_digest_check",
      sql`${table.receiptDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "client_erasure_requests_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
    foreignKey({
      name: "client_erasure_requests_job_subject_fk",
      columns: [table.jobId, table.userId],
      foreignColumns: [privacyDeletionJobs.id, privacyDeletionJobs.userId],
    }),
  ],
);
