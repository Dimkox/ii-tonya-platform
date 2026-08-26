import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";

describe("worker main", () => {
  it("can be imported without starting the polling loop", async () => {
    const module = await import("./main.js");

    expect(module.main).toBeTypeOf("function");
  }, 15_000);

  it("keeps expert residency provider reads disabled by default", async () => {
    const { disabledExpertResidencyProviderReader } = await import("./main.js");

    await expect(
      disabledExpertResidencyProviderReader.readPayments({
        now: new Date("2026-08-14T10:00:00.000Z"),
        payments: [],
      }),
    ).resolves.toEqual({ kind: "disabled" });
  });

  it("constructs the worker outbox registry lazily only for enabled config", async () => {
    const { selectWorkerOutboxRegistry } = await import("./main.js");
    const registry = {
      topics: [
        "safety.operator_escalation",
        "admin.negative_feedback",
      ] as const,
      dispatch: vi.fn(),
      reconcile: vi.fn(),
    };
    const factory = vi.fn(() => registry);

    expect(
      selectWorkerOutboxRegistry(
        { features: { workerOutboxDelivery: false } } as never,
        factory,
      ),
    ).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();

    expect(
      selectWorkerOutboxRegistry(
        { features: { workerOutboxDelivery: true } } as never,
        factory,
      ),
    ).toBe(registry);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("fails closed before registry use when enabled composition is incomplete", async () => {
    const { selectWorkerOutboxRegistry } = await import("./main.js");

    expect(() =>
      selectWorkerOutboxRegistry({
        features: { workerOutboxDelivery: true },
      } as never),
    ).toThrow("worker_outbox_delivery_capability_unavailable");
    expect(() =>
      selectWorkerOutboxRegistry(
        { features: { workerOutboxDelivery: true } } as never,
        () => undefined,
      ),
    ).toThrow("worker_outbox_delivery_capability_unavailable");
  });

  it("does not accept a prebuilt registry as a disabled-mode bypass", async () => {
    const { createProductionWorkerRuntimeFactory } = await import("./main.js");
    const registryFactory = vi.fn(() => ({ topics: [] }));
    const factory = createProductionWorkerRuntimeFactory({
      workerOutboxRegistryFactory: registryFactory,
      workerOutboxRegistry: { topics: ["provider.forbidden"] },
    } as never);

    await expect(
      factory.create({
        databaseUrl:
          "postgresql://worker:worker@localhost/worker?sslmode=require",
        features: { workerOutboxDelivery: false },
      } as never),
    ).resolves.toBeDefined();
    expect(registryFactory).not.toHaveBeenCalled();
  });

  it("accepts an injected YooKassa reader only with complete enabled metadata", async () => {
    const { selectExpertResidencyProviderReader } = await import("./main.js");
    const reader = {
      readPayments: vi.fn(async () => ({ kind: "disabled" as const })),
    };
    const enabled = {
      features: { yookassa: true },
      yookassa: {
        mode: "test",
        shopId: "123",
        secretReference: "env://YOOKASSA_SECRET_KEY",
        returnUrl: "https://ii-tonya.ru/return",
        receipt: {
          vatCode: 1,
          paymentSubject: "service",
          paymentMode: "full_payment",
        },
      },
    };

    expect(selectExpertResidencyProviderReader(enabled as never, reader)).toBe(
      reader,
    );
    expect(() => selectExpertResidencyProviderReader(enabled as never)).toThrow(
      "yookassa_worker_capability_unavailable",
    );
    expect(() =>
      selectExpertResidencyProviderReader(
        { features: { yookassa: false } } as never,
        reader,
      ),
    ).toThrow("yookassa_worker_capability_unexpected");
  });

  it("finishes the current bounded cycle and closes on a signal", async () => {
    const { runWorkerLoop } = await import("./main.js");
    const controller = new AbortController();
    const runtime = {
      runOnce: vi.fn(async () => {
        controller.abort();
        return { safetyHandoffs: {} } as never;
      }),
      close: vi.fn(async () => undefined),
    };

    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: 1,
    });

    expect(runtime.runOnce).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("updates the configured heartbeat after a successful built-worker cycle", async () => {
    const { runWorkerLoop } = await import("./main.js");
    const controller = new AbortController();
    const heartbeat = vi.fn(() => {
      controller.abort();
    });
    const runtime = {
      runOnce: vi.fn(async () => ({ safetyHandoffs: {} }) as never),
      close: vi.fn(async () => undefined),
    };

    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: 1,
      heartbeat,
    });

    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it("does not accumulate abort listeners between polling intervals", async () => {
    const { runWorkerLoop } = await import("./main.js");
    const controller = new AbortController();
    const listenerCounts: number[] = [];
    const runtime = {
      runOnce: vi.fn(async () => {
        listenerCounts.push(
          getEventListeners(controller.signal, "abort").length,
        );
        if (listenerCounts.length === 12) controller.abort();
        return { safetyHandoffs: {} } as never;
      }),
      close: vi.fn(async () => undefined),
    };

    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: 1,
    });

    expect(Math.max(...listenerCounts)).toBeLessThanOrEqual(1);
  });

  it("starts bounded close when a signal arrives during a hung cycle", async () => {
    const { runWorkerLoop } = await import("./main.js");
    const controller = new AbortController();
    const runtime = {
      runOnce: vi.fn(() => new Promise<never>(() => undefined)),
      close: vi.fn(async () => undefined),
    };
    setTimeout(() => {
      controller.abort();
    }, 5);

    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: 1,
    });

    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("hard-exits after the shutdown grace period when close never settles", async () => {
    const { main } = await import("./main.js");
    let finishClose: (() => void) | undefined;
    const runtime = {
      runOnce: vi.fn(() => new Promise<never>(() => undefined)),
      close: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishClose = resolve;
          }),
      ),
    };
    const hardExit = vi.fn();
    const running = main({
      env: {
        DATABASE_URL:
          "postgresql://worker:worker@localhost/worker?sslmode=require",
      },
      runtimeFactory: { create: vi.fn(async () => runtime) },
      pollIntervalMs: 1,
      shutdownGraceMs: 10,
      hardExit,
    });

    await vi.waitFor(() => {
      expect(runtime.runOnce).toHaveBeenCalledOnce();
    });
    process.emit("SIGTERM", "SIGTERM");
    try {
      await vi.waitFor(
        () => {
          expect(hardExit).toHaveBeenCalledWith(1);
        },
        { timeout: 500 },
      );
    } finally {
      finishClose?.();
    }
    await running;
    expect(hardExit).toHaveBeenCalledOnce();
  });

  it("clears the hard-exit watchdog after a clean signal close", async () => {
    const { main } = await import("./main.js");
    const runtime = {
      runOnce: vi.fn(() => new Promise<never>(() => undefined)),
      close: vi.fn(async () => undefined),
    };
    const hardExit = vi.fn();
    const running = main({
      env: {
        DATABASE_URL:
          "postgresql://worker:worker@localhost/worker?sslmode=require",
      },
      runtimeFactory: { create: vi.fn(async () => runtime) },
      pollIntervalMs: 1,
      shutdownGraceMs: 10,
      hardExit,
    });

    await vi.waitFor(() => {
      expect(runtime.runOnce).toHaveBeenCalledOnce();
    });
    process.emit("SIGTERM", "SIGTERM");
    await running;
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    expect(runtime.close).toHaveBeenCalledOnce();
    expect(hardExit).not.toHaveBeenCalled();
  });

  it("composes dedicated conversation jobs and starts leases outside the worker cycle", async () => {
    const { composeClientConversationWorker } = await import("./main.js");
    const operationRepository = {
      claimDispatch: vi.fn(async () => []),
      claimReconciliation: vi.fn(async () => []),
      recordResult: vi.fn(async () => "committed" as const),
      recordGrantDenied: vi.fn(async () => "committed" as const),
      recordRetryWait: vi.fn(async () => "committed" as const),
      recordUnknownOutcome: vi.fn(async () => "committed" as const),
      recordDeadLetter: vi.fn(async () => "committed" as const),
      recoverExpired: vi.fn(async () => ({ recovered: 1 })),
      cleanupExpired: vi.fn(async () => ({ expired: 2 })),
      heartbeatRuntime: vi.fn(async () => undefined),
    };
    const scheduler = {
      setInterval: vi.fn(() => "conversation-lease"),
      clearInterval: vi.fn(),
    };

    const composition = composeClientConversationWorker(
      {
        clientConversation: true,
        clientConversationToolDispatch: true,
      },
      {
        crypto: { decrypt: vi.fn() },
        operationRepository,
        catalogGateway: { request: vi.fn() },
        bookingGateway: { reserve: vi.fn() },
        buildSha: "a".repeat(40),
        instanceId: "worker-1",
        batchSize: 10,
        scheduler,
      },
    );
    if (composition === undefined) throw new Error("expected composition");

    await composition.start();
    await composition.runtimeJobs.cleanup();
    await composition.runtimeJobs.reconciliation();
    await composition.runtimeJobs.dispatch();

    expect(operationRepository.heartbeatRuntime).toHaveBeenCalledWith({
      buildSha: "a".repeat(40),
      instanceId: "worker-1",
    });
    expect(operationRepository.recoverExpired).toHaveBeenCalledOnce();
    expect(operationRepository.cleanupExpired).toHaveBeenCalledOnce();
    expect(operationRepository.claimReconciliation).toHaveBeenCalledOnce();
    expect(operationRepository.claimDispatch).toHaveBeenCalledOnce();
    await composition.runtimeJobs.runtimeLeases.stop();
    expect(scheduler.clearInterval).toHaveBeenCalledWith("conversation-lease");
  });

  it("fails enabled conversation dispatch before runtime creation when identity and crypto are absent", async () => {
    const { createProductionWorkerRuntimeFactory } = await import("./main.js");
    const factory = createProductionWorkerRuntimeFactory();

    await expect(
      factory.create({
        databaseUrl:
          "postgresql://worker:worker@localhost/worker?sslmode=require",
        features: {
          clientConversation: true,
          clientConversationToolDispatch: true,
        },
      } as never),
    ).rejects.toThrow("client_conversation_worker_configuration_incomplete");
  });
});
