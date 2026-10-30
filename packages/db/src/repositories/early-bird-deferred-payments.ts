import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";

/** Separate audited principals create a scoped account and one immutable invoice per stage. */
export class PostgresEarlyBirdDeferredPayments {
  constructor(
    private readonly prepareDb: DrizzleDb,
    private readonly invoiceDb: DrizzleDb,
    private readonly prepareLogin: string,
    private readonly invoiceLogin: string,
  ) {}
  async prepare(input: {
    accountId: string;
    userId: string;
    baseId: string;
    choiceId: string;
    configId: string;
  }): Promise<void> {
    await retryEarlyBirdSerialization(() =>
      this.prepareDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.prepareLogin,
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
  async invoice(input: {
    accountId: string;
    userId: string;
    invoiceId: string;
    idempotencyKey: string;
    stage: "onboarding" | "subscription";
  }): Promise<bigint> {
    return retryEarlyBirdSerialization(() =>
      this.invoiceDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.invoiceLogin,
            "ii_tonya_deferred_invoice_writer",
            "public.early_bird_deferred_invoice(uuid,uuid,uuid,uuid,text)",
          );
          const result = await tx.execute<{ amount: string }>(
            sql`select early_bird_deferred_invoice(${input.accountId}::uuid,${input.userId}::uuid,${input.invoiceId}::uuid,${input.idempotencyKey}::uuid,${input.stage})::text as amount`,
          );
          return BigInt(result.rows[0]!.amount);
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
}
