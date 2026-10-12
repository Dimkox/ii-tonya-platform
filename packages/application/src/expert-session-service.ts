export interface VerifiedExpertIdentityProof {
  readonly userId: string;
  readonly expertId: string;
  readonly channelIdentityId: string;
  readonly externalId: string;
  readonly botKey: string | null;
  readonly externalChatId: string | null;
  readonly audience: "ii-tonya-expert";
  readonly scope: "expert_session:create";
  readonly expiresAt: Date;
  readonly replayDigest: string;
}
export interface ExpertIdentityProofVerifier {
  verify(input: {
    identityProof: string;
    expectedAudience: "ii-tonya-expert";
    expectedScope: "expert_session:create";
    signal: AbortSignal;
  }): Promise<VerifiedExpertIdentityProof | null>;
}
export interface ExpertSessionRepository {
  issue(input: {
    userId: string;
    expertId: string;
    channelIdentityId: string;
    externalId: string;
    botKey: string | null;
    externalChatId: string | null;
    replayDigest: string;
    proofExpiresAt: Date;
    tokenDigest: string;
  }): Promise<{ kind: "issued"; expiresAt: Date } | { kind: "denied" }>;
}
export type ExpertSessionIssueResult =
  | {
      kind: "issued";
      accessToken: `es1.${string}`;
      expiresAt: string;
      tokenType: "Bearer";
    }
  | { kind: "unauthorized" | "unavailable" };
export interface ExpertSessionService {
  issue(proof: string, signal?: AbortSignal): Promise<ExpertSessionIssueResult>;
}
export function createExpertSessionService(deps: {
  verifier: ExpertIdentityProofVerifier;
  sessions: ExpertSessionRepository;
  generateToken: () => `es1.${string}`;
  digestToken: (token: `es1.${string}`) => string;
}): ExpertSessionService {
  return {
    async issue(identityProof, signal = new AbortController().signal) {
      if (signal.aborted) return { kind: "unavailable" };
      try {
        const proof = await deps.verifier.verify({
          identityProof,
          signal,
          expectedAudience: "ii-tonya-expert",
          expectedScope: "expert_session:create",
        });
        if (signal.aborted) return { kind: "unavailable" };
        if (
          !proof ||
          proof.audience !== "ii-tonya-expert" ||
          proof.scope !== "expert_session:create" ||
          ![proof.userId, proof.expertId, proof.channelIdentityId].every(
            (x) => typeof x === "string" && /^[0-9a-f-]{36}$/u.test(x),
          ) ||
          !(proof.expiresAt instanceof Date) ||
          !Number.isFinite(proof.expiresAt.getTime()) ||
          !/^expert-login:v1:[a-f0-9]{64}$/u.test(proof.replayDigest)
        )
          return { kind: "unauthorized" };
        const accessToken = deps.generateToken();
        const result = await deps.sessions.issue({
          userId: proof.userId,
          expertId: proof.expertId,
          channelIdentityId: proof.channelIdentityId,
          externalId: proof.externalId,
          botKey: proof.botKey,
          externalChatId: proof.externalChatId,
          replayDigest: proof.replayDigest,
          proofExpiresAt: proof.expiresAt,
          tokenDigest: deps.digestToken(accessToken),
        });
        if (signal.aborted) return { kind: "unavailable" };
        return result.kind === "issued"
          ? {
              kind: "issued",
              accessToken,
              tokenType: "Bearer",
              expiresAt: result.expiresAt.toISOString(),
            }
          : { kind: "unauthorized" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
