import {
  openDeferredRequest,
  type DeferredRequestSource,
} from "@ii-tonya/integrations";
import type { DeferredAdmittedSnapshot } from "./early-bird-deferred-send-admission.js";

/** Captures trusted, already scoped receipt material; authenticates the DB envelope before send admission commits. */
export function deferredRequestAuthenticator(
  source: DeferredRequestSource,
  receiptContactId: string,
  requestKey: Buffer,
  keyReference: string,
): (snapshot: DeferredAdmittedSnapshot) => string {
  const key = Buffer.from(requestKey);
  return (admitted) => {
    const s = source.snapshot;
    if (
      admitted.userId !== s.userId ||
      admitted.invoiceId !== s.invoiceId ||
      admitted.operationId !== s.operationId ||
      admitted.receiptContactId !== receiptContactId ||
      admitted.idempotencyKey !== source.idempotencyKey ||
      admitted.amountMinor !== s.amountMinor ||
      admitted.stage !== s.stage ||
      admitted.keyReference !== keyReference
    )
      throw new Error("early_bird_deferred_request_mismatch");
    return openDeferredRequest(
      source,
      {
        ciphertext: admitted.ciphertext,
        keyReference: admitted.keyReference,
        digest: admitted.digest,
      },
      key,
    );
  };
}
