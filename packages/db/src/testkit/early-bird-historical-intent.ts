import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "./expert-referral.js";
import { replayMigrationsThrough } from "./replay-migrations-through.js";

/**
 * Historical draft characterization only. Canonical runtime coverage must use
 * the full committed migration chain, never this pre-0081 fixture.
 */
export async function startHistoricalEarlyBirdIntentDatabase(): Promise<ExpertReferralTestDatabase> {
  return startExpertReferralTestDatabase(async (db) => {
    await replayMigrationsThrough(db, 80);
    const state = await db.execute<{ absent: boolean }>(
      sql`select to_regclass('public.early_bird_composite_intents') is null as absent`,
    );
    if (state.rows[0]?.absent !== true)
      throw new Error("historical_early_bird_intent_requires_pre_0081_schema");
    await db.execute(
      sql.raw(
        readFileSync(
          "docs/superpowers/implementation-artifacts/drafts/0078_early_bird_intents.sql",
          "utf8",
        ),
      ),
    );
  });
}
