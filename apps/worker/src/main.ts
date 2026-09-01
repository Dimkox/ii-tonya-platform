import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@ii-tonya/config";
import {
  createDb,
  PostgresCatalogRepository,
  PostgresBookingRepository,
  PostgresClientCatalogRepository,
  PostgresClientSessionRepository,
  PostgresExpertReferralWorkerRepository,
  PostgresExpertTelegramResidencyCallbackRepository,
  PostgresOperatorCaseOutboxRepository,
  PostgresOutboxRepository,
  PostgresOrderedTelegramOutboxRepository,
  PostgresWorkerJobsRepository,
  PostgresTestExpertTelegramRepository,
  PostgresLifecycleSchedulerRepository,
  PostgresWaitlistRepository,
} from "@ii-tonya/db";
import {
  recordClientCatalogMetric,
  recordClientSessionMetric,
  recordExpertReferralMaturityMetric,
  recordWorkerOutboxMetric,
  recordTestExpertReconciliationMetric,
} from "@ii-tonya/observability";
import type { DrizzleDb } from "@ii-tonya/db";
import {
  createClientCatalogOutboxRegistry,
  createClientCatalogSourceReader,
  CLIENT_CATALOG_OUTBOX_TOPICS,
  type ClientCatalogOutboxRegistry,
} from "./client-catalog-outbox.js";
import {
  createProductionWorkerRuntime,
  disabledExpertResidencyProviderReader,
  type WorkerRuntime,
} from "./runtime.js";
import {
  boundedFullJitterDelay,
  createLocalOperatorCaseOutboxRegistry,
  LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  runClientCatalogRetention,
  runClientBookingErasureBatch,
  runClientSessionRetention,
  runOutboxBatch,
  type ExpertResidencyProviderReader,
  type LocalOperatorCaseOutboxRegistry,
  type OutboxRunnerMetricLabels,
  type OutboxDispatcher,
  type OutboxReconciler,
  reconcileTestExpertTrial,
} from "@ii-tonya/worker";

type RuntimeConfig = ReturnType<typeof loadEnv>;
type BoundedJob = () => Promise<unknown>;
type TestExpertReconciliationCapabilities = {
  repository: {
    scan(input: { limit: number; before: Date }): Promise<
      readonly {
        reservationId: string;
        providerRequestId: string;
        createdAt: Date;
      }[]
    >;
    recordAuthoritativeOutcome(
      reservationId: string,
      providerRequestId: string,
      outcome: "applied" | "not_applied",
    ): Promise<void>;
  };
  authority: {
    resolve(
      providerRequestId: string,
    ): Promise<"applied" | "not_applied" | "unknown">;
  };
  metrics: {
    record(event: {
      name:
        | "reconciliation_age"
        | "units_consumed"
        | "units_released"
        | "unknown_outcome";
      value: number;
    }): void;
  };
};

export interface WorkerRuntimeFactory {
  create(config: RuntimeConfig): Promise<WorkerRuntime>;
}
export interface ProductionWorkerRuntimeFactoryDependencies {
  readonly yookassaReader?: ExpertResidencyProviderReader;
  readonly waitlistRepositoryFactory?: (
    db: DrizzleDb,
    confirmationBufferMs: number,
  ) => {
    processPromotionCommandsBatch(batchSize: number): Promise<unknown>;
  };
  readonly workerOutboxRegistryFactory?: (
    db: DrizzleDb,
    config: RuntimeConfig,
  ) => WorkerOutboxRegistry;
}
export interface WorkerLoopOptions {
  readonly signal: AbortSignal;
  readonly pollIntervalMs: number;
  readonly heartbeat?: () => void | Promise<void>;
}

export interface WorkerMainOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runtimeFactory?: WorkerRuntimeFactory;
  readonly pollIntervalMs?: number;
  readonly shutdownGraceMs?: number;
  readonly hardExit?: (status: number) => void;
}

const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;

export { disabledExpertResidencyProviderReader };

type WorkerOutboxRegistry =
  LocalOperatorCaseOutboxRegistry | ClientCatalogOutboxRegistry;

export function selectWorkerOutboxRegistry(
  config: RuntimeConfig,
  factory?: () => unknown,
): WorkerOutboxRegistry | undefined {
  if (config.features.workerOutboxDelivery !== true) return undefined;
  if (factory === undefined) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  return requireWorkerOutboxRegistry(
    factory(),
    config.features.clientCatalog === true
      ? CLIENT_CATALOG_OUTBOX_TOPICS
      : LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  );
}

export function selectClientCatalogRetention(
  config: RuntimeConfig,
  factory?: () => BoundedJob,
): BoundedJob | undefined {
  if (
    config.features.workerOutboxDelivery !== true ||
    config.features.clientCatalog !== true
  ) {
    return undefined;
  }
  if (factory === undefined) {
    throw new Error("client_catalog_retention_capability_unavailable");
  }
  const job = factory();
  if (typeof job !== "function") {
    throw new Error("client_catalog_retention_capability_unavailable");
  }
  return job;
}

export function selectClientSessionRetention(
  config: RuntimeConfig,
  factory?: () => BoundedJob,
): BoundedJob | undefined {
  if (config.features.clientSession !== true) return undefined;
  if (factory === undefined) {
    throw new Error("client_session_retention_capability_unavailable");
  }
  const job = factory();
  if (typeof job !== "function") {
    throw new Error("client_session_retention_capability_unavailable");
  }
  return job;
}

export function selectTestExpertReconciliation(
  config: RuntimeConfig,
  factory?: () => unknown,
): TestExpertReconciliationCapabilities | undefined {
  if (config.features.testExpertReconciliation !== true) return undefined;
  if (factory === undefined)
    throw new Error("test_expert_reconciliation_capability_unavailable");
  const value = factory() as Partial<TestExpertReconciliationCapabilities>;
  if (
    typeof value?.repository?.scan !== "function" ||
    typeof value.repository.recordAuthoritativeOutcome !== "function" ||
    typeof value?.authority?.resolve !== "function" ||
    typeof value?.metrics?.record !== "function"
  )
    throw new Error("test_expert_reconciliation_capability_unavailable");
  return value as TestExpertReconciliationCapabilities;
}

function requireWorkerOutboxRegistry(
  value: unknown,
  expectedTopics?: readonly string[],
): WorkerOutboxRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  const registry = value as Partial<WorkerOutboxRegistry>;
  const topics = registry.topics;
  const acceptedTopics =
    topics !== undefined &&
    [LOCAL_OPERATOR_CASE_OUTBOX_TOPICS, CLIENT_CATALOG_OUTBOX_TOPICS].some(
      (candidate) =>
        topics.length === candidate.length &&
        topics.every((topic, index) => topic === candidate[index]),
    );
  const expected =
    expectedTopics === undefined ||
    (topics !== undefined &&
      topics.length === expectedTopics.length &&
      topics.every((topic, index) => topic === expectedTopics[index]));
  if (
    !acceptedTopics ||
    !expected ||
    typeof registry.dispatch !== "function" ||
    typeof registry.reconcile !== "function"
  ) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  return registry as WorkerOutboxRegistry;
}

type WorkerOutboxMetricRecorder = (
  labels: OutboxRunnerMetricLabels,
  count?: number,
) => void;

export function composeWorkerOutboxDelivery(
  db: DrizzleDb,
  registryInput: unknown = createLocalOperatorCaseOutboxRegistry(
    new PostgresOperatorCaseOutboxRepository(db),
  ),
  metricRecorder: WorkerOutboxMetricRecorder = recordWorkerOutboxMetric,
) {
  const registry = requireWorkerOutboxRegistry(registryInput);
  if (typeof metricRecorder !== "function") {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  const repository = new PostgresOutboxRepository(db, registry.topics);
  return {
    registry,
    repository,
    run: () =>
      runOutboxBatch({
        repository,
        dispatcher: registry,
        reconciler: {
          async reconcile(message) {
            const result = await registry.reconcile(message);
            if (result.kind === "applied") return "applied";
            if (result.kind === "not_applied") return "not_applied";
            if (result.kind === "still_unknown") return "still_unknown";
            return result;
          },
        },
        metrics: { record: metricRecorder },
        now: () => new Date(),
        retryDelayMs: (attempt) =>
          boundedFullJitterDelay(attempt, 1_000, 30_000),
        maxAttempts: 3,
        maxReconciliationAttempts: 3,
        batchSize: 100,
        workerId: "local-operator-case-worker",
        newAttemptId: randomUUID,
      }),
  } as const;
}

export function composeB2TelegramDelivery(
  db: DrizzleDb,
  enabled: boolean,
  capability?: OutboxDispatcher & OutboxReconciler,
) {
  if (!enabled) return undefined;
  if (capability === undefined) {
    throw new Error("b2_telegram_delivery_capability_unavailable");
  }
  const repository = new PostgresOrderedTelegramOutboxRepository(db);
  return {
    repository,
    run: () =>
      runOutboxBatch({
        repository,
        dispatcher: capability,
        reconciler: capability,
        metrics: { record: recordWorkerOutboxMetric },
        now: () => new Date(),
        retryDelayMs: (attempt) =>
          boundedFullJitterDelay(attempt, 1_000, 30_000),
        maxAttempts: 3,
        maxReconciliationAttempts: 3,
        batchSize: 100,
        workerId: "b2-telegram-delivery-worker",
        newAttemptId: randomUUID,
      }),
  } as const;
}

export function selectExpertResidencyProviderReader(
  config: RuntimeConfig,
  yookassaReader?: ExpertResidencyProviderReader,
): ExpertResidencyProviderReader {
  if (config.features.yookassa !== true) {
    if (yookassaReader !== undefined) {
      throw new Error("yookassa_worker_capability_unexpected");
    }
    return disabledExpertResidencyProviderReader;
  }
  if (config.yookassa === undefined || yookassaReader === undefined) {
    throw new Error("yookassa_worker_capability_unavailable");
  }
  return yookassaReader;
}

export function createProductionWorkerRuntimeFactory(
  deps: ProductionWorkerRuntimeFactoryDependencies = {},
): WorkerRuntimeFactory {
  return {
    async create(config) {
      if (
        config.features.workerOutboxDelivery === true &&
        deps.workerOutboxRegistryFactory === undefined
      ) {
        throw new Error("worker_outbox_delivery_capability_unavailable");
      }
      const expertResidencyProviderReader = selectExpertResidencyProviderReader(
        config,
        deps.yookassaReader,
      );
      const db = createDb(config.databaseUrl);
      const workerOutboxRegistry = selectWorkerOutboxRegistry(
        config,
        deps.workerOutboxRegistryFactory === undefined
          ? undefined
          : () => deps.workerOutboxRegistryFactory!(db, config),
      );
      const workerOutbox =
        workerOutboxRegistry === undefined
          ? undefined
          : composeWorkerOutboxDelivery(db, workerOutboxRegistry);
      const clientCatalogRetention = selectClientCatalogRetention(
        config,
        () => {
          const repository = new PostgresClientCatalogRepository(db);
          return () =>
            runClientCatalogRetention(
              { repository, metrics: { record: recordClientCatalogMetric } },
              new Date(),
              100,
            );
        },
      );
      const clientSessionRetention = selectClientSessionRetention(
        config,
        () => {
          const repository = new PostgresClientSessionRepository(db);
          return () =>
            runClientSessionRetention(
              { repository, metrics: { record: recordClientSessionMetric } },
              100,
            );
        },
      );
      const clientBookingErasure =
        config.features.clientBooking === true
          ? () =>
              runClientBookingErasureBatch({
                db,
                bookings: new PostgresBookingRepository(db),
                limit: 100,
              })
          : undefined;
      const testExpertReconciliation = selectTestExpertReconciliation(
        config,
        () => {
          const repository = new PostgresTestExpertTelegramRepository(db, {
            messagingConsentPolicyVersion: "worker-reconciliation-only",
          });
          return {
            repository,
            authority: {
              resolve: (providerRequestId: string) =>
                repository.resolveAuthoritativeOutcome(providerRequestId),
            },
            metrics: { record: recordTestExpertReconciliationMetric },
          };
        },
      );
      const outboxRepository =
        workerOutbox?.repository ?? new PostgresOutboxRepository(db);
      const lifecycleSchedulerRepository = config.features.lifecycleReminders
        ? new PostgresLifecycleSchedulerRepository(
            db,
            config.clientMessagingConsentPolicyVersion!,
            config.clientTelegramBotKey!,
          )
        : undefined;
      const waitlistRepository = config.features.clientWaitlist
        ? (
            deps.waitlistRepositoryFactory ??
            ((waitlistDb, confirmationBufferMs) =>
              new PostgresWaitlistRepository(waitlistDb, confirmationBufferMs))
          )(db, config.clientBookingConfirmationBufferMs ?? 3_600_000)
        : undefined;
      return createProductionWorkerRuntime({
        jobsRepository: new PostgresWorkerJobsRepository(db),
        expertReferralJobsRepository:
          new PostgresExpertReferralWorkerRepository(db),
        expertReferralMaturityWorkerEnabled:
          config.features.expertReferralMaturityWorker,
        expertReferralMaturityMetrics: {
          record: recordExpertReferralMaturityMetric,
        },
        expertTelegramCheckoutRepository:
          new PostgresExpertTelegramResidencyCallbackRepository(db),
        expertResidencyProviderReader,
        outboxRepository,
        ...(lifecycleSchedulerRepository === undefined
          ? {}
          : {
              lifecycleScheduler: () =>
                lifecycleSchedulerRepository.processDueLifecycleBatch({
                  now: new Date(),
                  batchSize: 100,
                }),
            }),
        ...(waitlistRepository === undefined
          ? {}
          : {
              waitlistPromotion: () =>
                waitlistRepository.processPromotionCommandsBatch(100),
            }),
        ...(workerOutbox === undefined
          ? {}
          : {
              workerOutboxRegistry: workerOutbox.registry,
              workerOutboxRunner: workerOutbox.run,
            }),
        ...(clientCatalogRetention === undefined
          ? {}
          : { clientCatalogRetention }),
        ...(clientSessionRetention === undefined
          ? {}
          : { clientSessionRetention }),
        ...(clientBookingErasure === undefined ? {} : { clientBookingErasure }),
        ...(testExpertReconciliation === undefined
          ? {}
          : {
              testExpertReconciliation: () =>
                reconcileTestExpertTrial({
                  limit: 100,
                  minimumAgeMs: 60_000,
                  now: new Date(),
                  ...testExpertReconciliation,
                }),
            }),
        closeDatabase: async () => db.$client.end(),
        closeTelemetry: async () => undefined,
        now: () => new Date(),
      });
    },
  };
}

const productionRuntimeFactory = createProductionWorkerRuntimeFactory({
  workerOutboxRegistryFactory: (db, config) => {
    const local = createLocalOperatorCaseOutboxRegistry(
      new PostgresOperatorCaseOutboxRepository(db),
    );
    if (config.features.clientCatalog !== true) return local;
    const catalog = new PostgresCatalogRepository(db);
    return createClientCatalogOutboxRegistry({
      local,
      requests: new PostgresClientCatalogRepository(db),
      source: createClientCatalogSourceReader(
        catalog,
        config.features.clientBooking === true ? catalog : undefined,
        config.features.clientBooking === true ? {} : undefined,
      ),
    });
  },
});

function waitForNextCycle(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveWait) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runWorkerLoop(
  runtime: WorkerRuntime,
  options: WorkerLoopOptions,
): Promise<void> {
  if (
    !Number.isSafeInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 1 ||
    options.pollIntervalMs > 60_000
  )
    throw new Error("Invalid worker poll interval");
  try {
    while (!options.signal.aborted) {
      const cycle = runtime.runOnce();
      const outcome = await new Promise<"completed" | "aborted">(
        (resolveCycle, rejectCycle) => {
          const aborted = () => {
            resolveCycle("aborted");
          };
          options.signal.addEventListener("abort", aborted, { once: true });
          void cycle.then(
            () => {
              options.signal.removeEventListener("abort", aborted);
              resolveCycle("completed");
            },
            (error: unknown) => {
              options.signal.removeEventListener("abort", aborted);
              rejectCycle(error);
            },
          );
        },
      );
      if (outcome === "aborted") break;
      await options.heartbeat?.();
      await waitForNextCycle(options.pollIntervalMs, options.signal);
    }
  } finally {
    await runtime.close();
  }
}

function environmentPollInterval(env: NodeJS.ProcessEnv): number {
  const raw = env.WORKER_POLL_INTERVAL_MS ?? "1000";
  if (!/^\d{1,5}$/u.test(raw))
    throw new Error("Invalid WORKER_POLL_INTERVAL_MS");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new Error("Invalid WORKER_POLL_INTERVAL_MS");
  }
  return value;
}

export async function main(options: WorkerMainOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  if (
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs < 1 ||
    shutdownGraceMs > 60_000
  )
    throw new Error("Invalid worker shutdown grace period");
  const config = loadEnv(env);
  const runtime = await (
    options.runtimeFactory ?? productionRuntimeFactory
  ).create(config);
  const controller = new AbortController();
  const hardExit =
    options.hardExit ??
    ((status: number) => {
      process.exit(status);
    });
  let hardExitTimer: NodeJS.Timeout | undefined;
  const stop = () => {
    controller.abort();
    if (hardExitTimer === undefined) {
      hardExitTimer = setTimeout(() => {
        hardExit(1);
      }, shutdownGraceMs);
      hardExitTimer.unref();
    }
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: options.pollIntervalMs ?? environmentPollInterval(env),
      heartbeat: () =>
        writeFile("/tmp/ii-tonya-worker-heartbeat", new Date().toISOString()),
    });
  } finally {
    if (hardExitTimer !== undefined) clearTimeout(hardExitTimer);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

export function isDirectExecution(
  moduleUrl: string,
  argument: string | undefined,
): boolean {
  if (argument === undefined) return false;
  const modulePath = resolve(fileURLToPath(moduleUrl));
  const argumentPath = resolve(argument);
  return process.platform === "win32"
    ? modulePath.toLowerCase() === argumentPath.toLowerCase()
    : modulePath === argumentPath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void main().catch(() => {
    process.stderr.write("Worker startup or polling failed\n");
    process.exitCode = 1;
  });
}
