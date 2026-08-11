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
      disabledExpertResidencyProviderReader.readPayments(),
    ).resolves.toEqual({ kind: "disabled" });
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
});
