import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@ii-tonya/config";
import {
  createDb,
  PostgresCatalogRepository,
  PostgresClientCatalogRepository,
  PostgresExpertReferralWorkerRepository,
  PostgresExpertTelegramResidencyCallbackRepository,
  PostgresOperatorCaseOutboxRepository,
  PostgresOutboxRepository,
  PostgresWorkerJobsRepository,
} from "@ii-tonya/db";
import { recordWorkerOutboxMetric } from "@ii-tonya/observability";
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
  runOutboxBatch,
  type ExpertResidencyProviderReader,
  type LocalOperatorCaseOutboxRegistry,
  type OutboxRunnerMetricLabels,
} from "@ii-tonya/worker";

type RuntimeConfig = ReturnType<typeof loadEnv>;

export interface WorkerRuntimeFactory {
  create(config: RuntimeConfig): Promise<WorkerRuntime>;
}
export interface ProductionWorkerRuntimeFactoryDependencies {
  readonly yookassaReader?: ExpertResidencyProviderReader;
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
  | LocalOperatorCaseOutboxRegistry
  | ClientCatalogOutboxRegistry;

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
      const outboxRepository =
        workerOutbox?.repository ?? new PostgresOutboxRepository(db);
      return createProductionWorkerRuntime({
        jobsRepository: new PostgresWorkerJobsRepository(db),
        expertReferralJobsRepository:
          new PostgresExpertReferralWorkerRepository(db),
        expertTelegramCheckoutRepository:
          new PostgresExpertTelegramResidencyCallbackRepository(db),
        expertResidencyProviderReader,
        outboxRepository,
        ...(workerOutbox === undefined
          ? {}
          : {
              workerOutboxRegistry: workerOutbox.registry,
              workerOutboxRunner: workerOutbox.run,
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
    return createClientCatalogOutboxRegistry({
      local,
      requests: new PostgresClientCatalogRepository(db),
      source: createClientCatalogSourceReader(
        new PostgresCatalogRepository(db),
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
