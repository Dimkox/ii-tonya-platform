import { createHash } from "node:crypto";
import type { ExpertPrincipal } from "@ii-tonya/application";
import { parseExpertBearer } from "./expert-session-token.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ExpertSessionRecord {
  readonly userId: string;
  readonly expertId: string;
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

export interface ExpertSessionLookup {
  findByTokenHash(tokenHash: string): Promise<ExpertSessionRecord | null>;
}

export interface ExpertPrincipalResolver {
  resolve(authorization: string | undefined): Promise<ExpertPrincipal | null>;
}

const tokenHash = (token: string): string =>
  `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

export function createExpertBearerPrincipalResolver(deps: {
  readonly sessions: ExpertSessionLookup;
  readonly now?: () => Date;
}): ExpertPrincipalResolver {
  return {
    async resolve(authorization) {
      const token = parseExpertBearer(authorization);
      if (token === null) return null;

      let session: ExpertSessionRecord | null;
      try {
        session = await deps.sessions.findByTokenHash(tokenHash(token));
      } catch {
        throw new Error("expert_session_lookup_failed");
      }

      if (session === null) return null;
      const now = deps.now?.() ?? new Date();
      if (
        !validDate(now) ||
        !validDate(session.expiresAt) ||
        session.expiresAt.getTime() <= now.getTime() ||
        session.revokedAt !== undefined ||
        !uuidPattern.test(session.userId) ||
        !uuidPattern.test(session.expertId)
      ) {
        return null;
      }

      return {
        authenticated: true,
        userId: session.userId.toLowerCase(),
        expertId: session.expertId.toLowerCase(),
      };
    },
  };
}
