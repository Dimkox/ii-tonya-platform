/**
 * Composition boundary only. A gateway implementation must durably cancel
 * pending writes and fence bypasses; this interface does not attest to that.
 */
export class CancellationUncertain<T> extends Error {
  constructor(
    readonly mutationResult: T,
    cause: unknown,
  ) {
    super("gateway cancellation uncertain", { cause });
  }
}

export interface ReceiptDisclosureCancellation {
  revokeUser(userId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createReceiptDisclosureBoundary(options: {
  checkoutEnabled: boolean;
  gateway?: ReceiptDisclosureCancellation;
}) {
  const gateway = options.gateway;
  if (options.checkoutEnabled && !gateway)
    throw new Error("receipt disclosure cancellation gateway required");

  async function guarded<T>(
    cancel: (() => Promise<void>) | undefined,
    mutate: () => Promise<T>,
    stopOnFailure: boolean,
  ): Promise<T> {
    if (!options.checkoutEnabled) return mutate();
    try {
      await cancel!();
    } catch (error) {
      // Failure of the per-user cancellation must attempt a global stop.
      const failures: unknown[] = [error];
      if (stopOnFailure && gateway) {
        try {
          await gateway.stopAll();
        } catch (stopError) {
          failures.push(stopError);
        }
      }
      let mutationResult: T;
      try {
        mutationResult = await mutate();
      } catch (mutationError) {
        throw new AggregateError(
          [...failures, mutationError],
          "gateway cancellation and privacy mutation failed",
        );
      }
      throw new CancellationUncertain(
        mutationResult,
        failures.length === 1 ? error : new AggregateError(failures),
      );
    }
    return mutate();
  }

  return {
    withdraw<T>(userId: string, mutate: () => Promise<T>): Promise<T> {
      return guarded(
        gateway && (() => gateway.revokeUser(userId)),
        mutate,
        true,
      );
    },
    cleanup<T>(mutate: () => Promise<T>): Promise<T> {
      return guarded(gateway && (() => gateway.stopAll()), mutate, false);
    },
  };
}
