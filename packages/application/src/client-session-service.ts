export interface VerifiedClientIdentityProof {
  readonly userId: string;
  readonly audience: "ii-tonya-client";
  readonly scope: "client_session:create";
  readonly expiresAt: Date;
  readonly replayDigest: `hmac-sha256:v${number}:${string}`;
}

export interface IdentityProofVerifier {
  verify(input: {
    readonly identityProof: string;
    readonly expectedAudience: "ii-tonya-client";
    readonly expectedScope: "client_session:create";
    readonly signal: AbortSignal;
  }): Promise<VerifiedClientIdentityProof | null>;
}

export interface ClientSessionRepository {
  issue(input: {
    readonly userId: string;
    readonly replayDigest: `hmac-sha256:v${number}:${string}`;
    readonly proofExpiresAt: Date;
    readonly tokenDigest: `sha256:${string}`;
    readonly scope: "client_catalog:read";
    readonly maximumTtlMs: 3_600_000;
  }): Promise<
    | { readonly kind: "issued"; readonly expiresAt: Date }
    | { readonly kind: "denied" }
  >;
}

export type ClientSessionIssueResult =
  | {
      readonly kind: "issued";
      readonly accessToken: `cs1.${string}`;
      readonly tokenType: "Bearer";
      readonly scope: "client_catalog:read";
      readonly expiresAt: string;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

export interface ClientSessionService {
  issue(
    identityProof: string,
    signal?: AbortSignal,
  ): Promise<ClientSessionIssueResult>;
}

interface ClientSessionServiceDependencies {
  readonly verifier: IdentityProofVerifier;
  readonly sessions: ClientSessionRepository;
  readonly generateToken: () => `cs1.${string}`;
  readonly digestToken: (token: `cs1.${string}`) => `sha256:${string}`;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const replayDigestPattern = /^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$/u;
const verifiedKeys = new Set([
  "userId",
  "audience",
  "scope",
  "expiresAt",
  "replayDigest",
]);

const validVerifiedProof = (
  value: unknown,
): value is VerifiedClientIdentityProof => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== verifiedKeys.size || keys.some((key) => !verifiedKeys.has(key))) {
    return false;
  }
  const proof = value as Partial<VerifiedClientIdentityProof>;
  if (
    typeof proof.userId !== "string" ||
    !uuidPattern.test(proof.userId) ||
    proof.audience !== "ii-tonya-client" ||
    proof.scope !== "client_session:create" ||
    !(proof.expiresAt instanceof Date) ||
    !Number.isFinite(proof.expiresAt.getTime()) ||
    proof.expiresAt.getUTCFullYear() < 1 ||
    proof.expiresAt.getUTCFullYear() > 9_999 ||
    typeof proof.replayDigest !== "string" ||
    !replayDigestPattern.test(proof.replayDigest)
  ) {
    return false;
  }
  return true;
};

export const createClientSessionService = (
  dependencies: ClientSessionServiceDependencies,
): ClientSessionService => {
  const service: ClientSessionService = {
    async issue(
      identityProof: string,
      signal = new AbortController().signal,
    ): Promise<ClientSessionIssueResult> {
      let verified: VerifiedClientIdentityProof | null;
      try {
        verified = await dependencies.verifier.verify({
          identityProof,
          expectedAudience: "ii-tonya-client",
          expectedScope: "client_session:create",
          signal,
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (!validVerifiedProof(verified)) return { kind: "unauthorized" };

      try {
        const accessToken = dependencies.generateToken();
        const tokenDigest = dependencies.digestToken(accessToken);
        const result = await dependencies.sessions.issue({
          userId: verified.userId,
          replayDigest: verified.replayDigest,
          proofExpiresAt: verified.expiresAt,
          tokenDigest,
          scope: "client_catalog:read",
          maximumTtlMs: 3_600_000,
        });
        if (result.kind !== "issued") return { kind: "unauthorized" };
        return {
          kind: "issued",
          accessToken,
          tokenType: "Bearer",
          scope: "client_catalog:read",
          expiresAt: result.expiresAt.toISOString(),
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
  return Object.freeze(service);
};
