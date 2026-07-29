import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import {
  startTestPostgres,
  type TestPostgresDependencies,
} from "./postgres.js";

const container = () => ({
  getConnectionUri: () => "postgres://test",
  stop: vi.fn(async () => undefined),
});

describe("PostgreSQL testkit lifecycle", () => {
  it("does not stop the container until pool shutdown settles", async () => {
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
      createDb: vi.fn(() => ({}) as DrizzleDb),
    };
    const testDb = await startTestPostgres(dependencies);

    const stopping = testDb.stop();
    await vi.waitFor(() => expect(pool.end).toHaveBeenCalledOnce());
    expect(startedContainer.stop).not.toHaveBeenCalled();
    settlePool?.();
    await stopping;
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
