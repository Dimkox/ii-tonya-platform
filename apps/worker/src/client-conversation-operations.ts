import {
  ClientBookingUnauthorizedError,
  ClientCatalogUnauthorizedError,
  type ConversationBookingGateway,
  type ConversationCatalogGateway,
} from "../../../packages/application/src/index.js";
import {
  ConversationBookingRetryableError,
  ConversationCatalogRetryableError,
  type FencedWriteResult,
  type OperationClaim,
  type OperationResult,
} from "../../../packages/db/src/index.js";

export interface ClientConversationOperationWorkerRepository {
  claimDispatch(input: {
    readonly ownerId: string;
    readonly limit: number;
  }): Promise<readonly OperationClaim[]>;
  claimReconciliation(input: {
    readonly ownerId: string;
    readonly limit: number;
  }): Promise<readonly OperationClaim[]>;
  recordResult(
    claim: OperationClaim,
    result: OperationResult,
  ): Promise<FencedWriteResult>;
  recordGrantDenied(claim: OperationClaim): Promise<FencedWriteResult>;
  recordRetryWait(claim: OperationClaim): Promise<FencedWriteResult>;
  recordUnknownOutcome(claim: OperationClaim): Promise<FencedWriteResult>;
  recordDeadLetter(
    claim: OperationClaim,
    reason: "invalid_operation" | "crypto_invalid" | "attempts_exhausted",
  ): Promise<FencedWriteResult>;
  recoverExpired(input: {
    readonly limit: number;
  }): Promise<{ recovered: number }>;
  cleanupExpired(input: {
    readonly limit: number;
  }): Promise<{ expired: number }>;
  heartbeatRuntime(input: {
    readonly instanceId: string;
    readonly buildSha: string;
  }): Promise<void>;
}

export type ClientConversationOperationRunReport = Readonly<{
  claimed: number;
  recorded: number;
  retryWait: number;
  unknownOutcome: number;
  deadLetter: number;
  stale: number;
}>;

type MutableRunReport = {
  claimed: number;
  recorded: number;
  retryWait: number;
  unknownOutcome: number;
  deadLetter: number;
  stale: number;
};

const emptyRunReport = (claimed: number): MutableRunReport => ({
  claimed,
  recorded: 0,
  retryWait: 0,
  unknownOutcome: 0,
  deadLetter: 0,
  stale: 0,
});

const recordTransition = (
  report: MutableRunReport,
  transition: Exclude<keyof MutableRunReport, "claimed" | "stale">,
  result: FencedWriteResult,
): void => {
  if (result === "stale") {
    report.stale += 1;
    return;
  }
  report[transition] += 1;
};

const isPreCallRetry = (error: unknown): boolean =>
  error instanceof ConversationCatalogRetryableError ||
  error instanceof ConversationBookingRetryableError;

const isInvalidClaim = (error: unknown): boolean =>
  error instanceof ClientCatalogUnauthorizedError ||
  error instanceof ClientBookingUnauthorizedError;

export function createClientConversationOperationsJob(deps: {
  readonly repository: ClientConversationOperationWorkerRepository;
  readonly catalogGateway: ConversationCatalogGateway;
  readonly bookingGateway: ConversationBookingGateway;
  readonly ownerId: string;
  readonly batchSize: number;
}) {
  const invoke = (claim: OperationClaim): Promise<OperationResult> =>
    claim.toolKind === "show_catalog"
      ? deps.catalogGateway.request(claim.claim)
      : deps.bookingGateway.reserve(claim.claim);

  const processDispatch = async (
    claim: OperationClaim,
    report: MutableRunReport,
  ): Promise<void> => {
    try {
      const result = await invoke(claim);
      recordTransition(
        report,
        "recorded",
        await deps.repository.recordResult(claim, result),
      );
    } catch (error) {
      if (isInvalidClaim(error)) {
        recordTransition(
          report,
          "deadLetter",
          await deps.repository.recordDeadLetter(claim, "invalid_operation"),
        );
      } else if (isPreCallRetry(error)) {
        recordTransition(
          report,
          "retryWait",
          await deps.repository.recordRetryWait(claim),
        );
      } else {
        recordTransition(
          report,
          "unknownOutcome",
          await deps.repository.recordUnknownOutcome(claim),
        );
      }
    }
  };

  const processReconciliation = async (
    claim: OperationClaim,
    report: MutableRunReport,
  ): Promise<void> => {
    try {
      const result = await invoke(claim);
      recordTransition(
        report,
        "recorded",
        await deps.repository.recordResult(claim, result),
      );
    } catch (error) {
      if (isInvalidClaim(error)) {
        recordTransition(
          report,
          "deadLetter",
          await deps.repository.recordDeadLetter(claim, "invalid_operation"),
        );
      } else {
        recordTransition(
          report,
          "unknownOutcome",
          await deps.repository.recordUnknownOutcome(claim),
        );
      }
    }
  };

  return Object.freeze({
    async runDispatch(): Promise<ClientConversationOperationRunReport> {
      const claims = await deps.repository.claimDispatch({
        ownerId: deps.ownerId,
        limit: deps.batchSize,
      });
      const report = emptyRunReport(claims.length);
      for (const claim of claims) await processDispatch(claim, report);
      return report;
    },
    async runReconciliation(): Promise<ClientConversationOperationRunReport> {
      const claims = await deps.repository.claimReconciliation({
        ownerId: deps.ownerId,
        limit: deps.batchSize,
      });
      const report = emptyRunReport(claims.length);
      for (const claim of claims) await processReconciliation(claim, report);
      return report;
    },
    async runCleanup() {
      const recovery = await deps.repository.recoverExpired({
        limit: deps.batchSize,
      });
      const cleanup = await deps.repository.cleanupExpired({
        limit: deps.batchSize,
      });
      return { recovery, cleanup } as const;
    },
  });
}

type WorkerFeatures = Readonly<{
  clientConversation?: boolean;
  clientConversationToolDispatch?: boolean;
}>;

export type ClientConversationWorkerCapabilities = Readonly<{
  crypto?: object;
  operationRepository?: Partial<ClientConversationOperationWorkerRepository>;
  catalogGateway?: Partial<ConversationCatalogGateway>;
  bookingGateway?: Partial<ConversationBookingGateway>;
  buildSha?: string;
  instanceId?: string;
}>;

const requiredRepositoryMethods = [
  "claimDispatch",
  "claimReconciliation",
  "recordResult",
  "recordGrantDenied",
  "recordRetryWait",
  "recordUnknownOutcome",
  "recordDeadLetter",
  "recoverExpired",
  "cleanupExpired",
  "heartbeatRuntime",
] as const;

export function preflightClientConversationWorker(
  features: WorkerFeatures,
  capabilities: ClientConversationWorkerCapabilities,
): "disabled" | "enabled" {
  if (features.clientConversationToolDispatch !== true) {
    if (Object.keys(capabilities).length > 0) {
      throw new Error("client_conversation_worker_capability_unexpected");
    }
    return "disabled";
  }
  const repository = capabilities.operationRepository;
  const crypto = capabilities.crypto as
    { readonly decrypt?: unknown } | undefined;
  if (
    features.clientConversation !== true ||
    typeof crypto?.decrypt !== "function" ||
    repository === undefined ||
    requiredRepositoryMethods.some(
      (method) => typeof repository[method] !== "function",
    ) ||
    typeof capabilities.catalogGateway?.request !== "function" ||
    typeof capabilities.bookingGateway?.reserve !== "function" ||
    typeof capabilities.buildSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(capabilities.buildSha) ||
    typeof capabilities.instanceId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(capabilities.instanceId)
  ) {
    throw new Error("client_conversation_worker_configuration_incomplete");
  }
  return "enabled";
}

export interface ClientConversationRuntimeLeaseController {
  start(): Promise<void>;
  stop(): Promise<void>;
  assertReady(): void;
}

export interface ClientConversationIntervalScheduler {
  setInterval(task: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler: ClientConversationIntervalScheduler = {
  setInterval: (task, milliseconds) => setInterval(task, milliseconds),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export function createClientConversationRuntimeLeaseController(deps: {
  readonly heartbeat: () => Promise<void>;
  readonly scheduler?: ClientConversationIntervalScheduler;
}): ClientConversationRuntimeLeaseController {
  const scheduler = deps.scheduler ?? defaultScheduler;
  let timer: unknown;
  let started = false;
  let stopped = true;
  let ready = false;
  let failure: unknown;
  let inFlight: Promise<void> | null = null;

  const cancelTimer = (): void => {
    if (timer === undefined) return;
    const handle = timer;
    timer = undefined;
    scheduler.clearInterval(handle);
  };

  const heartbeat = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    if (stopped || failure !== undefined) return Promise.resolve();
    const current = deps
      .heartbeat()
      .then(() => {
        if (!stopped) ready = true;
      })
      .catch((error: unknown) => {
        ready = false;
        failure = error;
        cancelTimer();
      })
      .finally(() => {
        if (inFlight === current) inFlight = null;
      });
    inFlight = current;
    return current;
  };

  return Object.freeze({
    async start(): Promise<void> {
      if (started) {
        if (failure !== undefined) {
          throw new Error("client conversation runtime lease unavailable");
        }
        return;
      }
      started = true;
      stopped = false;
      timer = scheduler.setInterval(() => {
        void heartbeat();
      }, 10_000);
      await heartbeat();
      if (failure !== undefined) {
        throw new Error("client conversation runtime lease unavailable");
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      ready = false;
      cancelTimer();
      await inFlight;
    },
    assertReady(): void {
      if (stopped || !ready || failure !== undefined) {
        throw new Error("client conversation runtime lease unavailable");
      }
    },
  });
}
