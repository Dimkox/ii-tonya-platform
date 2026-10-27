import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  clientDispatchPayloadDigest,
  type ClientDispatchAdmission,
} from "@ii-tonya/contracts";
import { createSelartiRequestDispatcher } from "./selarti-request-dispatcher.js";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxRepository,
} from "./outbox-runner.js";
const message = (): OutboxMessage => {
  const userId = randomUUID();
  return {
    id: randomUUID(),
    topic: "selarti.request.v1",
    payload: {
      requestId: "sha256:" + "a".repeat(64),
      dialogueId: randomUUID(),
      userId,
      correlationId: "request",
      text: "Synthetic",
      locale: "ru-RU",
      promptVersion: "v1",
      deadline: new Date(Date.now() + 60000).toISOString(),
      consentAuthority: {
        v: 1,
        subjectId: userId,
        purposes: {
          client_messaging: { decisionId: randomUUID(), revision: "1" },
          selarti_ai_processing: { decisionId: randomUUID(), revision: "2" },
        },
      },
    },
    attempt: 1,
    reconciliationKey: "sha256:" + "a".repeat(64),
    correlationId: "request",
    reconciliationAttempt: 0,
    dispatchClaimToken: "claim",
    reconciliationClaimToken: null,
  };
};
const receipt = (m: OutboxMessage): ClientDispatchAdmission => ({
  kind: "admitted",
  outboxId: m.id,
  topic: "selarti.request.v1",
  owner: "worker",
  claimToken: m.dispatchClaimToken!,
  attempt: m.attempt,
  attemptId: "attempt",
  reconciliationKey: m.reconciliationKey,
  payloadDigest: clientDispatchPayloadDigest(m.payload),
});
describe("fenced Selarti dispatch", () => {
  it("strips authority and preserves the request identity and provider outcome", async () => {
    const m = message(),
      request = vi.fn(async () => ({
        kind: "unknown_outcome" as const,
        reconciliationKey: m.reconciliationKey,
        reasonCode: "timeout_after_write",
      }));
    const dispatcher = createSelartiRequestDispatcher({
      transport: { request },
      admissionGate: { consume: async () => true },
    });
    expect(await dispatcher.dispatch(m, receipt(m))).toMatchObject({
      kind: "unknown_outcome",
    });
    const { consentAuthority: stamp, ...wire } = m.payload as Record<
      string,
      unknown
    >;
    expect(stamp).toBeDefined();
    expect(request).toHaveBeenCalledWith(wire);
    expect(await dispatcher.reconcile(m)).toBe("still_unknown");
  });
  it.each(["missing", "binding", "consume", "extra"] as const)(
    "never sends with %s failure",
    async (mode) => {
      const m = message(),
        admission = receipt(m),
        request = vi.fn();
      if (mode === "binding") m.attempt++;
      if (mode === "extra")
        (m.payload as Record<string, unknown>).url =
          "https://untrusted.example";
      const dispatcher = createSelartiRequestDispatcher({
        transport: { request },
        admissionGate: { consume: async () => mode !== "consume" },
      });
      expect(
        await dispatcher.dispatch(
          m,
          mode === "missing" ? undefined : admission,
        ),
      ).toMatchObject({ kind: "terminal" });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    "runner refuses missing admission and preserves uncertainty, admitted=%s",
    async (admitted) => {
      const m = message(),
        dispatch = vi.fn(async () => {
          throw new Error("uncertain");
        }),
        markUnknownOutcome = vi.fn(),
        retry = vi.fn();
      const repository = {
        recoverExpiredDispatchLeases: async () => 0,
        recoverExpiredReconciliationLeases: async () => 0,
        claimUnknown: async () => [],
        claim: async () => [m],
        recordAttemptStarted: async () => (admitted ? receipt(m) : undefined),
        markUnknownOutcome,
        retry,
      } as unknown as OutboxRepository;
      await runOutboxBatch({
        repository,
        dispatcher: { dispatch },
        reconciler: { reconcile: async () => "still_unknown" },
        now: () => new Date(),
        retryDelayMs: () => 1000,
        maxAttempts: 3,
        maxReconciliationAttempts: 3,
        batchSize: 1,
        workerId: "worker",
        newAttemptId: () => "attempt",
      });
      expect(dispatch).toHaveBeenCalledTimes(admitted ? 1 : 0);
      expect(markUnknownOutcome).toHaveBeenCalledTimes(admitted ? 1 : 0);
      expect(retry).not.toHaveBeenCalled();
    },
  );
});
