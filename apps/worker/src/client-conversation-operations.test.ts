import { randomUUID } from "node:crypto";

import {
  ClientBookingUnauthorizedError,
  ClientCatalogUnauthorizedError,
  createClientConversationOperationAuthority,
  type ClaimedConversationOperation,
} from "../../../packages/application/src/index.js";
import {
  ConversationBookingRetryableError,
  ConversationCatalogRetryableError,
  type FencedWriteResult,
  type OperationClaim,
  type OperationResult,
} from "../../../packages/db/src/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  createClientConversationOperationsJob,
  createClientConversationRuntimeLeaseController,
  preflightClientConversationWorker,
} from "./client-conversation-operations.js";

const authority = createClientConversationOperationAuthority();

const operationClaim = (
  toolKind: "show_catalog" | "start_booking",
  phase: "dispatch" | "reconciliation" = "dispatch",
): OperationClaim => {
  const operationId = randomUUID();
  const details = {
    operationId,
    claimToken: randomUUID(),
    claimOwnerId: "worker-1",
    claimFence: 1,
    toolKind,
    requiredScope:
      toolKind === "show_catalog"
        ? ("client_catalog:read" as const)
        : ("client_booking:write" as const),
    frozenInput:
      toolKind === "show_catalog"
        ? { serviceCode: "career", language: "ru" }
        : { choiceHandle: `ch1.${"A".repeat(43)}` as const },
  };
  return {
    phase,
    claim: authority.issuer.issue(details),
    operationId,
    claimOwnerId: details.claimOwnerId,
    claimToken: details.claimToken,
    claimFence: details.claimFence,
    toolKind,
    requiredScope: details.requiredScope,
    payloadExpiresAt: "2026-08-27T00:00:00.000Z",
  };
};

const repository = (
  claims: {
    dispatch?: readonly OperationClaim[];
    reconciliation?: readonly OperationClaim[];
  } = {},
) => ({
  claimDispatch: vi.fn(async () => claims.dispatch ?? []),
  claimReconciliation: vi.fn(async () => claims.reconciliation ?? []),
  recordResult: vi.fn<
    (
      claim: OperationClaim,
      result: OperationResult,
    ) => Promise<FencedWriteResult>
  >(async () => "committed"),
  recordGrantDenied: vi.fn<
    (claim: OperationClaim) => Promise<FencedWriteResult>
  >(async () => "committed"),
  recordRetryWait: vi.fn<(claim: OperationClaim) => Promise<FencedWriteResult>>(
    async () => "committed",
  ),
  recordUnknownOutcome: vi.fn<
    (claim: OperationClaim) => Promise<FencedWriteResult>
  >(async () => "committed"),
  recordDeadLetter: vi.fn<
    (
      claim: OperationClaim,
      reason: "invalid_operation" | "crypto_invalid" | "attempts_exhausted",
    ) => Promise<FencedWriteResult>
  >(async () => "committed"),
  recoverExpired: vi.fn(async () => ({ recovered: 0 })),
  cleanupExpired: vi.fn(async () => ({ expired: 0 })),
  heartbeatRuntime: vi.fn(async () => undefined),
});

describe("client conversation operation job", () => {
  it("routes genuine catalog and booking claims and records known business results", async () => {
    const catalog = operationClaim("show_catalog");
    const booking = operationClaim("start_booking");
    const operations = repository({ dispatch: [catalog, booking] });
    const catalogGateway = {
      request: vi.fn(async () => ({
        kind: "rejected" as const,
        code: "feature_disabled" as const,
      })),
    };
    const bookingGateway = {
      reserve: vi.fn(async () => ({
        kind: "applied" as const,
        downstreamReceiptDigest: "b".repeat(64),
      })),
    };
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway,
      bookingGateway,
      ownerId: "worker-1",
      batchSize: 10,
    });

    await expect(job.runDispatch()).resolves.toEqual({
      claimed: 2,
      recorded: 2,
      retryWait: 0,
      unknownOutcome: 0,
      denied: 0,
      deadLetter: 0,
      stale: 0,
    });
    expect(catalogGateway.request).toHaveBeenCalledWith(catalog.claim);
    expect(bookingGateway.reserve).toHaveBeenCalledWith(booking.claim);
    expect(operations.recordResult).toHaveBeenNthCalledWith(1, catalog, {
      kind: "rejected",
      code: "feature_disabled",
    });
    expect(operations.recordResult).toHaveBeenNthCalledWith(2, booking, {
      kind: "applied",
      downstreamReceiptDigest: "b".repeat(64),
    });
    expect(operations.recordGrantDenied).not.toHaveBeenCalled();
  });

  it("records typed pre-call contention as retry wait and unexpected post-invocation failure as unknown", async () => {
    const catalog = operationClaim("show_catalog");
    const booking = operationClaim("start_booking");
    const unknown = operationClaim("start_booking");
    const operations = repository({ dispatch: [catalog, booking, unknown] });
    let bookingCalls = 0;
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway: {
        request: vi.fn(async () => {
          throw new ConversationCatalogRetryableError();
        }),
      },
      bookingGateway: {
        reserve: vi.fn(async () => {
          bookingCalls += 1;
          if (bookingCalls === 1) {
            throw new ConversationBookingRetryableError();
          }
          throw new Error("downstream outcome unknown");
        }),
      },
      ownerId: "worker-1",
      batchSize: 10,
    });

    await expect(job.runDispatch()).resolves.toMatchObject({
      claimed: 3,
      retryWait: 2,
      unknownOutcome: 1,
    });
    expect(operations.recordRetryWait).toHaveBeenCalledWith(catalog);
    expect(operations.recordRetryWait).toHaveBeenCalledWith(booking);
    expect(operations.recordUnknownOutcome).toHaveBeenCalledWith(unknown);
  });

  it("counts stale fenced writes without retrying the claim in the same run", async () => {
    const claim = operationClaim("show_catalog");
    const operations = repository({ dispatch: [claim] });
    operations.recordResult.mockResolvedValueOnce("stale");
    const gateway = {
      request: vi.fn(async () => ({
        kind: "rejected" as const,
        code: "conflict" as const,
      })),
    };
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway: gateway,
      bookingGateway: { reserve: vi.fn() },
      ownerId: "worker-1",
      batchSize: 1,
    });

    await expect(job.runDispatch()).resolves.toMatchObject({
      claimed: 1,
      recorded: 0,
      stale: 1,
    });
    expect(gateway.request).toHaveBeenCalledOnce();
    expect(operations.claimDispatch).toHaveBeenCalledOnce();
  });

  it("records unknown without invoking the gateway again when receipt recording crashes", async () => {
    const claim = operationClaim("start_booking");
    const operations = repository({ dispatch: [claim] });
    operations.recordResult.mockRejectedValueOnce(new Error("database lost"));
    const bookingGateway = {
      reserve: vi.fn(async () => ({
        kind: "applied" as const,
        downstreamReceiptDigest: "d".repeat(64),
      })),
    };
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway: { request: vi.fn() },
      bookingGateway,
      ownerId: "worker-1",
      batchSize: 1,
    });

    await expect(job.runDispatch()).resolves.toMatchObject({
      claimed: 1,
      unknownOutcome: 1,
    });
    expect(bookingGateway.reserve).toHaveBeenCalledOnce();
    expect(operations.recordUnknownOutcome).toHaveBeenCalledWith(claim);
  });

  it("reconciles by replaying the exact genuine claim and records unresolved failure", async () => {
    const known = operationClaim("show_catalog", "reconciliation");
    const unresolved = operationClaim("start_booking", "reconciliation");
    const operations = repository({ reconciliation: [known, unresolved] });
    const catalogGateway = {
      request: vi.fn<
        (claim: ClaimedConversationOperation) => Promise<OperationResult>
      >(async () => ({
        kind: "applied",
        downstreamReceiptDigest: "c".repeat(64),
      })),
    };
    const bookingGateway = {
      reserve: vi.fn<
        (claim: ClaimedConversationOperation) => Promise<OperationResult>
      >(async () => {
        throw new ConversationBookingRetryableError();
      }),
    };
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway,
      bookingGateway,
      ownerId: "worker-1",
      batchSize: 10,
    });

    await expect(job.runReconciliation()).resolves.toMatchObject({
      claimed: 2,
      recorded: 1,
      unknownOutcome: 1,
    });
    expect(catalogGateway.request.mock.calls[0]?.[0]).toBe(known.claim);
    expect(bookingGateway.reserve.mock.calls[0]?.[0]).toBe(unresolved.claim);
    expect(operations.recordUnknownOutcome).toHaveBeenCalledWith(unresolved);
    expect(operations.recordRetryWait).not.toHaveBeenCalled();
  });

  it.each([
    ["catalog", "show_catalog", new ClientCatalogUnauthorizedError()],
    ["booking", "start_booking", new ClientBookingUnauthorizedError()],
  ] as const)(
    "records a typed fresh %s authorization denial as grant denied",
    async (_name, toolKind, authorizationError) => {
      const claim = operationClaim(toolKind);
      const operations = repository({ dispatch: [claim] });
      const job = createClientConversationOperationsJob({
        repository: operations,
        catalogGateway: {
          request: vi.fn(async () => {
            throw authorizationError;
          }),
        },
        bookingGateway: {
          reserve: vi.fn(async () => {
            throw authorizationError;
          }),
        },
        ownerId: "worker-1",
        batchSize: 1,
      });

      await expect(job.runDispatch()).resolves.toMatchObject({
        claimed: 1,
        denied: 1,
        deadLetter: 0,
      });

      expect(operations.recordGrantDenied).toHaveBeenCalledWith(claim);
      expect(operations.recordDeadLetter).not.toHaveBeenCalled();
      expect(operations.recordUnknownOutcome).not.toHaveBeenCalled();
    },
  );

  it("runs recovery before privacy cleanup without entering an outbox path", async () => {
    const calls: string[] = [];
    const operations = repository();
    operations.recoverExpired.mockImplementationOnce(async () => {
      calls.push("recover");
      return { recovered: 2 };
    });
    operations.cleanupExpired.mockImplementationOnce(async () => {
      calls.push("cleanup");
      return { expired: 3 };
    });
    const job = createClientConversationOperationsJob({
      repository: operations,
      catalogGateway: { request: vi.fn() },
      bookingGateway: { reserve: vi.fn() },
      ownerId: "worker-1",
      batchSize: 10,
    });

    await expect(job.runCleanup()).resolves.toEqual({
      recovery: { recovered: 2 },
      cleanup: { expired: 3 },
    });
    expect(calls).toEqual(["recover", "cleanup"]);
    expect(job).not.toHaveProperty("outbox");
  });
});

describe("client conversation worker preflight", () => {
  const complete = () => {
    const operations = repository();
    return {
      crypto: { decrypt: vi.fn() },
      operationRepository: operations,
      catalogGateway: { request: vi.fn() },
      bookingGateway: { reserve: vi.fn() },
      buildSha: "a".repeat(40),
      instanceId: "worker-1",
    };
  };

  it("does not enable the worker from CLIENT_CONVERSATION_ENABLED alone", () => {
    expect(
      preflightClientConversationWorker(
        {
          clientConversation: true,
          clientConversationToolDispatch: false,
        },
        {},
      ),
    ).toBe("disabled");
  });

  it.each([
    "crypto",
    "operationRepository",
    "catalogGateway",
    "bookingGateway",
    "buildSha",
    "instanceId",
  ] as const)("fails before startup when enabled %s is absent", (missing) => {
    const capabilities: Partial<ReturnType<typeof complete>> = complete();
    delete capabilities[missing];
    expect(() =>
      preflightClientConversationWorker(
        {
          clientConversation: true,
          clientConversationToolDispatch: true,
        },
        capabilities,
      ),
    ).toThrow("client_conversation_worker_configuration_incomplete");
  });

  it("accepts only the complete enabled matrix", () => {
    expect(
      preflightClientConversationWorker(
        {
          clientConversation: true,
          clientConversationToolDispatch: true,
        },
        complete(),
      ),
    ).toBe("enabled");
  });
});

describe("client conversation runtime leases", () => {
  it("heartbeats immediately and every ten seconds, then withdraws readiness on failure", async () => {
    let callback: (() => void) | undefined;
    const scheduler = {
      setInterval: vi.fn((task: () => void, milliseconds: number) => {
        callback = task;
        expect(milliseconds).toBe(10_000);
        return "lease-timer";
      }),
      clearInterval: vi.fn(),
    };
    const failure = new Error("lease write failed");
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const leases = createClientConversationRuntimeLeaseController({
      heartbeat,
      scheduler,
    });

    await leases.start();
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(() => leases.assertReady()).not.toThrow();
    callback?.();
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    callback?.();
    await vi.waitFor(() => expect(scheduler.clearInterval).toHaveBeenCalled());
    expect(() => leases.assertReady()).toThrow("runtime lease unavailable");
    await leases.stop();
  });

  it("cancels the cadence before waiting for an in-flight heartbeat", async () => {
    let finish: (() => void) | undefined;
    const scheduler = {
      setInterval: vi.fn(() => "lease-timer"),
      clearInterval: vi.fn(),
    };
    const heartbeat = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const leases = createClientConversationRuntimeLeaseController({
      heartbeat,
      scheduler,
    });
    const starting = leases.start();
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledOnce());
    const stopping = leases.stop();
    expect(scheduler.clearInterval).toHaveBeenCalled();
    finish?.();
    await Promise.all([starting, stopping]);
  });
});
