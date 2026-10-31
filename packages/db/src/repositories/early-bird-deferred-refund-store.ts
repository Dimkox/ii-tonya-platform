import { sql } from "drizzle-orm";
import {
  assertVerifiedDeferredRefund,
  type YooKassaDeferredRefundVerifier,
} from "@ii-tonya/integrations";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";
import { retryEarlyBirdSerialization } from "./early-bird-serialization-retry.js";
/** Separate binding and settlement principals; proof issuer is fixed per instance. */
export class PostgresDeferredRefundStore {
  constructor(
    private readonly bindingDb: DrizzleDb,
    private readonly settlementDb: DrizzleDb,
    private readonly verifier: YooKassaDeferredRefundVerifier,
    private readonly bindingLogin: string,
    private readonly settlementLogin: string,
    private readonly cancelDb: DrizzleDb,
    private readonly cancelLogin: string,
  ) {}
  async bind(value: unknown): Promise<void> {
    assertVerifiedDeferredRefund(value, this.verifier);
    if (value.status === "canceled")
      throw new Error("early_bird_deferred_refund_canceled");
    await retryEarlyBirdSerialization(() =>
      this.bindingDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.bindingLogin,
            "ii_tonya_deferred_refund_binding",
            "public.early_bird_deferred_bind_refund(uuid,uuid,text,text,bigint,text)",
          );
          await tx.execute(
            sql`select early_bird_deferred_bind_refund(${value.invoiceId}::uuid,${value.userId}::uuid,${value.providerPaymentId},${value.providerRefundId},${value.refundAmountMinor}::bigint,${value.evidenceDigest})`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
  async commit(value: unknown): Promise<void> {
    assertVerifiedDeferredRefund(value, this.verifier);
    if (value.status !== "succeeded")
      throw new Error("early_bird_deferred_refund_unsettled");
    await retryEarlyBirdSerialization(() =>
      this.settlementDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.settlementLogin,
            "ii_tonya_deferred_refund_settlement",
            "public.early_bird_deferred_commit_refund(uuid,uuid,text,text,bigint,text)",
          );
          await tx.execute(
            sql`select early_bird_deferred_commit_refund(${value.invoiceId}::uuid,${value.userId}::uuid,${value.providerPaymentId},${value.providerRefundId},${value.refundAmountMinor}::bigint,${value.evidenceDigest})`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
  async cancel(value: unknown): Promise<void> {
    assertVerifiedDeferredRefund(value, this.verifier);
    if (value.status !== "canceled")
      throw new Error("early_bird_deferred_refund_not_canceled");
    await retryEarlyBirdSerialization(() =>
      this.cancelDb.transaction(
        async (tx) => {
          await requireDeferredPrincipal(
            tx,
            this.cancelLogin,
            "ii_tonya_deferred_refund_cancel",
            "public.early_bird_deferred_cancel_refund(uuid,uuid,text,text,bigint,text)",
          );
          await tx.execute(
            sql`select early_bird_deferred_cancel_refund(${value.invoiceId}::uuid,${value.userId}::uuid,${value.providerPaymentId},${value.providerRefundId},${value.refundAmountMinor}::bigint,${value.evidenceDigest})`,
          );
        },
        { isolationLevel: "serializable" },
      ),
    );
  }
}
