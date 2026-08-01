import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";

describe("worker main", () => {
  it("can be imported without starting the polling loop", async () => {
    const module = await import("./main.js");

    expect(module.main).toBeTypeOf("function");
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

  it("does not accumulate abort listeners between polling intervals", async () => {
    const { runWorkerLoop } = await import("./main.js");
    const controller = new AbortController();
    const listenerCounts: number[] = [];
    const runtime = {
      runOnce: vi.fn(async () => {
        listenerCounts.push(getEventListeners(controller.signal, "abort").length);
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
    setTimeout(() => { controller.abort(); }, 5);

    await runWorkerLoop(runtime, {
      signal: controller.signal,
      pollIntervalMs: 1,
    });

    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
