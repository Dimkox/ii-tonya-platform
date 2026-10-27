export interface PendingErasureRequest {
  id: string;
  userId: string;
}

/** Compose execution only after the operator's capture/verifier/custody and
 * retention gates pass. This runner never infers historical copies from flags. */
export async function runErasureRequests(deps: {
  repository: {
    pendingRequests(limit: number): Promise<PendingErasureRequest[]>;
  };
  execution?: { begin(request: PendingErasureRequest): Promise<unknown> };
  batchSize?: number;
}) {
  if (!deps.execution)
    return {
      started: 0,
      awaitingExecution: 0,
      reason: "execution_prerequisites_unbound",
    };
  const limit = deps.batchSize ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("invalid_erasure_batch");
  let started = 0;
  let awaitingExecution = 0;
  for (const request of await deps.repository.pendingRequests(limit)) {
    try {
      await deps.execution.begin(request);
      started++;
    } catch {
      awaitingExecution++;
    }
  }
  return { started, awaitingExecution };
}
