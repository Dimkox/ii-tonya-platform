import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { consents } from "./identity.js";
import { integrationOutbox } from "./integration.js";

export const bookingHandoffRevocationReceipts = pgTable(
  "booking_handoff_revocation_receipts",
  {
    sourceOutboxId: uuid("source_outbox_id")
      .primaryKey()
      .references(() => integrationOutbox.id),
    consentDecisionId: uuid("consent_decision_id").references(
      () => consents.id,
    ),
    outcome: text("outcome").notNull(),
    coverage: text("coverage").notNull(),
    // Actionable KNOWN recipients only; historical disclosure remains untracked.
    knownRecipientCount: integer("known_recipient_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "booking_handoff_revocation_outcome_check",
      sql`(${table.outcome} = 'processed' and ${table.consentDecisionId} is not null and ${table.coverage} = 'historical_disclosure_untracked') or (${table.outcome} = 'quarantined_invalid' and ${table.consentDecisionId} is null and ${table.coverage} = 'invalid_source') or (${table.outcome} = 'quarantined_legacy' and ${table.consentDecisionId} is not null and ${table.coverage} = 'historical_disclosure_untracked')`,
    ),
    check(
      "booking_handoff_revocation_recipient_count_check",
      sql`${table.knownRecipientCount} = 0`,
    ),
  ],
);
