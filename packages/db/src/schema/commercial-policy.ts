import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { adminApprovals, adminSessions } from "./audit.js";
import { users } from "./identity.js";

export const clientCommercialPolicyControls = pgTable(
  "client_commercial_policy_controls",
  {
    controlKey: text("control_key").primaryKey(),
    admissionPolicy: text("admission_policy").notNull(),
    version: integer("version").notNull(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => adminApprovals.id),
    adminSessionIdHash: text("admin_session_id_hash")
      .notNull()
      .references(() => adminSessions.sessionIdHash),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "client_commercial_policy_control_key",
      sql`${table.controlKey}='client_access'`,
    ),
    check(
      "client_commercial_policy_control_policy",
      sql`${table.admissionPolicy} in ('legacy_package_v1','free_client_v2')`,
    ),
    check("client_commercial_policy_control_version", sql`${table.version}>0`),
    unique("client_commercial_policy_control_approval_unique").on(
      table.approvalId,
    ),
  ],
);
export const clientCommercialPolicyAssignments = pgTable(
  "client_commercial_policy_assignments",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    policyVersion: text("policy_version").notNull(),
    controlVersion: integer("control_version").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "client_commercial_policy_assignment_policy",
      sql`${table.policyVersion} in ('legacy_package_v1','free_client_v2')`,
    ),
    check(
      "client_commercial_policy_assignment_version",
      sql`${table.controlVersion}>0`,
    ),
  ],
);
