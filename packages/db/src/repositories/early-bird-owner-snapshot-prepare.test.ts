import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresEarlyBirdOwnerSnapshotPrepare } from "./early-bird-owner-snapshot-prepare.js";

it("returns unavailable without invoking the sealer when the authoritative snapshot is absent", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const store = new PostgresEarlyBirdOwnerSnapshotPrepare({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  const seal = Object.assign(vi.fn(), {
    fingerprint: vi.fn(() => ({
      digest: "sha256:fixture",
      keyReference: "vault:fixture",
    })),
  });
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    grantId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
  };
  expect(await store.prepare(input, seal)).toEqual({ kind: "unavailable" });
  expect(seal).not.toHaveBeenCalled();
});

it("returns replay without resealing an already persisted matching operation", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [
        {
          offer: "2026-11-01T00:00:00.000Z",
          expiry: "2026-11-11T00:00:00.000Z",
          launch: "2027-01-10T21:00:00.000Z",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          exact: true,
          digest: "sha256:fixture",
          keyReference: "vault:fixture",
        },
      ],
    });
  const store = new PostgresEarlyBirdOwnerSnapshotPrepare({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    grantId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
  };
  const seal = Object.assign(vi.fn(), {
    fingerprint: vi.fn(() => ({
      digest: "sha256:fixture",
      keyReference: "vault:fixture",
    })),
  });
  expect(await store.prepare(input, seal)).toEqual({ kind: "replay" });
  expect(seal).not.toHaveBeenCalled();
});

it("rejects replay when canonical receipt fingerprint or key reference changed", async () => {
  for (const changed of [
    { digest: "sha256:changed", keyReference: "vault:fixture" },
    { digest: "sha256:fixture", keyReference: "vault:other" },
  ]) {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            offer: "2026-11-01T00:00:00.000Z",
            expiry: "2026-11-11T00:00:00.000Z",
            launch: "2027-01-10T21:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            exact: true,
            digest: "sha256:fixture",
            keyReference: "vault:fixture",
          },
        ],
      });
    const store = new PostgresEarlyBirdOwnerSnapshotPrepare({
      transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
    } as unknown as DrizzleDb);
    const input = {
      userId: randomUUID(),
      baseId: randomUUID(),
      choiceId: randomUUID(),
      grantId: randomUUID(),
      operationId: randomUUID(),
      invoiceId: randomUUID(),
      idempotencyKey: randomUUID(),
      requestExpiresAt: new Date().toISOString(),
    };
    const seal = Object.assign(vi.fn(), { fingerprint: vi.fn(() => changed) });
    expect(await store.prepare(input, seal)).toEqual({ kind: "unavailable" });
    expect(seal).not.toHaveBeenCalled();
  }
});

it("requires the stored intent timestamps to equal the locked DB snapshot on replay", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [
        {
          offer: "2026-11-01T00:00:00.000Z",
          expiry: "2026-11-11T00:00:00.000Z",
          launch: "2027-01-10T21:00:00.000Z",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          exact: false,
          digest: "sha256:fixture",
          keyReference: "vault:fixture",
        },
      ],
    });
  const store = new PostgresEarlyBirdOwnerSnapshotPrepare({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    grantId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
  };
  const seal = Object.assign(vi.fn(), {
    fingerprint: vi.fn(() => ({
      digest: "sha256:fixture",
      keyReference: "vault:fixture",
    })),
  });
  expect(await store.prepare(input, seal)).toEqual({ kind: "unavailable" });
  expect(seal.fingerprint).not.toHaveBeenCalled();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const query = new PgDialect().sqlToQuery(execute.mock.calls[4]![0]).sql;
  expect(query).toContain("i.base_offer_shown_at=b.base_offer_shown_at");
  expect(query).toContain(
    "i.expires_at=b.base_offer_shown_at+interval '240 hours'",
  );
  expect(query).toContain("i.launch_at=cfg.client_start_at");
});
it("does not seal if the selected receipt has disappeared before the subject lock", async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const store = new PostgresEarlyBirdOwnerSnapshotPrepare({
    transaction: (fn: (tx: unknown) => unknown) => fn({ execute }),
  } as unknown as DrizzleDb);
  const input = {
    userId: randomUUID(),
    baseId: randomUUID(),
    choiceId: randomUUID(),
    grantId: randomUUID(),
    operationId: randomUUID(),
    invoiceId: randomUUID(),
    idempotencyKey: randomUUID(),
    receiptContactId: randomUUID(),
    requestExpiresAt: new Date().toISOString(),
  };
  const seal = Object.assign(vi.fn(), { fingerprint: vi.fn() });
  expect(await store.prepare(input, seal)).toEqual({ kind: "unavailable" });
  expect(seal).not.toHaveBeenCalled();
});
