import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import {
  PostgresClientClosureTimeoutError,
  resetWithImmutableExpertReferralAdminResults,
  startTestPostgres,
  trackPoolClientClosures,
  type TestPostgresDependencies,
} from "./postgres.js";

const container = () => ({
  getConnectionUri: () => "postgres://test",
  stop: vi.fn(async () => undefined),
});

describe("PostgreSQL testkit lifecycle", () => {
  it("wraps replay-ledger reset and trigger verification in one transaction", async () => {
    const events: string[] = [];
    let executeCount = 0;
    const execute = vi.fn(async () => {
      events.push(`sql-${++executeCount}`);
      return executeCount === 5
        ? {
            rows: [
              { name: "expert_referral_admin_results_immutable", enabled: "O" },
              {
                name: "expert_referral_admin_results_truncate_immutable",
                enabled: "O",
              },
            ],
          }
        : { rows: [] };
    });
    const db = {
      transaction: vi.fn(
        async (
          operation: (tx: { execute: typeof execute }) => Promise<unknown>,
        ) => {
          events.push("transaction-start");
          const result = await operation({ execute });
          events.push("transaction-commit");
          return result;
        },
      ),
    } as unknown as DrizzleDb;

    await resetWithImmutableExpertReferralAdminResults(db, async () => {
      events.push("reset");
    });

    expect(events).toEqual([
      "transaction-start",
      "sql-1",
      "sql-2",
      "reset",
      "sql-3",
      "sql-4",
      "sql-5",
      "transaction-commit",
    ]);
  });

  it("does not stop the container until tracked client shutdown settles", async () => {
    const startedContainer = container();
    let settleClient: (() => void) | undefined;
    const pool = {
      end: vi.fn(async () => undefined),
      waitForClosedClients: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            settleClient = resolve;
          }),
      ),
    };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    const stopping = testDb.stop();
    await vi.waitFor(() => expect(pool.end).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(pool.waitForClosedClients).toHaveBeenCalledOnce(),
    );
    expect(startedContainer.stop).not.toHaveBeenCalled();
    settleClient?.();
    await stopping;
    expect(startedContainer.stop).toHaveBeenCalledOnce();
  });

  it("tracks clients connected before shutdown until their terminal end", async () => {
    const rawPool = new EventEmitter() as Pool;
    rawPool.end = vi.fn(async () => undefined);
    const pool = trackPoolClientClosures(rawPool);
    const client = new EventEmitter() as PoolClient;

    rawPool.emit("connect", client);
    await pool.end();
    let clientsClosed = false;
    const waiting = pool.waitForClosedClients?.().then(() => {
      clientsClosed = true;
    });

    await Promise.resolve();
    expect(clientsClosed).toBe(false);
    client.emit("end");
    await waiting;
    expect(clientsClosed).toBe(true);
    expect(rawPool.listenerCount("connect")).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("tracks a client that connects while shutdown is in progress", async () => {
    const rawPool = new EventEmitter() as Pool;
    let settlePool: (() => void) | undefined;
    rawPool.end = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          settlePool = resolve;
        }),
    );
    const pool = trackPoolClientClosures(rawPool);
    const client = new EventEmitter() as PoolClient;

    const ending = pool.end();
    rawPool.emit("connect", client);
    settlePool?.();
    await ending;
    const waiting = pool.waitForClosedClients?.();

    client.emit("end");
    await waiting;
    expect(rawPool.listenerCount("connect")).toBe(0);
  });

  it("records client errors but waits for the terminal end event", async () => {
    const rawPool = new EventEmitter() as Pool;
    rawPool.end = vi.fn(async () => undefined);
    const pool = trackPoolClientClosures(rawPool);
    const client = new EventEmitter() as PoolClient;
    const closureFailure = new Error("client close failed");
    let outcome: "pending" | "resolved" | Error = "pending";

    rawPool.emit("connect", client);
    const waiting = pool.waitForClosedClients?.().then(
      () => {
        outcome = "resolved";
      },
      (error: Error) => {
        outcome = error;
      },
    );
    client.emit("error", closureFailure);
    const beforeEnd = await Promise.race([
      waiting?.then(() => "settled"),
      new Promise<"pending">((resolve) => {
        setImmediate(() => resolve("pending"));
      }),
    ]);

    expect(beforeEnd).toBe("pending");
    expect(outcome).toBe("pending");
    client.emit("end");
    await waiting;
    expect(outcome).toBe(closureFailure);
    expect(client.listenerCount("end")).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("surfaces tracked client errors after still stopping the container", async () => {
    const startedContainer = container();
    const closureFailure = new Error("client close failed");
    const pool = {
      end: vi.fn(async () => undefined),
      waitForClosedClients: vi.fn(async () => Promise.reject(closureFailure)),
    };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    await expect(testDb.stop()).rejects.toBe(closureFailure);
    expect(startedContainer.stop).toHaveBeenCalledOnce();
  });

  it("stops the container and pool when database initialization fails", async () => {
    const startedContainer = container();
    const pool = { end: vi.fn(async () => undefined) };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => {
        throw new Error("db init failed");
      }),
    };

    await expect(startTestPostgres(dependencies)).rejects.toThrow("db init failed");
    expect(pool.end).toHaveBeenCalledOnce();
    expect(startedContainer.stop).toHaveBeenCalledOnce();
  });

  it("orders initialization-failure cleanup after pool shutdown settles", async () => {
    const startedContainer = container();
    let settlePool: (() => void) | undefined;
    const pool = {
      end: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            settlePool = resolve;
          }),
      ),
    };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => {
        throw new Error("db init failed");
      }),
    };

    const starting = startTestPostgres(dependencies);
    await vi.waitFor(() => expect(pool.end).toHaveBeenCalledOnce());
    expect(startedContainer.stop).not.toHaveBeenCalled();
    settlePool?.();
    await expect(starting).rejects.toThrow("db init failed");
    expect(startedContainer.stop).toHaveBeenCalledOnce();
  });

  it("attempts container shutdown when pool shutdown rejects", async () => {
    const startedContainer = container();
    const pool = { end: vi.fn(async () => Promise.reject(new Error("pool close failed"))) };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    await expect(testDb.stop()).rejects.toThrow("pool close failed");
    expect(startedContainer.stop).toHaveBeenCalledOnce();
  });

  it("waits for tracked clients and cleans listeners when pool shutdown rejects", async () => {
    const startedContainer = container();
    const poolFailure = new Error("pool close failed");
    let rejectPool: ((error: Error) => void) | undefined;
    const rawPool = new EventEmitter() as Pool;
    rawPool.end = vi.fn(
      async () =>
        new Promise<void>((_resolve, reject) => {
          rejectPool = reject;
        }),
    );
    const pool = trackPoolClientClosures(rawPool);
    const client = new EventEmitter() as PoolClient;
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    const stopping = testDb.stop();
    await vi.waitFor(() => expect(rawPool.end).toHaveBeenCalledOnce());
    rawPool.emit("connect", client);
    rejectPool?.(poolFailure);
    await Promise.resolve();
    expect(startedContainer.stop).not.toHaveBeenCalled();
    client.emit("end");
    await expect(stopping).rejects.toBe(poolFailure);
    expect(startedContainer.stop).toHaveBeenCalledOnce();
    expect(rawPool.listenerCount("connect")).toBe(0);
  });

  it("times out a missing terminal event, cleans listeners, and stops the container", async () => {
    vi.useFakeTimers();
    try {
      const startedContainer = container();
      const rawPool = new EventEmitter() as Pool;
      rawPool.end = vi.fn(async () => undefined);
      const pool = trackPoolClientClosures(rawPool, {
        shutdownTimeoutMs: 25,
      });
      const client = new EventEmitter() as PoolClient;
      const dependencies: TestPostgresDependencies = {
        startContainer: vi.fn(async () => startedContainer),
        createPool: vi.fn(() => pool),
        createDb: vi.fn(() => ({}) as DrizzleDb),
      };
      const testDb = await startTestPostgres(dependencies);

      rawPool.emit("connect", client);
      const stopping = testDb.stop();
      const rejected = expect(stopping).rejects.toBeInstanceOf(
        PostgresClientClosureTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(startedContainer.stop).toHaveBeenCalledOnce();
      expect(rawPool.listenerCount("connect")).toBe(0);
      expect(client.listenerCount("end")).toBe(0);
      expect(client.listenerCount("error")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregates pool rejection before a bounded client closure timeout", async () => {
    vi.useFakeTimers();
    try {
      const startedContainer = container();
      const poolFailure = new Error("pool close failed");
      const rawPool = new EventEmitter() as Pool;
      rawPool.end = vi.fn(async () => Promise.reject(poolFailure));
      const pool = trackPoolClientClosures(rawPool, {
        shutdownTimeoutMs: 25,
      });
      const client = new EventEmitter() as PoolClient;
      const dependencies: TestPostgresDependencies = {
        startContainer: vi.fn(async () => startedContainer),
        createPool: vi.fn(() => pool),
        createDb: vi.fn(() => ({}) as DrizzleDb),
      };
      const testDb = await startTestPostgres(dependencies);

      rawPool.emit("connect", client);
      const stopping = testDb.stop();
      const rejected = expect(stopping).rejects.toMatchObject({
        message: "Failed to stop test database resources",
        errors: [
          poolFailure,
          expect.any(PostgresClientClosureTimeoutError),
        ],
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(startedContainer.stop).toHaveBeenCalledOnce();
      expect(rawPool.listenerCount("connect")).toBe(0);
      expect(client.listenerCount("end")).toBe(0);
      expect(client.listenerCount("error")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregates ordered pool and container shutdown failures", async () => {
    const poolFailure = new Error("pool close failed");
    const containerFailure = new Error("container close failed");
    const startedContainer = {
      getConnectionUri: () => "postgres://test",
      stop: vi.fn(async () => Promise.reject(containerFailure)),
    };
    const pool = {
      end: vi.fn(async () => Promise.reject(poolFailure)),
    };
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    const rejection = testDb.stop();
    await expect(rejection).rejects.toBeInstanceOf(AggregateError);
    await expect(rejection).rejects.toMatchObject({
      message: "Failed to stop test database resources",
      errors: [poolFailure, containerFailure],
    });
  });

  it("normalizes raw PostgreSQL callback timestamps at the testkit boundary", async () => {
    const startedContainer = container();
    const pool = { end: vi.fn(async () => undefined) };
    const execute = vi.fn(async () => ({
      rows: [{ consumedAt: "2026-07-28 10:00:00+00" }],
    }));
    const dependencies: TestPostgresDependencies = {
      startContainer: vi.fn(async () => startedContainer),
      createPool: vi.fn(() => pool),
      createDb: vi.fn(() => ({ execute }) as unknown as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    await expect(
      testDb.callbackConsumedAt("00000000-0000-0000-0000-000000000001"),
    ).resolves.toEqual(new Date("2026-07-28T10:00:00.000Z"));
    await testDb.stop();
  });
});
