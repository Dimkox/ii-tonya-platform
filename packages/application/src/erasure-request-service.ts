import { createHash } from "node:crypto";

export interface StoredErasureRequest {
  id: string;
  createdAt: string;
  jobId: string | null;
}
export interface RetainedErasureFacts {
  ledgerFactsPreserved: number;
  auditFactsPreserved: number;
}
export interface VerifiedErasureJob {
  status: "pending" | "processor_complete" | "dead_letter" | "backup_verified";
  retainedFacts: RetainedErasureFacts | null;
}
export interface ErasureRequestRepository {
  accept(input: {
    userId: string;
    receiptDigest: string;
  }): Promise<
    | { kind: "accepted"; request: StoredErasureRequest }
    | { kind: "denied" | "conflict" }
  >;
  findOwned(userId: string): Promise<StoredErasureRequest | null>;
  findByReceiptDigest(digest: string): Promise<StoredErasureRequest | null>;
  /** Must validate job ownership and completion proof, not just read its status. */
  getVerifiedJob(jobId: string): Promise<VerifiedErasureJob>;
}
export interface ErasureRequestView {
  requestId: string;
  requestedAt: string;
  stage:
    | "awaiting_execution"
    | "deleting"
    | "awaiting_backup"
    | "needs_attention"
    | "completed";
  retainedFacts: RetainedErasureFacts | null;
}
type Result =
  | { kind: "accepted" | "found"; request: ErasureRequestView }
  | { kind: "denied" | "conflict" | "unavailable" };
type Owner = { principalUserId: string; targetUserId: string };
export function erasureReceiptDigest(token: unknown): string | null {
  if (typeof token !== "string" || !/^er1\.[A-Za-z0-9_-]{43}$/u.test(token))
    return null;
  const bytes = Buffer.from(token.slice(4), "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== token.slice(4))
    return null;
  return createHash("sha256")
    .update("ii-tonya:erasure-receipt:v1\0")
    .update(token)
    .digest("hex");
}
const owns = (input: Owner) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    input.principalUserId,
  ) && input.principalUserId === input.targetUserId;
export function createErasureRequestService(deps: {
  repository: ErasureRequestRepository;
  requestEnabled?: boolean;
}) {
  async function project(
    row: StoredErasureRequest,
  ): Promise<ErasureRequestView> {
    const timestamp = Date.parse(row.createdAt);
    if (!Number.isFinite(timestamp)) throw new Error("invalid_request_state");
    const job = row.jobId
      ? await deps.repository.getVerifiedJob(row.jobId)
      : null;
    const stages = {
      pending: "deleting",
      processor_complete: "awaiting_backup",
      dead_letter: "needs_attention",
      backup_verified: "completed",
    } as const;
    const stage = job ? stages[job.status] : "awaiting_execution";
    if (!stage) throw new Error("invalid_job_state");
    return {
      requestId: row.id,
      requestedAt: new Date(timestamp).toISOString(),
      stage,
      retainedFacts: job?.retainedFacts ?? null,
    };
  }
  return {
    async request(input: Owner & { receiptToken: string }): Promise<Result> {
      if (!owns(input)) return { kind: "denied" };
      const receiptDigest = erasureReceiptDigest(input.receiptToken);
      if (!receiptDigest) return { kind: "denied" };
      if (!deps.requestEnabled) return { kind: "unavailable" };
      try {
        const result = await deps.repository.accept({
          userId: input.targetUserId,
          receiptDigest,
        });
        return result.kind === "accepted"
          ? { kind: "accepted", request: await project(result.request) }
          : result;
      } catch {
        return { kind: "unavailable" };
      }
    },
    async readOwned(input: Owner): Promise<Result> {
      if (!owns(input)) return { kind: "denied" };
      try {
        const row = await deps.repository.findOwned(input.targetUserId);
        return row
          ? { kind: "found", request: await project(row) }
          : { kind: "denied" };
      } catch {
        return { kind: "unavailable" };
      }
    },
    async readReceipt(token: string): Promise<Result> {
      const digest = erasureReceiptDigest(token);
      if (!digest) return { kind: "denied" };
      try {
        const row = await deps.repository.findByReceiptDigest(digest);
        return row
          ? { kind: "found", request: await project(row) }
          : { kind: "denied" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
export type ErasureRequestService = ReturnType<
  typeof createErasureRequestService
>;
