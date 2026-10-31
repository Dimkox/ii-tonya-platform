import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";
import type { PostgresEarlyBirdDeferredPayments } from "./early-bird-deferred-payments.js";
/** Review worker gets account preparation only, never invoice or provider capabilities. */
export class PostgresDeferredAccountWriter {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
  ) {}
  async prepare(
    input: Parameters<PostgresEarlyBirdDeferredPayments["prepare"]>[0],
  ): Promise<void> {
    await retryEarlyBirdSerialization(() =>
      this.db.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.expectedLogin,
            "ii_tonya_deferred_account_writer",
            "public.early_bird_deferred_prepare(uuid,uuid,uuid,uuid,uuid)",
          );
          await tx.execute(
            sql`select early_bird_deferred_prepare(${input.accountId}::uuid,${input.userId}::uuid,${input.baseId}::uuid,${input.choiceId}::uuid,${input.configId}::uuid)`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
}
