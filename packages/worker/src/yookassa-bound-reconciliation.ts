import {
  YooKassaTerminalError,
  type YooKassaMode,
  type YooKassaOperationPort,
  type YooKassaPaymentVerifier,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";

export interface YooKassaBoundControl {
  accepting: boolean;
  credentialsUnavailable: boolean;
  deadline?: number;
}
export interface YooKassaBoundReconciliationDependencies {
  readonly enabled: boolean;
  readonly mode: YooKassaMode;
  readonly limit?: number;
  readonly now?: () => number;
  readonly control: YooKassaBoundControl;
  readonly operations: Pick<
    YooKassaOperationPort,
    "claimReconciliationBatch" | "resolve" | "findByProviderObject"
  >;
  readonly verifier: Pick<
    YooKassaPaymentVerifier,
    "verifyPayment" | "verifyRefund"
  >;
  readonly deliver: (
    event: VerifiedExpertResidencyPaymentEvent,
  ) => Promise<unknown>;
}
export const isYooKassaCredentialFailure = (error: unknown): boolean =>
  error instanceof YooKassaTerminalError &&
  (error.code === "yookassa_http_401" || error.code === "yookassa_http_403");

/** Claims are leased by PostgreSQL; no POST or immediate retry is performed here. */
export async function runYooKassaBoundReconciliation(
  deps: YooKassaBoundReconciliationDependencies,
) {
  const result = {
    claimed: 0,
    examined: 0,
    succeeded: 0,
    canceled: 0,
    pending: 0,
    failed: 0,
    reason: "completed" as
      | "completed"
      | "providers_disabled"
      | "closing"
      | "credentials_unavailable"
      | "claim_failed"
      | "budget_exhausted",
  };
  if (!deps.enabled)
    return { ...result, reason: "providers_disabled" as const };
  if (!deps.control.accepting) return { ...result, reason: "closing" as const };
  if (deps.control.credentialsUnavailable)
    return { ...result, reason: "credentials_unavailable" as const };
  const limit = deps.limit ?? 25;
  const now = deps.now ?? Date.now;
  deps.control.deadline = now() + 20_000;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 25 ||
    (deps.mode !== "test" && deps.mode !== "live")
  )
    throw new Error("yookassa_reconciliation_configuration_invalid");
  let operations;
  try {
    operations = await deps.operations.claimReconciliationBatch(
      limit,
      deps.mode,
    );
  } catch {
    return { ...result, reason: "claim_failed" as const };
  }
  result.claimed = Math.min(operations.length, limit);
  for (const operation of operations.slice(0, limit)) {
    if (!deps.control.accepting) {
      result.reason = "closing";
      break;
    }
    if (deps.control.credentialsUnavailable) {
      result.reason = "credentials_unavailable";
      break;
    }
    if (now() >= deps.control.deadline) {
      result.reason = "budget_exhausted";
      break;
    }
    result.examined++;
    if (
      operation.mode !== deps.mode ||
      !operation.providerObjectId ||
      !["pending", "unknown_outcome"].includes(operation.status)
    ) {
      result.failed++;
      continue;
    }
    try {
      const event =
        operation.kind === "create_payment"
          ? await deps.verifier.verifyPayment(operation)
          : await deps.verifier.verifyRefund(operation);
      if (event === null) {
        const current = await deps.operations.findByProviderObject(
          operation.providerObjectId,
          operation.kind,
        );
        if (current?.status === "canceled") result.canceled++;
        else result.pending++;
        continue;
      }
      await deps.deliver(event);
      await deps.operations.resolve(operation.id, "succeeded");
      result.succeeded++;
    } catch (error) {
      result.failed++;
      if (
        isYooKassaCredentialFailure(error) ||
        deps.control.credentialsUnavailable
      ) {
        deps.control.credentialsUnavailable = true;
        result.reason = "credentials_unavailable";
        break;
      }
      // Keep the existing lease/backoff, including delivery committed then threw.
      if (!deps.control.accepting) {
        result.reason = "closing";
        break;
      }
      if (now() >= deps.control.deadline) {
        result.reason = "budget_exhausted";
        break;
      }
    }
  }
  return result;
}
