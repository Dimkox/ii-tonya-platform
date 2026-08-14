import {
  expireExpertResidencyOrders,
  reconcileExpertResidencyPayments,
  replayHeldRewards,
  type ExpertResidencyExpiryRepository,
  type ExpertResidencyProviderReader,
  type ExpertResidencyReconciliationRepository,
  type HeldRewardRepository,
} from "@ii-tonya/worker";

export interface WorkerCycleReport {
  readonly safetyHandoffs: unknown;
  readonly expiredLeaseRecovery: unknown;
  readonly unknownOutcomeReconciliation: unknown;
  readonly reservationExpiry: unknown;
  readonly expertResidencyExpiry: unknown;
  readonly expertResidencyReconciliation: unknown;
  readonly expertReferralHoldReplay: unknown;
  readonly confirmedOutboxDelivery: unknown;
  readonly processorPrivacy: unknown;
  readonly providerReconciliation: unknown;
}

export interface WorkerRuntime {
  runOnce(): Promise<WorkerCycleReport>;
  close(): Promise<void>;
}

export const disabledExpertResidencyProviderReader: ExpertResidencyProviderReader =
  {
    async readPayments() {
      return { kind: "disabled" };
    },
  };

type BoundedJob = () => Promise<unknown>;

export interface WorkerRuntimeDependencies {
  /** Dedicated safety repository/dispatcher path; never a Planerka or intent-model call. */
  readonly safetyHandoffs: BoundedJob;
  readonly recoverExpiredLeases: BoundedJob;
  readonly reconcileUnknownOutcomes: BoundedJob;
  readonly reservationExpiry: BoundedJob;
  readonly expertResidencyExpiry: BoundedJob;
  readonly expertResidencyReconciliation: BoundedJob;
  readonly expertReferralHoldReplay: BoundedJob;
  readonly deliverConfirmedOutbox: BoundedJob;
  readonly processorPrivacy: BoundedJob;
  readonly providerReconciliation: BoundedJob;
  readonly closeDatabase: () => Promise<void>;
  readonly closeTelemetry: () => Promise<void>;
  readonly shutdownTimeoutMs?: number;
}

export interface ProductionWorkerRuntimeDependencies {
  readonly jobsRepository: {
    processDueBatch(command: {
      readonly now: Date;
      readonly batchSize: number;
    }): Promise<unknown>;
    expireDueBatch(command: {
      readonly now: Date;
      readonly batchSize: number;
    }): Promise<unknown>;
    listLocalReservations(
      window: { readonly from: string; readonly to: string },
      batchSize: number,
    ): Promise<readonly unknown[]>;
    recordProviderUnavailable(window: {
      readonly from: string;
      readonly to: string;
    }): Promise<void>;
    deliverSafetyEscalationsBatch(batchSize: number): Promise<unknown>;
  };
  readonly expertReferralJobsRepository: ExpertResidencyExpiryRepository &
    ExpertResidencyReconciliationRepository &
    HeldRewardRepository;
  readonly expertResidencyProviderReader?: ExpertResidencyProviderReader;
  readonly outboxRepository: {
    recoverExpiredDispatchLeases(limit: number): Promise<number>;
    recoverExpiredReconciliationLeases(limit: number): Promise<number>;
  };
  readonly closeDatabase: () => Promise<void>;
  readonly closeTelemetry: () => Promise<void>;
  readonly now: () => Date;
  readonly batchSize?: number;
  readonly shutdownTimeoutMs?: number;
}

function beforeDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return new Promise((resolveOperation, rejectOperation) => {
    const timer = setTimeout(() => {
      rejectOperation(new Error("Worker shutdown deadline exceeded"));
    }, milliseconds);
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolveOperation(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectOperation(error);
      },
    );
  });
}

export function createWorkerRuntime(
  deps: WorkerRuntimeDependencies,
): WorkerRuntime {
  const shutdownTimeoutMs = deps.shutdownTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 1 ||
    shutdownTimeoutMs > 60_000
  )
    throw new Error("Invalid worker shutdown timeout");
  let acceptingClaims = true;
  let currentCycle: Promise<WorkerCycleReport> | null = null;
  let closePromise: Promise<void> | null = null;

  const runOnce = (): Promise<WorkerCycleReport> => {
    if (!acceptingClaims) {
      return Promise.reject(new Error("Worker runtime is closing"));
    }
    if (currentCycle !== null) {
      return Promise.reject(new Error("Worker cycle is already running"));
    }
    const cycle = (async (): Promise<WorkerCycleReport> => {
      const safetyHandoffs = await deps.safetyHandoffs();
      const expiredLeaseRecovery = await deps.recoverExpiredLeases();
      const unknownOutcomeReconciliation =
        await deps.reconcileUnknownOutcomes();
      const reservationExpiry = await deps.reservationExpiry();
      const expertResidencyExpiry = await deps.expertResidencyExpiry();
      const expertResidencyReconciliation =
        await deps.expertResidencyReconciliation();
      const expertReferralHoldReplay = await deps.expertReferralHoldReplay();
      const confirmedOutboxDelivery = await deps.deliverConfirmedOutbox();
      const processorPrivacy = await deps.processorPrivacy();
      const providerReconciliation = await deps.providerReconciliation();
      return {
        safetyHandoffs,
        expiredLeaseRecovery,
        unknownOutcomeReconciliation,
        reservationExpiry,
        expertResidencyExpiry,
        expertResidencyReconciliation,
        expertReferralHoldReplay,
        confirmedOutboxDelivery,
        processorPrivacy,
        providerReconciliation,
      };
    })();
    currentCycle = cycle;
    void cycle
      .finally(() => {
        if (currentCycle === cycle) currentCycle = null;
      })
      .catch(() => undefined);
    return cycle;
  };

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    acceptingClaims = false;
    closePromise = (async () => {
      let failure: unknown;
      try {
        if (currentCycle !== null) {
          await beforeDeadline(currentCycle, shutdownTimeoutMs);
        }
      } catch (error) {
        failure = error;
      }
      try {
        await beforeDeadline(deps.closeDatabase(), shutdownTimeoutMs);
      } catch (error) {
        failure ??= error;
      }
      try {
        await beforeDeadline(deps.closeTelemetry(), shutdownTimeoutMs);
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    })();
    return closePromise;
  };

  return { runOnce, close };
}

export function createProductionWorkerRuntime(
  deps: ProductionWorkerRuntimeDependencies,
): WorkerRuntime {
  const batchSize = deps.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("Invalid production worker batch size");
  }
  const expertResidencyProviderReader =
    deps.expertResidencyProviderReader ?? disabledExpertResidencyProviderReader;
  return createWorkerRuntime({
    safetyHandoffs: async () =>
      deps.jobsRepository.processDueBatch({
        now: deps.now(),
        batchSize,
      }),
    recoverExpiredLeases: async () => ({
      dispatch:
        await deps.outboxRepository.recoverExpiredDispatchLeases(batchSize),
      reconciliation:
        await deps.outboxRepository.recoverExpiredReconciliationLeases(
          batchSize,
        ),
    }),
    reconcileUnknownOutcomes: async () => ({
      reconciled: 0,
      reason: "providers_disabled",
    }),
    reservationExpiry: async () =>
      deps.jobsRepository.expireDueBatch({
        now: deps.now(),
        batchSize,
      }),
    expertResidencyExpiry: async () =>
      expireExpertResidencyOrders(
        deps.expertReferralJobsRepository,
        deps.now(),
        batchSize,
      ),
    expertResidencyReconciliation: async () =>
      reconcileExpertResidencyPayments(
        deps.expertReferralJobsRepository,
        expertResidencyProviderReader,
        deps.now(),
        batchSize,
      ),
    expertReferralHoldReplay: async () =>
      replayHeldRewards(
        deps.expertReferralJobsRepository,
        deps.now(),
        batchSize,
      ),
    deliverConfirmedOutbox: async () =>
      deps.jobsRepository.deliverSafetyEscalationsBatch(batchSize),
    processorPrivacy: async () => ({
      processed: 0,
      reason: "privacy_capability_disabled",
    }),
    providerReconciliation: async () => ({
      examined: 0,
      matched: 0,
      mismatches: [],
      projectionRepairs: 0,
      provider: "disabled",
    }),
    closeDatabase: deps.closeDatabase,
    closeTelemetry: deps.closeTelemetry,
    ...(deps.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: deps.shutdownTimeoutMs }),
  });
}
