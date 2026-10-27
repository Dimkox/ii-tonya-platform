import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { installFatalProcessLogging } from "./fatal-logging.js";
import { createLogger } from "./logger.js";

type Listener = (error: unknown) => void;

/** Фейковый process: собираем слушателей и дёрнем их руками. */
const fakeTarget = () => {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    removeListener(event: string, listener: Listener) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((x) => x !== listener),
      );
    },
    emit(event: string, error: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(error);
    },
  };
};

describe("fatal process logging", () => {
  it("installs both handlers and removes them on teardown", () => {
    const target = fakeTarget();
    const teardown = installFatalProcessLogging(
      {
        logger: createLogger(),
        exit: () => undefined,
      } as never,
      target as never,
    );
    expect(target.listeners.get("uncaughtException")).toHaveLength(1);
    expect(target.listeners.get("unhandledRejection")).toHaveLength(1);
    teardown();
    expect(target.listeners.get("uncaughtException")).toHaveLength(0);
    expect(target.listeners.get("unhandledRejection")).toHaveLength(0);
  });

  it("logs an uncaught exception through the sanitizer and exits with 1", async () => {
    const target = fakeTarget();
    const exit = vi.fn();
    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    installFatalProcessLogging(
      { logger: createLogger(output), exit },
      target as never,
    );

    target.emit(
      "uncaughtException",
      new Error(
        "connect failed for postgres://user:Sup3rSecret@db.internal:5432/app " +
          "and /v1/webhooks/telegram/client/kk_7Td9mQz2LpXvN4sYbR8cE1uHwA6iO3gF",
      ),
    );
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");

    expect(exit).toHaveBeenCalledWith(1);
    expect(line).not.toContain("connect failed for postgres://");
    expect(line).toContain('"event":"process_fatal"');
    expect(line).toContain('"failureClass":"internal_error"');
    expect(line).toContain("uncaughtException");
    expect(line).not.toContain("Sup3rSecret");
    expect(line).not.toContain("kk_7Td9mQz2LpXvN4sYbR8cE1uHwA6iO3gF");
  });

  it("drops a non-Error rejection reason and still exits", async () => {
    const target = fakeTarget();
    const exit = vi.fn();
    const onFatal = vi.fn();
    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    installFatalProcessLogging(
      { logger: createLogger(output), exit, onFatal },
      target as never,
    );

    target.emit("unhandledRejection", "boom token=plainsecretvalue");
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");

    expect(exit).toHaveBeenCalledWith(1);
    expect(onFatal).toHaveBeenCalledWith(
      expect.any(String),
      "unhandledRejection",
    );
    expect(line).not.toContain("boom");
    expect(line).toContain('"fatal":"unhandledRejection"');
    expect(line).not.toContain("plainsecretvalue");
  });

  it("does not invoke arbitrary rejection coercion or getters and retains exit on diagnostics failure", async () => {
    const target = fakeTarget();
    const exit = vi.fn();
    const invoked = vi.fn(() => {
      throw new Error("private canary");
    });
    const logger = createLogger(new PassThrough());
    const reason = {
      toString: invoked,
      toJSON: invoked,
      get code() {
        return invoked();
      },
    };
    const uninstall = installFatalProcessLogging({ logger, exit }, target);
    expect(() => target.emit("unhandledRejection", reason)).not.toThrow();
    expect(invoked).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    uninstall();
    exit.mockClear();
    installFatalProcessLogging(
      {
        logger,
        exit,
        onFatal: () => {
          throw new Error("private hook failure");
        },
      },
      target,
    );
    vi.spyOn(logger, "error").mockImplementation(() => {
      throw new Error("sink failure");
    });
    expect(() => target.emit("uncaughtException", reason)).not.toThrow();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
