import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxRepository,
} from "./outbox-runner.js";

const message = (
  topic: "safety.operator_escalation" | "admin.negative_feedback",
  mode: string,
  input?: Partial<OutboxMessage>,
): OutboxMessage => ({
  id: randomUUID(),
  topic,
  payload: { mode, secret: `payload-${randomUUID()}` },
  correlationId: `correlation-${randomUUID()}`,
  attempt: 1,
  reconciliationKey: `reconcile-${randomUUID()}`,
  reconciliationAttempt: 1,
  dispatchClaimToken: `dispatch-${randomUUID()}`,
  reconciliationClaimToken: `reconciliation-${randomUUID()}`,
  ...input,
});

describe("worker outbox metrics", () => {
  it("records every runner path using only the closed metric vocabulary", async () => {
    const pending = [
      message("safety.operator_escalation", "applied"),
      message("admin.negative_feedback", "retry"),
      message("safety.operator_escalation", "throws"),
      message("admin.negative_feedback", "terminal"),
    ];
    const unknown = [
      message("safety.operator_escalation", "not_applied", { attempt: 3 }),
      message("admin.negative_feedback", "still_unknown", {
        reconciliationAttempt: 3,
      }),
    ];
    const repository = {
      recoverExpiredDispatchLeases: vi.fn(),
      recoverExpiredReconciliationLeases: vi.fn(),
      recoverExpiredDispatchLeasesByTopic: vi.fn(async () => [
        { topic: "safety.operator_escalation" as const, count: 1 },
      ]),
      recoverExpiredReconciliationLeasesByTopic: vi.fn(async () => [
        { topic: "admin.negative_feedback" as const, count: 1 },
      ]),
      claimUnknown: vi.fn(async () => unknown),
      claim: vi.fn(async () => pending),
      claimUnknownWithMetrics: vi.fn(async () => ({
        messages: unknown,
        exhausted: [],
      })),
      claimWithMetrics: vi.fn(async () => ({
        messages: pending,
        exhausted: [],
        authorityInvalid: [{ topic: "telegram.send_text.v1", count: 3 }],
      })),
      recordAttemptStarted: vi.fn(async () => undefined),
      markUnknownOutcome: vi.fn(async () => undefined),
      markStillUnknown: vi.fn(async () => undefined),
      succeed: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      deadLetterAndAlert: vi.fn(async () => undefined),
      succeedAfterReconciliation: vi.fn(async () => undefined),
      retryAfterReconciliation: vi.fn(async () => undefined),
      deadLetterAfterReconciliationAndAlert: vi.fn(async () => undefined),
    } as unknown as OutboxRepository;
    const records: unknown[] = [];
    const cleanupCounts: number[] = [];

    await runOutboxBatch({
      repository,
      dispatcher: {
        async dispatch(input) {
          const mode = (input.payload as { mode: string }).mode;
          if (mode === "applied") return { kind: "applied" as const };
          if (mode === "retry") {
            return {
              kind: "not_applied" as const,
              retryable: true,
              reasonCode: `do-not-label-${randomUUID()}`,
            };
          }
          if (mode === "terminal") {
            return {
              kind: "terminal" as const,
              reasonCode: "invalid_payload" as const,
            };
          }
          throw new Error(`do-not-label-${randomUUID()}`);
        },
      },
      reconciler: {
        async reconcile(input) {
          return (input.payload as { mode: string }).mode === "not_applied"
            ? "not_applied"
            : "still_unknown";
        },
      },
      metrics: {
        record: (labels, count) => {
          records.push(labels);
          if (labels.reasonClass === "client_authority_invalid")
            cleanupCounts.push(count!);
        },
      },
      now: () => new Date("2026-08-14T08:00:00.000Z"),
      retryDelayMs: () => 1_000,
      maxAttempts: 3,
      maxReconciliationAttempts: 3,
      batchSize: 10,
      workerId: "worker-test",
      newAttemptId: () => randomUUID(),
    });

    expect(repository.recoverExpiredDispatchLeases).not.toHaveBeenCalled();
    expect(
      repository.recoverExpiredReconciliationLeases,
    ).not.toHaveBeenCalled();
    expect(records.length).toBeGreaterThanOrEqual(12);
    expect(cleanupCounts).toEqual([3]);
    expect(records).toContainEqual({
      topic: "telegram_send_text",
      phase: "claim",
      outcome: "dead_letter",
      reasonClass: "client_authority_invalid",
    });
    for (const record of records as Record<string, unknown>[]) {
      expect(Object.keys(record).sort()).toEqual(
        ["outcome", "phase", "reasonClass", "topic"].sort(),
      );
      expect([
        "safety_operator_escalation",
        "admin_negative_feedback",
        "telegram_send_text",
      ]).toContain(record.topic);
      expect([
        "claim",
        "dispatch",
        "reconciliation",
        "lease_recovery",
      ]).toContain(record.phase);
      expect([
        "applied",
        "retry",
        "unknown",
        "terminal",
        "dead_letter",
        "no_op",
      ]).toContain(record.outcome);
      expect([
        "invalid_payload",
        "local_source_invalid",
        "client_authority_invalid",
        "attempts_exhausted",
        "reconciliation_exhausted",
        "lease_expired",
        "internal",
      ]).toContain(record.reasonClass);
    }
    const serialized = JSON.stringify(records);
    for (const item of [...pending, ...unknown]) {
      expect(serialized).not.toContain(item.id);
      expect(serialized).not.toContain(item.correlationId);
      expect(serialized).not.toContain(item.reconciliationKey);
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("do-not-label");
    }
    expect(serialized).toContain("attempts_exhausted");
    expect(serialized).toContain("reconciliation_exhausted");
    expect(serialized).toContain("lease_expired");
  });
});
