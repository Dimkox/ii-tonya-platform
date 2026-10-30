import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
/** Wave decision provenance, append-only and privacy checks are hand-authored in 0077. */
export const earlyBirdChoices = pgTable(
  "early_bird_choices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseId: uuid("base_id").notNull(),
    positiveChoiceId: uuid("positive_choice_id").notNull(),
    decisionNo: integer("decision_no").notNull().default(1),
    revision: integer("revision").notNull(),
    choice: text("choice").notNull(),
    requestKey: text("request_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    chosenAt: timestamp("chosen_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.baseId, t.requestKey),
    unique().on(t.baseId, t.decisionNo),
    unique().on(t.id, t.userId),
  ],
);
