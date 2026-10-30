import { createHash } from "node:crypto";
import type { YooKassaClient } from "./client.js";
import {
  YooKassaDeferredVerifier,
  type VerifiedDeferredPayment,
} from "./early-bird-deferred-verifier.js";

export type DeferredAdmission =
  | { kind: "unavailable" }
  | { kind: "reconcile"; invoiceId: string }
  | {
      kind: "initial_send_admitted";
      userId: string;
      receiptContactId: string;
      invoiceId: string;
      operationId: string;
      idempotencyKey: string;
      digest: string;
      body: string;
      amountMinor: string;
      stage: "onboarding" | "subscription";
    };

/** Draft-only. The admission port must commit the dispatch marker and authenticate
 * an immutable request. Until PostgreSQL admission and receipt fencing exist this
 * sender is not safe to compose or enable. */
export class EarlyBirdDeferredCheckoutSender {
  readonly strictFirstSendCancellation = false as const;
  constructor(
    private readonly options: {
      enabled?: boolean;
      admission: {
        admit(input: {
          userId: string;
          invoiceId: string;
          receiptContactId: string;
        }): Promise<DeferredAdmission>;
      };
      gateway: {
        dispatch(
          receiptContactId: string,
          attempt: string,
          request: Uint8Array,
          context: {
            userId: string;
            intentId: string;
            contactId: string;
            idempotencyKey: string;
          },
        ): Promise<
          | { kind: "unknown" | "cancelled" }
          | { kind: "response"; paymentId: string }
        >;
      };
      verifier: YooKassaDeferredVerifier;
      binding: { bind(proof: VerifiedDeferredPayment): Promise<void> };
      client: Pick<YooKassaClient, "getPayment">;
    },
  ) {}
  async createOrRecover(input: {
    userId: string;
    invoiceId: string;
    receiptContactId: string;
  }): Promise<
    | { kind: "unavailable" }
    | { kind: "reconcile"; invoiceId: string }
    | { kind: "bound"; invoiceId: string; paymentId: string }
    | {
        kind: "ready";
        invoiceId: string;
        paymentId: string;
        confirmationUrl: string;
      }
  > {
    if (this.options.enabled !== true) return { kind: "unavailable" };
    const admitted = await this.options.admission.admit(input);
    if (admitted.kind !== "initial_send_admitted") return admitted;
    if (
      admitted.userId !== input.userId ||
      admitted.receiptContactId !== input.receiptContactId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        admitted.receiptContactId,
      ) ||
      admitted.invoiceId !== input.invoiceId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        admitted.idempotencyKey,
      ) ||
      !/^sha256:[0-9a-f]{64}$/u.test(admitted.digest) ||
      admitted.digest !==
        `sha256:${createHash("sha256").update(admitted.body).digest("hex")}`
    )
      return { kind: "reconcile", invoiceId: input.invoiceId };
    const attempt = createHash("sha256")
      .update(Buffer.from(admitted.idempotencyKey.replaceAll("-", ""), "hex"))
      .digest("hex");
    const body = Buffer.from(admitted.body, "utf8");
    const request = Buffer.concat([
      Buffer.from(
        `POST /v3/payments HTTP/1.1\r\nHost: api.yookassa.ru\r\nIdempotence-Key: ${admitted.idempotencyKey}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
        "ascii",
      ),
      body,
    ]);
    try {
      const result = await this.options.gateway.dispatch(
        admitted.receiptContactId,
        attempt,
        request,
        {
          userId: admitted.userId,
          intentId: admitted.operationId,
          contactId: admitted.receiptContactId,
          idempotencyKey: admitted.idempotencyKey,
        },
      );
      if (result.kind !== "response")
        return { kind: "reconcile", invoiceId: input.invoiceId };
      const proof = await this.options.verifier.verify(
        admitted.invoiceId,
        result.paymentId,
      );
      if (
        proof.userId !== admitted.userId ||
        proof.operationId !== admitted.operationId ||
        proof.amountMinor !== admitted.amountMinor ||
        proof.stage !== admitted.stage
      )
        throw new Error("early_bird_deferred_binding_mismatch");
      await this.options.binding.bind(proof);
      const observed = await this.options.client.getPayment(proof.providerId);
      const match = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(observed.amount.value);
      if (
        !match ||
        BigInt(match[1]!) * 100n + BigInt(match[2]!) !==
          BigInt(proof.amountMinor) ||
        observed.id !== proof.providerId ||
        observed.test !== (proof.mode === "test") ||
        observed.amount.currency !== "RUB" ||
        observed.metadata?.order_id !== proof.invoiceId ||
        observed.metadata?.operation_id !== proof.operationId ||
        observed.metadata?.user_id !== proof.userId ||
        observed.metadata?.purpose !== "early_bird_deferred" ||
        observed.metadata?.stage !== proof.stage ||
        observed.metadata?.pricing_policy !== proof.policy ||
        (proof.grantId && observed.metadata?.pricing_grant_id !== proof.grantId)
      )
        throw new Error("early_bird_deferred_confirmation_mismatch");
      if (
        observed.status === "pending" &&
        observed.paid === false &&
        observed.confirmation
      ) {
        const url = new URL(observed.confirmation.url);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "yoomoney.ru" ||
          url.port !== "" ||
          url.username ||
          url.password ||
          url.hash ||
          url.href.length > 2048
        )
          throw new Error("early_bird_deferred_confirmation_invalid");
        return {
          kind: "ready",
          invoiceId: input.invoiceId,
          paymentId: proof.providerId,
          confirmationUrl: url.href,
        };
      }
      return {
        kind: "bound",
        invoiceId: input.invoiceId,
        paymentId: proof.providerId,
      };
    } catch {
      return { kind: "reconcile", invoiceId: input.invoiceId };
    }
  }
}
