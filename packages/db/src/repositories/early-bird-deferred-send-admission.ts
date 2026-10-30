import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireDeferredPrincipal } from "./early-bird-deferred-principal.js";

export type DeferredAdmittedSnapshot = Readonly<{
  kind: "initial_send_admitted";
  userId: string;
  invoiceId: string;
  operationId: string;
  receiptContactId: string;
  idempotencyKey: string;
  amountMinor: string;
  stage: "onboarding" | "subscription";
  digest: string;
  ciphertext: string;
  keyReference: string;
}>;
/** Default-off capability. authenticate must decrypt and independently rebuild the
 * canonical fiscal request. No network occurs inside this transaction. */
export class PostgresDeferredSendAdmission {
  constructor(
    private readonly db: DrizzleDb,
    private readonly expectedLogin: string,
    private readonly authenticate: (
      snapshot: DeferredAdmittedSnapshot,
    ) => string,
  ) {}
  async admit(input: {
    userId: string;
    invoiceId: string;
    receiptContactId: string;
  }): Promise<
    | { kind: "unavailable" }
    | { kind: "reconcile"; invoiceId: string }
    | (Omit<DeferredAdmittedSnapshot, "ciphertext" | "keyReference"> & {
        body: string;
      })
  > {
    return this.db.transaction(
      async (tx) => {
        await requireDeferredPrincipal(
          tx,
          this.expectedLogin,
          "ii_tonya_deferred_sender",
          "public.early_bird_deferred_admit_send(uuid,uuid,uuid)",
        );
        const data = (
          await tx.execute<{
            data:
              | DeferredAdmittedSnapshot
              | { kind: "reconcile"; invoiceId: string }
              | null;
          }>(
            sql`select early_bird_deferred_admit_send(${input.userId}::uuid,${input.invoiceId}::uuid,${input.receiptContactId}::uuid) as data`,
          )
        ).rows[0]?.data;
        if (!data) return { kind: "unavailable" };
        if (data.invoiceId !== input.invoiceId)
          throw new Error("early_bird_deferred_admission_mismatch");
        if (data.kind === "reconcile") return data;
        if (
          data.kind !== "initial_send_admitted" ||
          data.userId !== input.userId ||
          data.receiptContactId !== input.receiptContactId ||
          data.operationId !== data.invoiceId
        )
          throw new Error("early_bird_deferred_admission_mismatch");
        const body = this.authenticate(data);
        if (
          typeof body !== "string" ||
          data.digest !==
            `sha256:${createHash("sha256").update(body).digest("hex")}`
        )
          throw new Error("early_bird_deferred_request_mismatch");
        return {
          kind: data.kind,
          userId: data.userId,
          invoiceId: data.invoiceId,
          operationId: data.operationId,
          receiptContactId: data.receiptContactId,
          idempotencyKey: data.idempotencyKey,
          amountMinor: data.amountMinor,
          stage: data.stage,
          digest: data.digest,
          body,
        };
      },
      { isolationLevel: "serializable" },
    );
  }
}
