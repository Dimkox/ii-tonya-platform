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
  readonly bookingHandoffRevocations?: unknown;
  readonly bookingNotifications?: unknown;
  readonly expertCardMaterials?: unknown;
  readonly residentWorkspaceNotifications?: unknown;
  readonly expertResidencyLifecycle?: unknown;
  readonly expertPersonalOffers?: unknown;
  readonly expertSeparatedSales?: unknown;
  readonly safetyHandoffs: unknown;
  readonly expiredLeaseRecovery: unknown;
  readonly unknownOutcomeReconciliation: unknown;
  readonly reservationExpiry: unknown;
  readonly expertResidencyExpiry: unknown;
  readonly expertTelegramCheckoutCleanup: unknown;
  readonly expertResidencyReconciliation: unknown;
  readonly expertReferralHoldReplay: unknown;
  readonly expertReferralMaturity: unknown;
  readonly confirmedOutboxDelivery: unknown;
  readonly processorPrivacy: unknown;
  readonly providerReconciliation: unknown;
  readonly testExpertReconciliation: unknown;
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
interface BookingNotificationLifecycle {
  runOnce(): Promise<unknown>;
  stopAccepting(): void;
  drain(deadline: number): Promise<void>;
}

export interface WorkerRuntimeDependencies {
  readonly bookingHandoffRevocations?: BoundedJob;
  readonly bookingNotifications?: BookingNotificationLifecycle;
  readonly residentWorkspaceNotifications?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertCardMaterials?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertSeparatedSales?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertPersonalOffers?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertResidencyLifecycle?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  /** Dedicated safety repository/dispatcher path; never a Planerka or intent-model call. */
  readonly safetyHandoffs: BoundedJob;
  readonly recoverExpiredLeases: BoundedJob;
  readonly reconcileUnknownOutcomes: BoundedJob;
  readonly stopRecovery?: () => void;
  readonly reservationExpiry: BoundedJob;
  readonly expertResidencyExpiry: BoundedJob;
  readonly expertTelegramCheckoutCleanup: BoundedJob;
  readonly expertResidencyReconciliation: BoundedJob;
  readonly expertReferralHoldReplay: BoundedJob;
  readonly expertReferralMaturity?: BoundedJob;
  readonly deliverConfirmedOutbox: BoundedJob;
  readonly processorPrivacy: BoundedJob;
  readonly providerReconciliation: BoundedJob;
  readonly testExpertReconciliation?: BoundedJob;
  readonly closeDatabase: () => Promise<void>;
  readonly closeTelemetry: () => Promise<void>;
  readonly shutdownTimeoutMs?: number;
}

export interface ProductionWorkerRuntimeDependencies {
  readonly yookassaBoundRecovery?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
    unavailableReason(): string | undefined;
  };
  readonly bookingHandoffRevocations?: BoundedJob;
  readonly bookingNotifications?: BookingNotificationLifecycle;
  readonly residentWorkspaceNotifications?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertCardMaterials?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertSeparatedSales?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertPersonalOffers?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly expertResidencyLifecycle?: {
    runOnce(): Promise<unknown>;
    stopAccepting(): void;
  };
  readonly planerkaBookingRunner?: BoundedJob;
  readonly clientAsyncOutboxRunner?: BoundedJob;
  readonly workerOutboxRegistry?: Readonly<{
    readonly topics: readonly string[];
  }>;
  readonly workerOutboxRunner?: BoundedJob;
  readonly clientCatalogRetention?: BoundedJob;
  readonly clientSessionRetention?: BoundedJob;
  readonly expertSessionRetention?: BoundedJob;
  readonly payerReceiptRetention?: BoundedJob;
  readonly clientBookingErasure?: BoundedJob;
  readonly clientErasureRequests?: BoundedJob;
  readonly testExpertReconciliation?: BoundedJob;
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
    HeldRewardRepository & {
      grantDueMaturityBatch?(command: {
        now: Date;
        batchSize: number;
      }): Promise<unknown>;
    };
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
  readonly expertReferralMaturityWorkerEnabled?: boolean;
  readonly expertReferralMaturityMetrics?: {
    record(
      outcome: "examined" | "granted" | "cancelled" | "retry" | "failed",
      count?: number,
    ): void;
  };
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
      const bookingHandoffRevocations = acceptingClaims
        ? await deps.bookingHandoffRevocations?.()
        : undefined;
      const expiredLeaseRecovery = await deps.recoverExpiredLeases();
      const unknownOutcomeReconciliation = acceptingClaims
        ? await deps.reconcileUnknownOutcomes()
        : { reconciled: 0, reason: "closing" };
      const reservationExpiry = await deps.reservationExpiry();
      const expertResidencyExpiry = await deps.expertResidencyExpiry();
      const expertTelegramCheckoutCleanup =
        await deps.expertTelegramCheckoutCleanup();
      const expertResidencyReconciliation =
        await deps.expertResidencyReconciliation();
      const expertSeparatedSales = acceptingClaims
        ? await deps.expertSeparatedSales?.runOnce()
        : undefined;
      const expertPersonalOffers = acceptingClaims
        ? await deps.expertPersonalOffers?.runOnce()
        : undefined;
      const expertResidencyLifecycle = acceptingClaims
        ? await deps.expertResidencyLifecycle?.runOnce()
        : undefined;
      const expertReferralHoldReplay = await deps.expertReferralHoldReplay();
      const expertReferralMaturity =
        (await deps.expertReferralMaturity?.()) ?? {
          examined: 0,
          granted: 0,
          cancelled: 0,
          pending: 0,
          reason: "maturity_capability_unavailable",
        };
      const confirmedOutboxDelivery = await deps.deliverConfirmedOutbox();
      const bookingNotifications = acceptingClaims
        ? await deps.bookingNotifications?.runOnce()
        : undefined;
      const residentWorkspaceNotifications = acceptingClaims
        ? await deps.residentWorkspaceNotifications?.runOnce()
        : undefined;
      const expertCardMaterials = acceptingClaims
        ? await deps.expertCardMaterials?.runOnce()
        : undefined;
      const processorPrivacy = await deps.processorPrivacy();
      const providerReconciliation = await deps.providerReconciliation();
      const testExpertReconciliation =
        (await deps.testExpertReconciliation?.()) ?? {
          scanned: 0,
          reason: "test_expert_reconciliation_disabled",
        };
      return {
        ...(bookingHandoffRevocations === undefined
          ? {}
          : { bookingHandoffRevocations }),
        ...(bookingNotifications === undefined ? {} : { bookingNotifications }),
        ...(expertCardMaterials === undefined ? {} : { expertCardMaterials }),
        ...(residentWorkspaceNotifications === undefined
          ? {}
          : { residentWorkspaceNotifications }),
        ...(expertSeparatedSales === undefined ? {} : { expertSeparatedSales }),
        ...(expertPersonalOffers === undefined ? {} : { expertPersonalOffers }),
        ...(expertResidencyLifecycle === undefined
          ? {}
          : { expertResidencyLifecycle }),
        safetyHandoffs,
        expiredLeaseRecovery,
        unknownOutcomeReconciliation,
        reservationExpiry,
        expertResidencyExpiry,
        expertTelegramCheckoutCleanup,
        expertResidencyReconciliation,
        expertReferralHoldReplay,
        expertReferralMaturity,
        confirmedOutboxDelivery,
        processorPrivacy,
        providerReconciliation,
        testExpertReconciliation,
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
    deps.stopRecovery?.();
    deps.bookingNotifications?.stopAccepting();
    deps.expertCardMaterials?.stopAccepting();
    deps.residentWorkspaceNotifications?.stopAccepting();
    deps.expertSeparatedSales?.stopAccepting();
    deps.expertPersonalOffers?.stopAccepting();
    deps.expertResidencyLifecycle?.stopAccepting();
    const notificationDeadline = Date.now() + shutdownTimeoutMs;
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
        await beforeDeadline(
          deps.bookingNotifications?.drain(notificationDeadline) ??
            Promise.resolve(),
          Math.max(1, notificationDeadline - Date.now()),
        );
      } catch (error) {
        failure ??= error;
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
  const maturityEnabled = deps.expertReferralMaturityWorkerEnabled === true;
  if (
    maturityEnabled &&
    deps.expertReferralJobsRepository.grantDueMaturityBatch === undefined
  ) {
    throw new Error("expert_referral_maturity_worker_capability_unavailable");
  }
  if (workerOutboxEnabled !== (deps.workerOutboxRunner !== undefined)) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  return createWorkerRuntime({
    ...(deps.residentWorkspaceNotifications
      ? { residentWorkspaceNotifications: deps.residentWorkspaceNotifications }
      : {}),
    ...(deps.expertSeparatedSales === undefined
      ? {}
      : { expertSeparatedSales: deps.expertSeparatedSales }),
    ...(deps.expertPersonalOffers === undefined
      ? {}
      : { expertPersonalOffers: deps.expertPersonalOffers }),
    ...(deps.expertResidencyLifecycle === undefined
      ? {}
      : { expertResidencyLifecycle: deps.expertResidencyLifecycle }),
    ...(deps.expertCardMaterials === undefined
      ? {}
      : { expertCardMaterials: deps.expertCardMaterials }),
    ...(deps.bookingHandoffRevocations === undefined
      ? {}
      : { bookingHandoffRevocations: deps.bookingHandoffRevocations }),
    ...(deps.bookingNotifications === undefined
      ? {}
      : { bookingNotifications: deps.bookingNotifications }),
    safetyHandoffs: async () =>
      deps.jobsRepository.processDueBatch({
        now: deps.now(),
        batchSize,
      }),
    recoverExpiredLeases:
      workerOutboxEnabled || deps.clientAsyncOutboxRunner !== undefined
        ? async () => ({
            dispatch: 0,
            reconciliation: 0,
            reason: "owned_by_filtered_runner",
          })
        : async () => ({
            dispatch:
              await deps.outboxRepository.recoverExpiredDispatchLeases(
                batchSize,
              ),
            reconciliation:
              await deps.outboxRepository.recoverExpiredReconciliationLeases(
                batchSize,
              ),
          }),
    ...(deps.yookassaBoundRecovery === undefined
      ? {}
      : { stopRecovery: () => deps.yookassaBoundRecovery!.stopAccepting() }),
    reconcileUnknownOutcomes:
      deps.yookassaBoundRecovery === undefined
        ? async () => ({
            reconciled: 0,
            reason: "providers_disabled",
          })
        : () => deps.yookassaBoundRecovery!.runOnce(),
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
    expertResidencyReconciliation: async () => {
      const reason = deps.yookassaBoundRecovery?.unavailableReason();
      if (reason)
        return {
          examined: 0,
          matched: 0,
          mismatches: 0,
          provider: "unavailable",
          reason,
        };
      const result = await reconcileExpertResidencyPayments(
        deps.expertReferralJobsRepository,
        expertResidencyProviderReader,
        deps.now(),
        batchSize,
      );
      const unavailable = deps.yookassaBoundRecovery?.unavailableReason();
      return unavailable
        ? {
            ...result,
            reason: unavailable,
          }
        : result;
    },
    expertReferralHoldReplay: async () =>
      replayHeldRewards(
        deps.expertReferralJobsRepository,
        deps.now(),
        batchSize,
      ),
    expertReferralMaturity: maturityEnabled
      ? async () => {
          try {
            const result =
              ((await deps.expertReferralJobsRepository.grantDueMaturityBatch?.(
                {
                  now: deps.now(),
                  batchSize,
                },
              )) ?? { examined: 0, granted: 0, cancelled: 0, pending: 0 }) as {
                examined: number;
                granted: number;
                cancelled: number;
                pending: number;
              };
            for (const [outcome, count] of [
              ["examined", result.examined],
              ["granted", result.granted],
              ["cancelled", result.cancelled],
              ["retry", result.pending],
            ] as const)
              if (count > 0)
                deps.expertReferralMaturityMetrics?.record(outcome, count);
            return result;
          } catch (error) {
            deps.expertReferralMaturityMetrics?.record("failed");
            throw error;
          }
        }
      : async () => ({
          examined: 0,
          granted: 0,
          cancelled: 0,
          pending: 0,
          reason: "maturity_worker_disabled",
        }),
    deliverConfirmedOutbox: async () => {
      const local = workerOutboxEnabled
        ? await deps.workerOutboxRunner!()
        : await deps.jobsRepository.materializeOperatorCasesBatch(batchSize);
      return deps.clientAsyncOutboxRunner
        ? { local, clientAsync: await deps.clientAsyncOutboxRunner() }
        : local;
    },
    processorPrivacy:
      deps.clientCatalogRetention === undefined &&
      deps.clientSessionRetention === undefined &&
      deps.expertSessionRetention === undefined &&
      deps.payerReceiptRetention === undefined &&
      deps.clientBookingErasure === undefined &&
      deps.clientErasureRequests === undefined
        ? async () => ({
            processed: 0,
            reason: "privacy_capability_disabled",
          })
        : async () => ({
            ...(deps.payerReceiptRetention === undefined
              ? {}
              : { payerReceipt: await deps.payerReceiptRetention() }),
            ...(deps.clientErasureRequests === undefined
              ? {}
              : { erasureRequests: await deps.clientErasureRequests() }),
            ...(deps.clientCatalogRetention === undefined
              ? {}
              : { clientCatalog: await deps.clientCatalogRetention() }),
            ...(deps.clientSessionRetention === undefined
              ? {}
              : { clientSession: await deps.clientSessionRetention() }),
            ...(deps.expertSessionRetention === undefined
              ? {}
              : { expertSession: await deps.expertSessionRetention() }),
            ...(deps.clientBookingErasure === undefined
              ? {}
              : { clientBooking: await deps.clientBookingErasure() }),
          }),
    providerReconciliation:
      deps.planerkaBookingRunner ??
      (async () => ({
        examined: 0,
        matched: 0,
        mismatches: [],
        projectionRepairs: 0,
        provider: "disabled",
      })),
    ...(deps.testExpertReconciliation === undefined
      ? {}
      : { testExpertReconciliation: deps.testExpertReconciliation }),
    closeDatabase: deps.closeDatabase,
    closeTelemetry: deps.closeTelemetry,
    ...(deps.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: deps.shutdownTimeoutMs }),
  });
}
