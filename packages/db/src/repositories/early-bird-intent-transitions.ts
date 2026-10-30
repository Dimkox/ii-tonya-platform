import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { lockClientConsentSubject } from "./client-consent-authority.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Candidate-only transitions. A real sender still requires a proven first-send fence. */
export class PostgresEarlyBirdIntentTransitions {
  constructor(private readonly db: DrizzleDb) {}
  async markUnknown(input: {
    userId: string;
    intentId: string;
  }): Promise<boolean> {
    return this.transition(input, "unknown");
  }
  async abandon(input: { userId: string; intentId: string }): Promise<boolean> {
    return this.transition(input, "abandoned");
  }
  private async transition(
    input: { userId: string; intentId: string },
    target: "unknown" | "abandoned",
  ): Promise<boolean> {
    if (!uuid.test(input.userId) || !uuid.test(input.intentId))
      throw new Error("early_bird_intent_identity");
    return this.db.transaction(async (tx) => {
      await lockClientConsentSubject(tx, input.userId);
      const result = await tx.execute(
        sql`update early_bird_composite_intents set status=${target} where id=${input.intentId}::uuid and user_id=${input.userId}::uuid and status='prepared' returning id`,
      );
      return result.rows.length === 1;
    });
  }
}
