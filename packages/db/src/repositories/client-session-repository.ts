import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";

interface ClientSessionIssueInput {
  readonly userId: string;
  readonly replayDigest: `hmac-sha256:v${number}:${string}`;
  readonly proofExpiresAt: Date;
  readonly tokenDigest: `sha256:${string}`;
  readonly scope: "client_catalog:read";
  readonly maximumTtlMs: 3_600_000;
}

type ClientSessionIssueOutcome =
  | { readonly kind: "issued"; readonly expiresAt: Date }
  | { readonly kind: "denied" };

interface ClientPrincipal {
  readonly authenticated: true;
  readonly active: true;
  readonly userId: string;
}

export type ClientSessionResolution =
  | { readonly kind: "resolved"; readonly principal: ClientPrincipal }
  | { readonly kind: "denied" };
export type ClientSessionRevocation =
  | { readonly kind: "revoked" }
  | { readonly kind: "denied" };

type Transaction = Parameters<DrizzleDb["transaction"]>[0] extends (
  transaction: infer T,
) => unknown
  ? T
  : never;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenDigestPattern = /^sha256:[0-9a-f]{64}$/u;
const replayDigestPattern = /^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$/u;

const hasSqlState = (error: unknown, state: string): boolean => {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === state) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

const validInstant = (value: Date): boolean =>
  value instanceof Date &&
  Number.isFinite(value.getTime()) &&
  value.getUTCFullYear() >= 1 &&
  value.getUTCFullYear() <= 9_999;

export class PostgresClientSessionRepository {
  constructor(private readonly db: DrizzleDb) {}

  async issue(input: ClientSessionIssueInput): Promise<ClientSessionIssueOutcome> {
    if (
      !uuidPattern.test(input.userId) ||
      !tokenDigestPattern.test(input.tokenDigest) ||
      !replayDigestPattern.test(input.replayDigest) ||
      !validInstant(input.proofExpiresAt) ||
      input.scope !== "client_catalog:read" ||
      input.maximumTtlMs !== 3_600_000
    ) {
      return { kind: "denied" };
    }
    try {
      return await this.db.transaction(async (tx: Transaction) => {
        const authority = (
          await tx.execute<{ databaseNow: Date | string }>(sql`
            select clock_timestamp() as "databaseNow"
            from users
            where id=${input.userId}::uuid and active=true
            for update
          `)
        ).rows[0];
        if (authority === undefined) return { kind: "denied" } as const;
        const databaseNow =
          authority.databaseNow instanceof Date
            ? authority.databaseNow
            : new Date(authority.databaseNow);
        const remaining = input.proofExpiresAt.getTime() - databaseNow.getTime();
        if (remaining <= 0 || remaining > input.maximumTtlMs) {
          return { kind: "denied" } as const;
        }
        const session = (
          await tx.execute<{ expiresAt: Date | string }>(sql`
            insert into client_sessions (
              token_digest,user_id,scope,expires_at,created_at
            ) values (
              ${input.tokenDigest},${input.userId}::uuid,
              'client_catalog:read',${input.proofExpiresAt},clock_timestamp()
            )
            returning expires_at as "expiresAt"
          `)
        ).rows[0];
        if (session === undefined) throw new Error("client_session_issue_unavailable");
        await tx.execute(sql`
          insert into client_identity_proof_receipts (
            replay_digest,session_token_digest,expires_at,created_at
          ) values (
            ${input.replayDigest},${input.tokenDigest},
            ${input.proofExpiresAt},clock_timestamp()
          )
        `);
        const expiresAt =
          session.expiresAt instanceof Date
            ? session.expiresAt
            : new Date(session.expiresAt);
        if (!validInstant(expiresAt)) {
          throw new Error("client_session_issue_unavailable");
        }
        return { kind: "issued", expiresAt } as const;
      });
    } catch (error) {
      if (hasSqlState(error, "23505")) return { kind: "denied" };
      throw new Error("client_session_repository_unavailable");
    }
  }

  async resolve(tokenDigest: `sha256:${string}`): Promise<ClientSessionResolution> {
    if (!tokenDigestPattern.test(tokenDigest)) return { kind: "denied" };
    const row = (
      await this.db.execute<{ userId: string }>(sql`
        select s.user_id as "userId"
        from client_sessions s
        join users u on u.id=s.user_id
        where s.token_digest=${tokenDigest}
          and s.scope='client_catalog:read'
          and s.revoked_at is null
          and s.expires_at > clock_timestamp()
          and u.active=true
      `)
    ).rows[0];
    return row === undefined
      ? { kind: "denied" }
      : {
          kind: "resolved",
          principal: {
            authenticated: true,
            active: true,
            userId: row.userId,
          },
        };
  }

  async revoke(tokenDigest: `sha256:${string}`): Promise<ClientSessionRevocation> {
    if (!tokenDigestPattern.test(tokenDigest)) return { kind: "denied" };
    const row = (
      await this.db.execute<{ tokenDigest: string }>(sql`
        update client_sessions s
        set revoked_at=clock_timestamp()
        from users u
        where s.token_digest=${tokenDigest}
          and u.id=s.user_id and u.active=true
          and s.scope='client_catalog:read'
          and s.revoked_at is null
          and s.expires_at > clock_timestamp()
        returning s.token_digest as "tokenDigest"
      `)
    ).rows[0];
    return row === undefined ? { kind: "denied" } : { kind: "revoked" };
  }

  async cleanupExpired(limit: number): Promise<{
    receiptsRemoved: number;
    sessionsRemoved: number;
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("client_session_cleanup_invalid");
    }
    return this.db.transaction(async (tx: Transaction) => {
      const receipts = await tx.execute(sql`
        delete from client_identity_proof_receipts
        where replay_digest in (
          select replay_digest from client_identity_proof_receipts
          where expires_at <= clock_timestamp()
          order by expires_at,replay_digest
          for update skip locked
          limit ${limit}
        )
        returning 1
      `);
      const sessions = await tx.execute(sql`
        delete from client_sessions
        where token_digest in (
          select token_digest from client_sessions
          where expires_at <= clock_timestamp()
          order by expires_at,token_digest
          for update skip locked
          limit ${limit}
        )
        returning 1
      `);
      return {
        receiptsRemoved: receipts.rows.length,
        sessionsRemoved: sessions.rows.length,
      };
    });
  }
}
