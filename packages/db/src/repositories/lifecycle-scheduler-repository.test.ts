import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { DrizzleDb } from "../client.js";
import { PostgresLifecycleSchedulerRepository } from "./lifecycle-scheduler-repository.js";

const reservationId = "550e8400-e29b-41d4-a716-446655440000";
const jobId = "550e8400-e29b-41d4-a716-446655440001";
const dialogueId = "550e8400-e29b-41d4-a716-446655440002";
const outboxId = "550e8400-e29b-41d4-a716-446655440003";

describe("PostgreSQL lifecycle scheduler repository", () => {
  it("materializes one eligible reminder through one repository-owned transaction", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: jobId,
            leaseToken: "550e8400-e29b-41d4-a716-446655440004",
            jobType: "booking_reminder_24h",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            reservationId,
            userId: reservationId,
            startsAt: new Date("2026-09-02T10:00:00.000Z"),
            timezone: "Europe/Moscow",
            dialogueId,
            botKey: "client-test",
            chatId: "801",
            meetingUrl: "https://meet.example.test/booking",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ sequence: 1n }] })
      .mockResolvedValueOnce({ rows: [{ id: outboxId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: jobId }] });
    const transaction = vi.fn(
      async (work: (tx: { execute: typeof execute }) => unknown) =>
        work({ execute }),
    );
    const repository = new PostgresLifecycleSchedulerRepository(
      { transaction } as unknown as DrizzleDb,
      "client-messaging-v1",
      "client-test",
    );

    await expect(
      repository.processDueLifecycleBatch({
        now: new Date("2026-09-01T10:00:00.000Z"),
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 1, materialized: 1, cancelled: 0 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("contains the locking, authority rechecks, ordered outbox, and terminal fencing", () => {
    const source = readFileSync(
      new URL("./lifecycle-scheduler-repository.ts", import.meta.url),
      "utf8",
    );

    for (const required of [
      "for update skip locked",
      "client_messaging",
      "next_delivery_sequence",
      "telegram.send_text.v1",
      "dialogue_deliveries",
      "source_id",
      "lease_token",
      "status='succeeded'",
    ]) {
      expect(source).toContain(required);
    }
  });

  it("cancels an ineligible claimed reminder without allocating dialogue output", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: jobId,
            leaseToken: "550e8400-e29b-41d4-a716-446655440004",
            jobType: "booking_reminder_1h",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: jobId }] });
    const transaction = vi.fn(
      async (work: (tx: { execute: typeof execute }) => unknown) =>
        work({ execute }),
    );
    const repository = new PostgresLifecycleSchedulerRepository(
      { transaction } as unknown as DrizzleDb,
      "client-messaging-v1",
      "client-test",
    );

    await expect(
      repository.processDueLifecycleBatch({
        now: new Date("2026-09-01T10:00:00.000Z"),
        batchSize: 10,
      }),
    ).resolves.toEqual({ examined: 1, materialized: 0, cancelled: 1 });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
