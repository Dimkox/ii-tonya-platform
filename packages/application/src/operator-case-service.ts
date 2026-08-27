import type { AdminPrincipal } from "./admin-service.js";

export type OperatorCaseType =
  "safety" | "negative_feedback" | "delivery_failure";
export type OperatorCaseStatus = "open" | "acknowledged" | "resolved";
export interface OperatorCase {
  readonly id: string;
  readonly type: OperatorCaseType;
  readonly status: OperatorCaseStatus;
  readonly rating: 1 | 2 | 3 | 4 | 5 | null;
  readonly reasonCode: string;
  readonly contentHash: string | null;
  readonly policyVersion: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
}
export interface OperatorCaseCursor {
  readonly createdAt: Date;
  readonly id: string;
}
export interface OperatorCaseRepository {
  listUnresolved(input: {
    readonly allowedTypes: readonly OperatorCaseType[];
    readonly limit: number;
    readonly cursor?: OperatorCaseCursor;
  }): Promise<{
    readonly items: readonly OperatorCase[];
    readonly hasMore: boolean;
  }>;
  transition(input: {
    readonly caseId: string;
    readonly action: "acknowledge" | "resolve";
    readonly allowedTypes: readonly OperatorCaseType[];
    readonly actorId: string;
    readonly sessionIdHash: string;
  }): Promise<
    | { readonly kind: "updated" | "replayed"; readonly item: OperatorCase }
    | { readonly kind: "not_found" | "conflict" }
  >;
}
export type OperatorCaseListResult =
  | {
      readonly kind: "ok";
      readonly items: readonly OperatorCase[];
      readonly nextCursor?: string;
    }
  | { readonly kind: "forbidden" | "invalid" };
export type OperatorCaseTransitionResult =
  | { readonly kind: "updated" | "replayed"; readonly item: OperatorCase }
  | { readonly kind: "forbidden" | "invalid" | "not_found" | "conflict" };
export interface OperatorCaseService {
  listOpen(
    principal: AdminPrincipal,
    input: { readonly limit: number; readonly cursor?: string },
  ): Promise<OperatorCaseListResult>;
  transition(
    principal: AdminPrincipal,
    input: {
      readonly caseId: string;
      readonly action: "acknowledge" | "resolve";
    },
  ): Promise<OperatorCaseTransitionResult>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURSOR = /^[A-Za-z0-9_-]{16,256}$/u;

const allowedTypes = (principal: AdminPrincipal): OperatorCaseType[] => {
  const allowed: OperatorCaseType[] = [];
  if (principal.roles.includes("security_admin")) allowed.push("safety");
  if (principal.roles.includes("support"))
    allowed.push("negative_feedback", "delivery_failure");
  return allowed;
};
const encodeCursor = (value: OperatorCaseCursor): string =>
  Buffer.from(
    JSON.stringify([value.createdAt.toISOString(), value.id]),
    "utf8",
  ).toString("base64url");
const decodeCursor = (value: string): OperatorCaseCursor | null => {
  if (!CURSOR.test(value)) return null;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(raw, "utf8").toString("base64url") !== value) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !UUID.test(parsed[1])
    )
      return null;
    const createdAt = new Date(parsed[0]);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== parsed[0]
    )
      return null;
    return { createdAt, id: parsed[1] };
  } catch {
    return null;
  }
};

export const createOperatorCaseService = (deps: {
  readonly cases: OperatorCaseRepository;
}): OperatorCaseService => ({
  async listOpen(principal, input) {
    const types = allowedTypes(principal);
    if (types.length === 0) return { kind: "forbidden" };
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      return { kind: "invalid" };
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    if (cursor === null) return { kind: "invalid" };
    const page = await deps.cases.listUnresolved({
      allowedTypes: types,
      limit: input.limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const last = page.items.at(-1);
    return {
      kind: "ok",
      items: page.items,
      ...(page.hasMore && last !== undefined
        ? {
            nextCursor: encodeCursor({
              createdAt: last.createdAt,
              id: last.id,
            }),
          }
        : {}),
    };
  },
  async transition(principal, input) {
    const types = allowedTypes(principal);
    if (types.length === 0) return { kind: "forbidden" };
    if (!UUID.test(input.caseId)) return { kind: "invalid" };
    return deps.cases.transition({
      caseId: input.caseId,
      action: input.action,
      allowedTypes: types,
      actorId: principal.id,
      sessionIdHash: principal.sessionIdHash,
    });
  },
});
