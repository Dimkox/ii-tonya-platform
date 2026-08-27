import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  createLocalOperatorCaseOutboxRegistry,
  type LocalOperatorCaseOutboxRepository,
} from "./local-operator-case-outbox.js";

const safetyPayload = () => ({
  handoffId: randomUUID(),
  version: 1,
  charge: 0 as const,
});

const feedbackPayload = () => ({
  feedbackId: randomUUID(),
  contentHash: "a".repeat(64),
  policyVersion: "negative-v1",
});

const repository = (
  materialize: LocalOperatorCaseOutboxRepository["materialize"] = vi.fn(
    async () => "materialized" as const,
  ),
  inspect: LocalOperatorCaseOutboxRepository["inspect"] = vi.fn(
    async () => "absent" as const,
  ),
): LocalOperatorCaseOutboxRepository => ({ materialize, inspect });

const message = (topic: string, payload: unknown) => ({
  id: randomUUID(),
  topic,
  payload,
});

describe("local operator-case outbox registry", () => {
  it("exposes one frozen literal tuple with exactly the two local topics", () => {
    const registry = createLocalOperatorCaseOutboxRegistry(repository());

    expect(LOCAL_OPERATOR_CASE_OUTBOX_TOPICS).toEqual([
      "safety.operator_escalation",
      "admin.negative_feedback",
    ]);
    expect(registry.topics).toBe(LOCAL_OPERATOR_CASE_OUTBOX_TOPICS);
    expect(Object.isFrozen(registry.topics)).toBe(true);
  });

  it("decodes and dispatches the exact safety locator without authority fields", async () => {
    const materialize = vi.fn(async () => "materialized" as const);
    const registry = createLocalOperatorCaseOutboxRegistry(
      repository(materialize),
    );
    const input = message("safety.operator_escalation", safetyPayload());

    await expect(registry.dispatch(input)).resolves.toEqual({
      kind: "applied",
    });
    expect(materialize).toHaveBeenCalledWith({
      outboxId: input.id,
      topic: "safety.operator_escalation",
      payload: input.payload,
    });
    expect(JSON.stringify(materialize.mock.calls[0])).not.toMatch(
      /amount|url|recipient|providerOperationId/u,
    );
  });

  it("uses the authoritative repository result for well-formed feedback evidence", async () => {
    const materialize = vi.fn(async () => "replayed" as const);
    const registry = createLocalOperatorCaseOutboxRegistry(
      repository(materialize),
    );
    const payload = feedbackPayload();
    payload.contentHash = "b".repeat(64);
    payload.policyVersion = "payload-mismatch-v9";
    const input = message("admin.negative_feedback", payload);

    await expect(registry.dispatch(input)).resolves.toEqual({
      kind: "applied",
    });
    expect(materialize).toHaveBeenCalledWith({
      outboxId: input.id,
      topic: "admin.negative_feedback",
      payload,
    });
  });

  it.each([
    ["missing safety field", { handoffId: randomUUID(), charge: 0 }],
    ["extra safety field", { ...safetyPayload(), recipient: "operator" }],
    ["wrong safety UUID", { ...safetyPayload(), handoffId: "NOT-A-UUID" }],
    [
      "noncanonical UUID",
      { ...safetyPayload(), handoffId: randomUUID().toUpperCase() },
    ],
    [
      "unsafe safety version",
      { ...safetyPayload(), version: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["zero safety version", { ...safetyPayload(), version: 0 }],
    ["noninteger safety version", { ...safetyPayload(), version: 1.5 }],
    ["nonzero charge", { ...safetyPayload(), charge: 1 }],
    ["wrong charge type", { ...safetyPayload(), charge: "0" }],
    ["safety array", [safetyPayload()]],
  ])("terminalizes invalid safety payload: %s", async (_name, payload) => {
    const materialize = vi.fn(async () => "materialized" as const);
    const registry = createLocalOperatorCaseOutboxRegistry(
      repository(materialize),
    );

    await expect(
      registry.dispatch(message("safety.operator_escalation", payload)),
    ).resolves.toEqual({ kind: "terminal", reasonCode: "invalid_payload" });
    expect(materialize).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing feedback field",
      { feedbackId: randomUUID(), contentHash: "a".repeat(64) },
    ],
    ["extra feedback field", { ...feedbackPayload(), amount: "1.00" }],
    ["wrong feedback UUID", { ...feedbackPayload(), feedbackId: "nope" }],
    ["uppercase hash", { ...feedbackPayload(), contentHash: "A".repeat(64) }],
    ["short hash", { ...feedbackPayload(), contentHash: "a".repeat(63) }],
    ["wrong hash type", { ...feedbackPayload(), contentHash: 42 }],
    ["invalid policy", { ...feedbackPayload(), policyVersion: "bad policy" }],
    ["long policy", { ...feedbackPayload(), policyVersion: "v".repeat(65) }],
    ["feedback array", [feedbackPayload()]],
  ])("terminalizes invalid feedback payload: %s", async (_name, payload) => {
    const materialize = vi.fn(async () => "materialized" as const);
    const registry = createLocalOperatorCaseOutboxRegistry(
      repository(materialize),
    );

    await expect(
      registry.dispatch(message("admin.negative_feedback", payload)),
    ).resolves.toEqual({ kind: "terminal", reasonCode: "invalid_payload" });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("rejects inherited enumerable authority and unregistered topics", async () => {
    const registry = createLocalOperatorCaseOutboxRegistry(repository());
    const payload = Object.assign(
      Object.create({ providerOperationId: "forbidden" }) as object,
      safetyPayload(),
    );

    await expect(
      registry.dispatch(message("safety.operator_escalation", payload)),
    ).resolves.toEqual({ kind: "terminal", reasonCode: "invalid_payload" });
    await expect(
      registry.dispatch(message("telegram.notification", {})),
    ).rejects.toThrow("worker_outbox_topic_unregistered");
  });

  it("maps durable source and inspection states into closed dispatch results", async () => {
    const sourceInvalid = createLocalOperatorCaseOutboxRegistry(
      repository(vi.fn(async () => "source_invalid" as const)),
    );
    await expect(
      sourceInvalid.dispatch(
        message("safety.operator_escalation", safetyPayload()),
      ),
    ).resolves.toEqual({
      kind: "terminal",
      reasonCode: "local_source_invalid",
    });

    const applied = createLocalOperatorCaseOutboxRegistry(
      repository(
        undefined,
        vi.fn(async () => "applied" as const),
      ),
    );
    await expect(
      applied.reconcile(message("admin.negative_feedback", feedbackPayload())),
    ).resolves.toEqual({ kind: "applied" });

    const absent = createLocalOperatorCaseOutboxRegistry(repository());
    await expect(
      absent.reconcile(message("admin.negative_feedback", feedbackPayload())),
    ).resolves.toEqual({ kind: "not_applied" });

    const invalid = createLocalOperatorCaseOutboxRegistry(
      repository(
        undefined,
        vi.fn(async () => "source_invalid" as const),
      ),
    );
    await expect(
      invalid.reconcile(message("safety.operator_escalation", safetyPayload())),
    ).resolves.toEqual({
      kind: "terminal",
      reasonCode: "local_source_invalid",
    });
  });
});
