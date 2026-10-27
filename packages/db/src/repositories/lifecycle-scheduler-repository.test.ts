import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { DrizzleDb } from "../client.js";
import { PostgresLifecycleSchedulerRepository } from "./lifecycle-scheduler-repository.js";

const reservationId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const dialogueId = "00000000-0000-4000-8000-000000000003";
const outboxId = "00000000-0000-4000-8000-000000000004";
const leaseToken = "00000000-0000-4000-8000-000000000005";

describe("PostgreSQL lifecycle scheduler repository", () => {
  it("materializes one eligible reminder through one repository-owned transaction", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: jobId,
            leaseToken,
            jobType: "booking_reminder_24h",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ userId: reservationId }] })
      .mockResolvedValueOnce({ rows: [] })
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
      .mockResolvedValueOnce({ rows: [{ userId: reservationId }] })
      .mockResolvedValueOnce({
        rows: [
          {
            decisionId: leaseToken,
            revision: "1",
            policyVersion: "client-messaging-v1",
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
    expect(execute).toHaveBeenCalledTimes(13);
  });

  it("contains the locking, authority rechecks, ordered outbox, and terminal fencing", () => {
    const source = readFileSync(
      new URL("./lifecycle-scheduler-repository.ts", import.meta.url),
      "utf8",
    );

    for (const required of [
      "for update skip locked",
      "lease_until <=",
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: jobId,
            leaseToken,
            jobType: "booking_reminder_1h",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
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
    expect(execute).toHaveBeenCalledTimes(6);
  });
});
