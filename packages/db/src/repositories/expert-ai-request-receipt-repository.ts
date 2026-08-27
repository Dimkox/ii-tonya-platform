import { createHash, randomUUID } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";
import type { DrizzleDb } from "../client.js";

export type ExpertAiStoredOutcome = {
  readonly status: 200 | 403 | 422 | 503;
  readonly body: Readonly<Record<string, string>>;
};
export type ExpertAiReceiptClaim =
  | { readonly kind: "claimed"; readonly claimId: string }
  | { readonly kind: "replay"; readonly outcome: ExpertAiStoredOutcome }
  | { readonly kind: "conflict" | "busy" };

interface ReceiptRow extends QueryResultRow {
  status: "processing" | "complete" | "failed";
  requestDigest: string;
  version: number;
  outcomeStatus: number | null;
  outcomeCode: string | null;
  outcomeDetail: string | null;
}
const HASH = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROPOSAL_KINDS = new Set([
  "redeem_expert_referral",
  "view_referral_summary",
  "quote_residency",
  "start_residency_checkout",
]);
const REJECTION_REASONS = new Set([
  "invalid_shape",
  "unsupported_intent",
  "unauthorized_scope",
]);
const keyHash = (expertId: string, key: string) =>
  createHash("sha256").update(`${expertId}:${key}`, "utf8").digest("hex");
const fence = (value: string) => {
  const [claimId, versionText] = value.split(":");
  const version = Number(versionText);
  if (
    !UUID.test(claimId ?? "") ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Error("expert_ai_receipt_fence_invalid");
  return { claimId: claimId!, version };
};
const encode = (outcome: ExpertAiStoredOutcome) => {
  const code = outcome.body.status ?? outcome.body.error;
  const detail = outcome.body.proposalKind ?? outcome.body.reasonCode ?? null;
  if (
    (outcome.status === 200 &&
      code === "completed" &&
      detail !== null &&
      PROPOSAL_KINDS.has(detail)) ||
    (outcome.status === 422 &&
      code === "proposal_rejected" &&
      detail !== null &&
      REJECTION_REASONS.has(detail)) ||
    (outcome.status === 403 && code === "forbidden" && detail === null) ||
    (outcome.status === 503 && code === "feature_disabled" && detail === null)
  )
    return { code, detail };
  throw new Error("expert_ai_receipt_outcome_invalid");
};
const decode = (row: ReceiptRow): ExpertAiStoredOutcome => {
  const status = row.outcomeStatus as 200 | 403 | 422 | 503;
  if (
    status === 200 &&
    row.outcomeCode === "completed" &&
    row.outcomeDetail !== null &&
    PROPOSAL_KINDS.has(row.outcomeDetail)
  )
    return {
      status,
      body: { status: "completed", proposalKind: row.outcomeDetail },
    };
  if (
    status === 422 &&
    row.outcomeCode === "proposal_rejected" &&
    row.outcomeDetail !== null &&
    REJECTION_REASONS.has(row.outcomeDetail)
  )
    return {
      status,
      body: { error: row.outcomeCode, reasonCode: row.outcomeDetail },
    };
  if (
    (status === 403 && row.outcomeCode === "forbidden") ||
    (status === 503 && row.outcomeCode === "feature_disabled")
  )
    return { status, body: { error: row.outcomeCode } };
  throw new Error("expert_ai_receipt_corrupt");
};

export class PostgresExpertAiRequestReceiptStore {
  constructor(
    private readonly db: DrizzleDb,
    private readonly leaseMs = 30_000,
  ) {}
  async claim(input: {
    expertId: string;
    idempotencyKey: string;
    requestDigest: string;
  }): Promise<ExpertAiReceiptClaim> {
    if (
      !UUID.test(input.expertId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey) ||
      !HASH.test(input.requestDigest)
    )
      throw new Error("expert_ai_receipt_claim_invalid");
    const requestKeyHash = keyHash(input.expertId, input.idempotencyKey);
    const claimId = randomUUID();
    const acquired: QueryResult<{ version: number }> =
      await this.db.$client.query(
        `insert into expert_ai_request_receipts as r (request_key_hash,request_digest,status,claim_id,lease_until,expires_at)
       values ($1,$2,'processing',$3::uuid,now()+($4*interval '1 millisecond'),now()+interval '7 days')
       on conflict (request_key_hash) do update set status='processing',claim_id=excluded.claim_id,lease_until=excluded.lease_until,version=r.version+1,updated_at=now()
       where r.request_digest=excluded.request_digest and (r.status='failed' or (r.status='processing' and r.lease_until<now()))
       returning version`,
        [requestKeyHash, input.requestDigest, claimId, this.leaseMs],
      );
    const version = acquired.rows[0]?.version;
    if (version !== undefined)
      return { kind: "claimed", claimId: `${claimId}:${version}` };
    const stored: QueryResult<ReceiptRow> = await this.db.$client.query(
      `select status,request_digest as "requestDigest",version,outcome_status as "outcomeStatus",outcome_code as "outcomeCode",outcome_detail as "outcomeDetail" from expert_ai_request_receipts where request_key_hash=$1`,
      [requestKeyHash],
    );
    const row = stored.rows[0];
    if (row === undefined || row.requestDigest !== input.requestDigest)
      return { kind: "conflict" };
    return row.status === "complete"
      ? { kind: "replay", outcome: decode(row) }
      : { kind: "busy" };
  }
  async complete(claim: string, outcome: ExpertAiStoredOutcome): Promise<void> {
    const { claimId, version } = fence(claim);
    const encoded = encode(outcome);
    const result = await this.db.$client.query(
      `update expert_ai_request_receipts set status='complete',lease_until=null,outcome_status=$3,outcome_code=$4,outcome_detail=$5,updated_at=now() where claim_id=$1::uuid and version=$2 and status='processing' and lease_until>=now() returning request_key_hash`,
      [claimId, version, outcome.status, encoded.code, encoded.detail],
    );
    if (result.rowCount !== 1) throw new Error("expert_ai_receipt_claim_lost");
  }
  async fail(claim: string): Promise<void> {
    const { claimId, version } = fence(claim);
    const result = await this.db.$client.query(
      `update expert_ai_request_receipts set status='failed',lease_until=null,updated_at=now() where claim_id=$1::uuid and version=$2 and status='processing' and lease_until>=now() returning request_key_hash`,
      [claimId, version],
    );
    if (result.rowCount !== 1) throw new Error("expert_ai_receipt_claim_lost");
  }
  async cleanup(limit = 500): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("expert_ai_receipt_cleanup_invalid");
    const result = await this.db.$client.query(
      `delete from expert_ai_request_receipts where request_key_hash in (select request_key_hash from expert_ai_request_receipts where status in ('complete','failed') and expires_at<now() order by expires_at limit $1 for update skip locked)`,
      [limit],
    );
    return result.rowCount ?? 0;
  }
}
