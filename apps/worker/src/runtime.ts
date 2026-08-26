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
  readonly clientConversationCleanup: unknown;
  readonly clientConversationReconciliation: unknown;
  readonly clientConversationDispatch: unknown;
  readonly expiredLeaseRecovery: unknown;
  readonly unknownOutcomeReconciliation: unknown;
  readonly reservationExpiry: unknown;
  readonly expertResidencyExpiry: unknown;
  readonly expertTelegramCheckoutCleanup: unknown;
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

export interface ClientConversationRuntimeJobs {
  readonly dispatch: BoundedJob;
  readonly reconciliation: BoundedJob;
  readonly cleanup: BoundedJob;
  readonly runtimeLeases: {
    assertReady(): void;
    stop(): Promise<void>;
  };
}

export interface WorkerRuntimeDependencies {
  /** Dedicated safety repository/dispatcher path; never a Planerka or intent-model call. */
  readonly safetyHandoffs: BoundedJob;
  readonly recoverExpiredLeases: BoundedJob;
  readonly reconcileUnknownOutcomes: BoundedJob;
  readonly reservationExpiry: BoundedJob;
  readonly expertResidencyExpiry: BoundedJob;
  readonly expertTelegramCheckoutCleanup: BoundedJob;
  readonly expertResidencyReconciliation: BoundedJob;
  readonly expertReferralHoldReplay: BoundedJob;
  readonly deliverConfirmedOutbox: BoundedJob;
  readonly processorPrivacy: BoundedJob;
  readonly providerReconciliation: BoundedJob;
  readonly clientConversation?: ClientConversationRuntimeJobs;
  readonly closeDatabase: () => Promise<void>;
  readonly closeTelemetry: () => Promise<void>;
  readonly shutdownTimeoutMs?: number;
}

export interface ProductionWorkerRuntimeDependencies {
  readonly workerOutboxRegistry?: Readonly<{
    readonly topics: readonly string[];
  }>;
  readonly workerOutboxRunner?: BoundedJob;
  readonly clientCatalogRetention?: BoundedJob;
  readonly clientSessionRetention?: BoundedJob;
  readonly clientBookingErasure?: BoundedJob;
  readonly clientConversation?: ClientConversationRuntimeJobs;
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
    materializeOperatorCasesBatch(batchSize: number): Promise<unknown>;
  };
  readonly expertReferralJobsRepository: ExpertResidencyExpiryRepository &
    ExpertResidencyReconciliationRepository &
    HeldRewardRepository;
  readonly expertTelegramCheckoutRepository: {
    clearExpiredCheckoutUrls(now: Date, limit: number): Promise<number>;
  };
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
      deps.clientConversation?.runtimeLeases.assertReady();
      const safetyHandoffs = await deps.safetyHandoffs();
      const clientConversationCleanup =
        deps.clientConversation === undefined
          ? { processed: 0, reason: "capability_disabled" }
          : await deps.clientConversation.cleanup();
      const clientConversationReconciliation =
        deps.clientConversation === undefined
          ? { processed: 0, reason: "capability_disabled" }
          : await deps.clientConversation.reconciliation();
      const clientConversationDispatch =
        deps.clientConversation === undefined
          ? { processed: 0, reason: "capability_disabled" }
          : await deps.clientConversation.dispatch();
      const expiredLeaseRecovery = await deps.recoverExpiredLeases();
      const unknownOutcomeReconciliation =
        await deps.reconcileUnknownOutcomes();
      const reservationExpiry = await deps.reservationExpiry();
      const expertResidencyExpiry = await deps.expertResidencyExpiry();
      const expertTelegramCheckoutCleanup =
        await deps.expertTelegramCheckoutCleanup();
      const expertResidencyReconciliation =
        await deps.expertResidencyReconciliation();
      const expertReferralHoldReplay = await deps.expertReferralHoldReplay();
      const confirmedOutboxDelivery = await deps.deliverConfirmedOutbox();
      const processorPrivacy = await deps.processorPrivacy();
      const providerReconciliation = await deps.providerReconciliation();
      return {
        safetyHandoffs,
        clientConversationCleanup,
        clientConversationReconciliation,
        clientConversationDispatch,
        expiredLeaseRecovery,
        unknownOutcomeReconciliation,
        reservationExpiry,
        expertResidencyExpiry,
        expertTelegramCheckoutCleanup,
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
        if (deps.clientConversation !== undefined) {
          await beforeDeadline(
            deps.clientConversation.runtimeLeases.stop(),
            shutdownTimeoutMs,
          );
        }
      } catch (error) {
        failure = error;
      }
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
  const workerOutboxEnabled = deps.workerOutboxRegistry !== undefined;
  if (workerOutboxEnabled !== (deps.workerOutboxRunner !== undefined)) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  return createWorkerRuntime({
    safetyHandoffs: async () =>
      deps.jobsRepository.processDueBatch({
        now: deps.now(),
        batchSize,
      }),
    recoverExpiredLeases: workerOutboxEnabled
      ? async () => ({
          dispatch: 0,
          reconciliation: 0,
          reason: "owned_by_filtered_runner",
        })
      : async () => ({
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
    expertTelegramCheckoutCleanup: async () => ({
      cleared:
        await deps.expertTelegramCheckoutRepository.clearExpiredCheckoutUrls(
          deps.now(),
          batchSize,
        ),
    }),
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
    deliverConfirmedOutbox: workerOutboxEnabled
      ? deps.workerOutboxRunner!
      : async () =>
          deps.jobsRepository.materializeOperatorCasesBatch(batchSize),
    processorPrivacy:
      deps.clientCatalogRetention === undefined &&
      deps.clientSessionRetention === undefined &&
      deps.clientBookingErasure === undefined
        ? async () => ({
            processed: 0,
            reason: "privacy_capability_disabled",
          })
        : async () => ({
            ...(deps.clientCatalogRetention === undefined
              ? {}
              : { clientCatalog: await deps.clientCatalogRetention() }),
            ...(deps.clientSessionRetention === undefined
              ? {}
              : { clientSession: await deps.clientSessionRetention() }),
            ...(deps.clientBookingErasure === undefined
              ? {}
              : { clientBooking: await deps.clientBookingErasure() }),
          }),
    providerReconciliation: async () => ({
      examined: 0,
      matched: 0,
      mismatches: [],
      projectionRepairs: 0,
      provider: "disabled",
    }),
    ...(deps.clientConversation === undefined
      ? {}
      : { clientConversation: deps.clientConversation }),
    closeDatabase: deps.closeDatabase,
    closeTelemetry: deps.closeTelemetry,
    ...(deps.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: deps.shutdownTimeoutMs }),
  });
}
