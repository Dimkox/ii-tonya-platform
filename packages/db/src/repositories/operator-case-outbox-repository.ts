import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const POLICY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

type LocalOutboxTopic =
  "safety.operator_escalation" | "admin.negative_feedback";
type SafetyPayload = Readonly<{
  handoffId: string;
  version: number;
  charge: 0;
}>;
type FeedbackPayload = Readonly<{
  feedbackId: string;
  contentHash: string;
  policyVersion: string;
}>;
export type OperatorCaseOutboxMessage =
  | Readonly<{
      outboxId: string;
      topic: "safety.operator_escalation";
      payload: SafetyPayload;
    }>
  | Readonly<{
      outboxId: string;
      topic: "admin.negative_feedback";
      payload: FeedbackPayload;
    }>;

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

interface OutboxRow extends Record<string, unknown> {
  topic: string;
  payload: unknown;
  createdAt: Date | string;
}
interface CaseRow extends Record<string, unknown> {
  reasonCode: string;
  caseType: string;
  caseReasonCode: string;
  rating: number | null;
  contentHash: string | null;
  policyVersion: string | null;
}
interface FeedbackRow extends Record<string, unknown> {
  rating: number;
  contentHash: string;
  policyVersion: string;
  escalationStatus: string;
}
interface SafetySourceRow extends Record<string, unknown> {
  version: number;
  status: string;
}
interface CaseProjection {
  readonly reasonCode: string;
  readonly caseType: "safety" | "negative_feedback" | "delivery_failure";
  readonly caseReasonCode:
    | "safety_operator_escalation"
    | "negative_feedback_policy"
    | "negative_feedback_source_invalid";
  readonly rating: number | null;
  readonly contentHash: string | null;
  readonly policyVersion: string | null;
}

const caseProjection = sql`
  reason_code as "reasonCode",
  case_type as "caseType",
  case_reason_code as "caseReasonCode",
  rating,
  content_hash as "contentHash",
  policy_version as "policyVersion"
`;

function invalidInput(): never {
  throw new Error("local_operator_case_input_invalid");
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidInput();
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  const actualKeys = Object.keys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    return invalidInput();
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function safetyPayload(value: unknown): SafetyPayload {
  const record = exactRecord(value, ["handoffId", "version", "charge"]);
  if (
    !Number.isSafeInteger(record.version) ||
    (record.version as number) < 1 ||
    record.charge !== 0
  ) {
    return invalidInput();
  }
  return {
    handoffId: uuid(record.handoffId),
    version: record.version as number,
    charge: 0,
  };
}

function feedbackPayload(value: unknown): FeedbackPayload {
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
    return invalidInput();
  }
  return {
    feedbackId: uuid(record.feedbackId),
    contentHash: record.contentHash,
    policyVersion: record.policyVersion,
  };
}

function message(input: OperatorCaseOutboxMessage): OperatorCaseOutboxMessage {
  const outboxId = uuid(input?.outboxId);
  if (input?.topic === "safety.operator_escalation") {
    return {
      outboxId,
      topic: input.topic,
      payload: safetyPayload(input.payload),
    };
  }
  if (input?.topic === "admin.negative_feedback") {
    return {
      outboxId,
      topic: input.topic,
      payload: feedbackPayload(input.payload),
    };
  }
  return invalidInput();
}

function inspection(input: {
  readonly outboxId: string;
  readonly topic: LocalOutboxTopic;
}): { readonly outboxId: string; readonly topic: LocalOutboxTopic } {
  const outboxId = uuid(input?.outboxId);
  if (
    input?.topic !== "safety.operator_escalation" &&
    input?.topic !== "admin.negative_feedback"
  ) {
    return invalidInput();
  }
  return { outboxId, topic: input.topic };
}

function samePayload(
  left: SafetyPayload | FeedbackPayload,
  right: SafetyPayload | FeedbackPayload,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMatchingCase(row: CaseRow, topic: LocalOutboxTopic): boolean {
  if (topic === "safety.operator_escalation") {
    return (
      row.reasonCode === "safety_operator_escalation" &&
      row.caseType === "safety" &&
      row.caseReasonCode === "safety_operator_escalation" &&
      row.rating === null &&
      row.contentHash === null &&
      row.policyVersion === null
    );
  }
  return (
    (row.reasonCode === "negative_feedback_policy" &&
      row.caseType === "negative_feedback" &&
      row.caseReasonCode === "negative_feedback_policy" &&
      Number.isSafeInteger(row.rating) &&
      row.rating !== null &&
      row.rating >= 1 &&
      row.rating <= 5 &&
      typeof row.contentHash === "string" &&
      HASH_PATTERN.test(row.contentHash) &&
      typeof row.policyVersion === "string" &&
      POLICY_PATTERN.test(row.policyVersion)) ||
    (row.reasonCode === "negative_feedback_source_invalid" &&
      row.caseType === "delivery_failure" &&
      row.caseReasonCode === "negative_feedback_source_invalid" &&
      row.rating === null &&
      row.contentHash === null &&
      row.policyVersion === null)
  );
}

async function casesFor(tx: Transaction, outboxId: string): Promise<CaseRow[]> {
  return (
    await tx.execute<CaseRow>(sql`
      select ${caseProjection}
      from outbox_operator_alerts
      where outbox_id=${outboxId}::uuid
      order by id
    `)
  ).rows;
}

async function projectionFor(
  tx: Transaction,
  input: OperatorCaseOutboxMessage,
  lockSource: boolean,
): Promise<CaseProjection | undefined> {
  if (input.topic === "safety.operator_escalation") {
    const source = await tx.execute<SafetySourceRow>(sql`
      select version,status from human_escalations
      where id=${input.payload.handoffId}::uuid
      ${lockSource ? sql`for update` : sql``}
    `);
    if (
      source.rows[0]?.version !== input.payload.version ||
      source.rows[0]?.status !== "escalated"
    ) {
      return undefined;
    }
    return {
      reasonCode: "safety_operator_escalation",
      caseType: "safety",
      caseReasonCode: "safety_operator_escalation",
      rating: null,
      contentHash: null,
      policyVersion: null,
    };
  }
  const result = await tx.execute<FeedbackRow>(sql`
    select rating,content_hash as "contentHash",
      negative_policy_version as "policyVersion",
      escalation_status as "escalationStatus"
    from feedback where id=${input.payload.feedbackId}::uuid
    ${lockSource ? sql`for update` : sql``}
  `);
  const source = result.rows[0];
  if (source === undefined || source.escalationStatus !== "escalated") {
    return {
      reasonCode: "negative_feedback_source_invalid",
      caseType: "delivery_failure",
      caseReasonCode: "negative_feedback_source_invalid",
      rating: null,
      contentHash: null,
      policyVersion: null,
    };
  }
  if (
    !Number.isSafeInteger(source.rating) ||
    source.rating < 1 ||
    source.rating > 5 ||
    !HASH_PATTERN.test(source.contentHash) ||
    !POLICY_PATTERN.test(source.policyVersion)
  ) {
    return undefined;
  }
  return {
    reasonCode: "negative_feedback_policy",
    caseType: "negative_feedback",
    caseReasonCode: "negative_feedback_policy",
    rating: source.rating,
    contentHash: source.contentHash,
    policyVersion: source.policyVersion,
  };
}

async function lockedOutbox(
  tx: Transaction,
  outboxId: string,
): Promise<OutboxRow | undefined> {
  return (
    await tx.execute<OutboxRow>(sql`
      select topic,payload,created_at as "createdAt"
      from integration_outbox where id=${outboxId}::uuid
      for update
    `)
  ).rows[0];
}

export class PostgresOperatorCaseOutboxRepository {
  constructor(private readonly db: DrizzleDb) {}

  async materialize(
    rawInput: OperatorCaseOutboxMessage,
  ): Promise<"materialized" | "replayed" | "source_invalid"> {
    const input = message(rawInput);
    return this.db.transaction(async (tx) => {
      const outbox = await lockedOutbox(tx, input.outboxId);
      if (outbox === undefined || outbox.topic !== input.topic) {
        return "source_invalid";
      }
      let persistedPayload: SafetyPayload | FeedbackPayload;
      try {
        persistedPayload =
          input.topic === "safety.operator_escalation"
            ? safetyPayload(outbox.payload)
            : feedbackPayload(outbox.payload);
      } catch {
        return "source_invalid";
      }
      if (!samePayload(input.payload, persistedPayload)) {
        return "source_invalid";
      }
      const existing = await casesFor(tx, input.outboxId);
      if (existing.length > 0) {
        return existing.length === 1 &&
          isMatchingCase(existing[0]!, input.topic)
          ? "replayed"
          : "source_invalid";
      }
      const projection = await projectionFor(tx, input, true);
      if (projection === undefined) return "source_invalid";
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into outbox_operator_alerts (
          outbox_id,reason_code,case_type,case_reason_code,status,rating,
          content_hash,policy_version,created_at,updated_at
        ) values (
          ${input.outboxId}::uuid,${projection.reasonCode},${projection.caseType},
          ${projection.caseReasonCode},'open',${projection.rating},
          ${projection.contentHash},${projection.policyVersion},
          ${outbox.createdAt},${outbox.createdAt}
        )
        on conflict (outbox_id,reason_code) do nothing
        returning id::text as id
      `);
      if (inserted.rows.length === 1) return "materialized";
      const raced = await casesFor(tx, input.outboxId);
      return raced.length === 1 && isMatchingCase(raced[0]!, input.topic)
        ? "replayed"
        : "source_invalid";
    });
  }

  async inspect(rawInput: {
    readonly outboxId: string;
    readonly topic: LocalOutboxTopic;
  }): Promise<"applied" | "absent" | "source_invalid"> {
    const input = inspection(rawInput);
    return this.db.transaction(async (tx) => {
      const outbox = await lockedOutbox(tx, input.outboxId);
      if (outbox === undefined || outbox.topic !== input.topic) {
        return "source_invalid";
      }
      const existing = await casesFor(tx, input.outboxId);
      if (existing.length > 0) {
        return existing.length === 1 &&
          isMatchingCase(existing[0]!, input.topic)
          ? "applied"
          : "source_invalid";
      }
      let persisted: OperatorCaseOutboxMessage;
      try {
        persisted =
          input.topic === "safety.operator_escalation"
            ? {
                outboxId: input.outboxId,
                topic: input.topic,
                payload: safetyPayload(outbox.payload),
              }
            : {
                outboxId: input.outboxId,
                topic: input.topic,
                payload: feedbackPayload(outbox.payload),
              };
      } catch {
        return "source_invalid";
      }
      const projection = await projectionFor(tx, persisted, false);
      return projection === undefined ? "source_invalid" : "absent";
    });
  }
}
