import { sql } from "drizzle-orm";
import {
  assertVerifiedDeferredPayment,
  type YooKassaDeferredVerifier,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";

/** Separate restricted logins are mandatory; no application login receives either capability. */
export class PostgresDeferredVerifiedStore {
  constructor(
    private readonly bindingDb: DrizzleDb,
    private readonly settlementDb: DrizzleDb,
    private readonly verifier: YooKassaDeferredVerifier,
    private readonly bindingLogin: string,
    private readonly settlementLogin: string,
  ) {}
  async bind(value: unknown): Promise<void> {
    assertVerifiedDeferredPayment(value, this.verifier);
    await retryEarlyBirdSerialization(() =>
      this.bindingDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.bindingLogin,
            "ii_tonya_deferred_binding_writer",
            "public.early_bird_deferred_bind_verified(uuid,uuid,text,bigint,text)",
          );
          await tx.execute(
            sql`select early_bird_deferred_bind_verified(${value.invoiceId}::uuid,${value.userId}::uuid,${value.providerId},${value.amountMinor}::bigint,${value.evidenceDigest})`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
  async commit(value: unknown): Promise<void> {
    assertVerifiedDeferredPayment(value, this.verifier);
    if (value.status !== "succeeded" || !value.capturedAt)
      throw new Error("early_bird_deferred_payment_unpaid");
    await retryEarlyBirdSerialization(() =>
      this.settlementDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.settlementLogin,
            "ii_tonya_deferred_settlement_writer",
            "public.early_bird_deferred_commit_verified(uuid,uuid,text,bigint,text,timestamp with time zone)",
          );
          await tx.execute(
            sql`select early_bird_deferred_commit_verified(${value.invoiceId}::uuid,${value.userId}::uuid,${value.providerId},${value.amountMinor}::bigint,${value.evidenceDigest},${value.capturedAt}::timestamptz)`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
}
