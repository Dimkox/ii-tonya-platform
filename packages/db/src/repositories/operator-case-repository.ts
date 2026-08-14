import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

type OperatorCaseType = "safety" | "negative_feedback" | "delivery_failure";
interface OperatorCase {
  readonly id: string;
  readonly type: OperatorCaseType;
  readonly status: "open" | "acknowledged" | "resolved";
  readonly rating: 1 | 2 | 3 | 4 | 5 | null;
  readonly reasonCode: string;
  readonly contentHash: string | null;
  readonly policyVersion: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
}
interface OperatorCaseRow extends Record<string, unknown> {
  id: string;
  type: OperatorCaseType;
  status: "open" | "acknowledged" | "resolved";
  rating: number | null;
  reasonCode: string;
  contentHash: string | null;
  policyVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}
const CASE_TYPES = new Set<OperatorCaseType>([
  "safety",
  "negative_feedback",
  "delivery_failure",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const projection = sql`
  id::text as id,
  case_type as type,
  status,
  rating,
  case_reason_code as "reasonCode",
  content_hash as "contentHash",
  policy_version as "policyVersion",
  created_at as "createdAt",
  updated_at as "updatedAt",
  acknowledged_at as "acknowledgedAt",
  resolved_at as "resolvedAt"
`;
const asCase = (row: OperatorCaseRow): OperatorCase => ({
  ...row,
  rating: row.rating as 1 | 2 | 3 | 4 | 5 | null,
});
const validateTypes = (values: readonly OperatorCaseType[]): void => {
  if (
    values.length < 1 ||
    values.length > CASE_TYPES.size ||
    new Set(values).size !== values.length ||
    values.some((value) => !CASE_TYPES.has(value))
  )
    throw new Error("operator_case_types_invalid");
};

export class PostgresOperatorCaseRepository {
  constructor(private readonly db: DrizzleDb) {}

  async listUnresolved(input: {
    readonly allowedTypes: readonly OperatorCaseType[];
    readonly limit: number;
    readonly cursor?: { readonly createdAt: Date; readonly id: string };
  }): Promise<{
    readonly items: readonly OperatorCase[];
    readonly hasMore: boolean;
  }> {
    validateTypes(input.allowedTypes);
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new Error("operator_case_limit_invalid");
    if (
      input.cursor !== undefined &&
      (!UUID.test(input.cursor.id) ||
        !Number.isFinite(input.cursor.createdAt.getTime()))
    )
      throw new Error("operator_case_cursor_invalid");
    const result = await this.db.execute<OperatorCaseRow>(sql`
      select ${projection}
      from outbox_operator_alerts
      where status in ('open','acknowledged')
        and case_type = any(${input.allowedTypes}::text[])
        ${
          input.cursor === undefined
            ? sql``
            : sql`and (created_at,id) < (${input.cursor.createdAt},${input.cursor.id}::uuid)`
        }
      order by created_at desc,id desc
      limit ${input.limit + 1}
    `);
    const hasMore = result.rows.length > input.limit;
    return {
      items: result.rows.slice(0, input.limit).map(asCase),
      hasMore,
    };
  }

  async transition(input: {
    readonly caseId: string;
    readonly action: "acknowledge" | "resolve";
    readonly allowedTypes: readonly OperatorCaseType[];
    readonly actorId: string;
    readonly sessionIdHash: string;
  }) {
    validateTypes(input.allowedTypes);
    if (
      !UUID.test(input.caseId) ||
      !UUID.test(input.actorId) ||
      input.sessionIdHash.length < 8 ||
      input.sessionIdHash.length > 128
    )
      throw new Error("operator_case_transition_invalid");
    return this.db.transaction(async (tx) => {
      const target = await tx.execute<OperatorCaseRow>(sql`
        select ${projection}
        from outbox_operator_alerts
        where id=${input.caseId}::uuid
          and case_type=any(${input.allowedTypes}::text[])
        for update
      `);
      const current = target.rows[0];
      if (current === undefined) return { kind: "not_found" as const };
      const desired =
        input.action === "acknowledge" ? "acknowledged" : "resolved";
      if (current.status === desired)
        return { kind: "replayed" as const, item: asCase(current) };
      if (current.status === "resolved") return { kind: "conflict" as const };
      const changed = await tx.execute<OperatorCaseRow>(sql`
        update outbox_operator_alerts
        set status=${desired},
          acknowledged_at=case when ${desired}='acknowledged'
            then clock_timestamp() else acknowledged_at end,
          resolved_at=case when ${desired}='resolved'
            then clock_timestamp() else resolved_at end,
          updated_at=clock_timestamp()
        where id=${input.caseId}::uuid
        returning ${projection}
      `);
      const item = changed.rows[0];
      if (item === undefined) throw new Error("operator_case_transition_lost");
      const metadataHash = createHash("sha256")
        .update(`${input.caseId}:${input.action}:${desired}`, "utf8")
        .digest("hex");
      await tx.execute(sql`
        insert into audit_events (
          actor_type,actor_id,authenticated_session_id_hash,action,
          object_type,object_id,decision,reason_code,correlation_id,
          occurred_at,metadata_hash
        ) values (
          'admin',${input.actorId}::uuid,${input.sessionIdHash},
          'operator_case.transitioned','operator_case',${input.caseId}::uuid,
          'allowed',${input.action},
          ${`operator-case:${input.caseId}:${desired}`},
          ${item.updatedAt},${metadataHash}
        )
      `);
      return { kind: "updated" as const, item: asCase(item) };
    });
  }
}
