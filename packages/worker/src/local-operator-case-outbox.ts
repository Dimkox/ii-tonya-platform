export const LOCAL_OPERATOR_CASE_OUTBOX_TOPICS = Object.freeze([
  "safety.operator_escalation",
  "admin.negative_feedback",
] as const);

export type LocalOutboxTopic =
  (typeof LOCAL_OPERATOR_CASE_OUTBOX_TOPICS)[number];

export type SafetyOperatorEscalationPayload = Readonly<{
  handoffId: string;
  version: number;
  charge: 0;
}>;

export type AdminNegativeFeedbackPayload = Readonly<{
  feedbackId: string;
  contentHash: string;
  policyVersion: string;
}>;

export type LocalOperatorCaseMessage =
  | Readonly<{
      outboxId: string;
      topic: "safety.operator_escalation";
      payload: SafetyOperatorEscalationPayload;
    }>
  | Readonly<{
      outboxId: string;
      topic: "admin.negative_feedback";
      payload: AdminNegativeFeedbackPayload;
    }>;

export interface LocalOperatorCaseOutboxRepository {
  materialize(
    input: LocalOperatorCaseMessage,
  ): Promise<"materialized" | "replayed" | "source_invalid">;
  inspect(input: Readonly<{
    outboxId: string;
    topic: LocalOutboxTopic;
  }>): Promise<"applied" | "absent" | "source_invalid">;
}

type LocalOutboxInput = Readonly<{
  id: string;
  topic: string;
  payload: unknown;
}>;

export type LocalDispatchResult =
  | Readonly<{ kind: "applied" }>
  | Readonly<{
      kind: "not_applied";
      retryable: true;
      reasonCode: string;
    }>
  | Readonly<{
      kind: "terminal";
      reasonCode: "invalid_payload" | "local_source_invalid";
    }>;

export type LocalReconciliationResult =
  | Readonly<{ kind: "applied" }>
  | Readonly<{ kind: "not_applied" }>
  | Readonly<{ kind: "still_unknown" }>
  | Readonly<{
      kind: "terminal";
      reasonCode: "invalid_payload" | "local_source_invalid";
    }>;

export interface LocalOperatorCaseOutboxRegistry {
  readonly topics: typeof LOCAL_OPERATOR_CASE_OUTBOX_TOPICS;
  dispatch(message: LocalOutboxInput): Promise<LocalDispatchResult>;
  reconcile(message: LocalOutboxInput): Promise<LocalReconciliationResult>;
}

class InvalidLocalOutboxPayloadError extends Error {
  constructor() {
    super("invalid_payload");
    this.name = "InvalidLocalOutboxPayloadError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const POLICY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidLocalOutboxPayloadError();
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidLocalOutboxPayloadError();
  }
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    throw new InvalidLocalOutboxPayloadError();
  }
  return value as Record<string, unknown>;
}

function canonicalUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new InvalidLocalOutboxPayloadError();
  }
  return value;
}

function decodeSafety(value: unknown): SafetyOperatorEscalationPayload {
  const record = exactRecord(value, ["handoffId", "version", "charge"]);
  if (
    !Number.isSafeInteger(record.version) ||
    (record.version as number) < 1 ||
    record.charge !== 0
  ) {
    throw new InvalidLocalOutboxPayloadError();
  }
  return Object.freeze({
    handoffId: canonicalUuid(record.handoffId),
    version: record.version as number,
    charge: 0,
  });
}

function decodeFeedback(value: unknown): AdminNegativeFeedbackPayload {
  const record = exactRecord(value, [
    "feedbackId",
    "contentHash",
    "policyVersion",
  ]);
  if (
    typeof record.contentHash !== "string" ||
    !HASH_PATTERN.test(record.contentHash) ||
    typeof record.policyVersion !== "string" ||
    !POLICY_PATTERN.test(record.policyVersion)
  ) {
    throw new InvalidLocalOutboxPayloadError();
  }
  return Object.freeze({
    feedbackId: canonicalUuid(record.feedbackId),
    contentHash: record.contentHash,
    policyVersion: record.policyVersion,
  });
}

function decodeMessage(message: LocalOutboxInput): LocalOperatorCaseMessage {
  const outboxId = canonicalUuid(message.id);
  if (message.topic === "safety.operator_escalation") {
    return Object.freeze({
      outboxId,
      topic: message.topic,
      payload: decodeSafety(message.payload),
    });
  }
  if (message.topic === "admin.negative_feedback") {
    return Object.freeze({
      outboxId,
      topic: message.topic,
      payload: decodeFeedback(message.payload),
    });
  }
  throw new Error("worker_outbox_topic_unregistered");
}

function isInvalidPayload(
  error: unknown,
): error is InvalidLocalOutboxPayloadError {
  return error instanceof InvalidLocalOutboxPayloadError;
}

export function createLocalOperatorCaseOutboxRegistry(
  repository: LocalOperatorCaseOutboxRepository,
): LocalOperatorCaseOutboxRegistry {
  if (
    typeof repository.materialize !== "function" ||
    typeof repository.inspect !== "function"
  ) {
    throw new Error("worker_outbox_delivery_capability_unavailable");
  }
  return Object.freeze({
    topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
    async dispatch(message: LocalOutboxInput): Promise<LocalDispatchResult> {
      let decoded: LocalOperatorCaseMessage;
      try {
        decoded = decodeMessage(message);
      } catch (error) {
        if (isInvalidPayload(error)) {
          return { kind: "terminal", reasonCode: "invalid_payload" };
        }
        throw error;
      }
      const result = await repository.materialize(decoded);
      return result === "source_invalid"
        ? { kind: "terminal", reasonCode: "local_source_invalid" }
        : { kind: "applied" };
    },
    async reconcile(
      message: LocalOutboxInput,
    ): Promise<LocalReconciliationResult> {
      let decoded: LocalOperatorCaseMessage;
      try {
        decoded = decodeMessage(message);
      } catch (error) {
        if (isInvalidPayload(error)) {
          return { kind: "terminal", reasonCode: "invalid_payload" };
        }
        throw error;
      }
      const result = await repository.inspect({
        outboxId: decoded.outboxId,
        topic: decoded.topic,
      });
      if (result === "applied") return { kind: "applied" };
      if (result === "absent") return { kind: "not_applied" };
      return { kind: "terminal", reasonCode: "local_source_invalid" };
    },
  });
}
