import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "@ii-tonya/db";
import { clientDispatchPayloadDigest } from "../../../packages/contracts/src/client-consent-authority.js";
import { createClientAsyncOutboxRegistry } from "./client-async-outbox.js";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxRepository,
  type OutboxReconciler,
} from "../../../packages/worker/src/outbox-runner.js";

// No PG connection: tests the real durable-facts mapper -> registry -> runner consumer.
function lifecycle() {
  let state = "unknown_outcome";
  let retries = 0;
  let dispatches = 0;
  let terminalReason: string | undefined;
  const message: OutboxMessage = {
    id: "00000000-0000-4000-8000-000000000001",
    topic: "selarti.request.v1",
    payload: { redacted: true },
    correlationId: "synthetic",
    attempt: 1,
    reconciliationKey: `sha256:${"a".repeat(64)}`,
    reconciliationAttempt: 1,
    dispatchClaimToken: "dispatch",
    reconciliationClaimToken: "reconcile",
  };
  const unexpected = async () => {
    throw new Error("unexpected lifecycle transition");
  };
  const repository: OutboxRepository = {
    claimUnknown: async () => (state === "unknown_outcome" ? [message] : []),
    claim: async () => (state === "retry_wait" ? [message] : []),
    recoverExpiredDispatchLeases: async () => 0,
    recoverExpiredReconciliationLeases: async () => 0,
    recordAttemptStarted: async (_id, owner, claimToken, attemptId) => ({
      kind: "admitted",
      outboxId: message.id,
      topic: "selarti.request.v1",
      owner,
      claimToken,
      attempt: message.attempt,
      attemptId,
      reconciliationKey: message.reconciliationKey,
      payloadDigest: clientDispatchPayloadDigest(message.payload),
    }),
    retryAfterReconciliation: async () => {
      retries++;
      state = "retry_wait";
    },
    deadLetterAfterReconciliationAndAlert: async (
      _id,
      _owner,
      _token,
      reason,
    ) => {
      state = "dead_letter";
      terminalReason = reason;
    },
    succeedAfterReconciliation: async () => {
      state = "succeeded";
    },
    markStillUnknown: async () => {
      state = "unknown_outcome";
    },
    succeed: async () => {
      state = "succeeded";
    },
    retry: unexpected,
    deadLetterAndAlert: unexpected,
    markUnknownOutcome: unexpected,
  };
  const run = (reconciler: OutboxReconciler) =>
    runOutboxBatch({
      repository,
      reconciler,
      dispatcher: {
        dispatch: async () => {
          dispatches++;
          return { kind: "applied" };
        },
      },
      workerId: "synthetic-worker",
      batchSize: 10,
      maxAttempts: 3,
      maxReconciliationAttempts: 3,
      now: () => new Date(),
      retryDelayMs: () => 0,
      newAttemptId: () => "synthetic-attempt",
    });
  return {
    run,
    snapshot: () => ({ state, retries, dispatches, terminalReason }),
  };
}

function registry(
  facts:
    { started: boolean; applied: boolean; notApplied: boolean } | undefined,
) {
  const db = {
    execute: async () => ({ rows: facts ? [facts] : [] }),
  } as unknown as DrizzleDb;
  return createClientAsyncOutboxRegistry(
    db,
    "synthetic-bot",
    {
      telegram: {
        sendMessageUrl: new URL("https://invalid.test"),
        transport: {
          request: async () => {
            throw new Error("no provider calls");
          },
        },
      },
      selarti: {
        request: async () => {
          throw new Error("no provider calls");
        },
      },
    },
    true,
  );
}

describe("final financial nonapplication at the real runner boundary (non-PG)", () => {
  it("terminalizes a final usage/trial nonapplication without retry or redispatch across cycles", async () => {
    const test = lifecycle();
    const reconciler = registry({
      started: true,
      applied: false,
      notApplied: true,
    });
    await test.run(reconciler);
    await test.run(reconciler);
    expect(test.snapshot()).toEqual({
      state: "dead_letter",
      retries: 0,
      dispatches: 0,
      terminalReason: "provider_not_applied",
    });
  });
  it("preserves unknown for missing, unstarted or contradictory facts", async () => {
    for (const facts of [
      undefined,
      { started: false, applied: false, notApplied: true },
      { started: true, applied: true, notApplied: true },
      { started: true, applied: false, notApplied: false },
    ]) {
      const test = lifecycle();
      await test.run(registry(facts));
      expect(test.snapshot()).toEqual({
        state: "unknown_outcome",
        retries: 0,
        dispatches: 0,
        terminalReason: undefined,
      });
    }
  });
  it("still settles a durable applied reply without redispatch", async () => {
    const test = lifecycle();
    await test.run(
      registry({ started: true, applied: true, notApplied: false }),
    );
    expect(test.snapshot()).toEqual({
      state: "succeeded",
      retries: 0,
      dispatches: 0,
      terminalReason: undefined,
    });
  });
  it("preserves the existing retryable transport reconciliation contract", async () => {
    const test = lifecycle();
    await test.run({ reconcile: async () => "not_applied" });
    expect(test.snapshot()).toEqual({
      state: "succeeded",
      retries: 1,
      dispatches: 1,
      terminalReason: undefined,
    });
  });
});
