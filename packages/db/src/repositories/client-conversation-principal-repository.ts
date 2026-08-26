import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";

export interface ClientConversationIdentityFact {
  readonly [key: string]: unknown;
  readonly bindingId: string;
  readonly userId: string;
}

export interface ClientConversationIdentityLookup {
  readonly provider: "selarti.client-thread.v1";
  readonly tenantToken: string;
  readonly subjectToken: string;
  readonly tokenVersion: 1;
}

const tokenPattern = /^hmac-sha256:v1:[0-9a-f]{64}$/u;

const validLookup = (
  input: unknown,
): input is ClientConversationIdentityLookup => {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(input);
    if (
      keys.length !== 4 ||
      !keys.every((key) =>
        ["provider", "tenantToken", "subjectToken", "tokenVersion"].includes(
          key,
        ),
      )
    ) {
      return false;
    }
    const value = input as Record<string, unknown>;
    return (
      value.provider === "selarti.client-thread.v1" &&
      value.tokenVersion === 1 &&
      typeof value.tenantToken === "string" &&
      tokenPattern.test(value.tenantToken) &&
      typeof value.subjectToken === "string" &&
      tokenPattern.test(value.subjectToken)
    );
  } catch {
    return false;
  }
};

export class PostgresClientConversationPrincipalRepository {
  constructor(private readonly db: DrizzleDb) {}

  async findActive(
    input: ClientConversationIdentityLookup,
  ): Promise<readonly ClientConversationIdentityFact[]> {
    if (!validLookup(input)) return [];
    try {
      const result = await this.db.execute<ClientConversationIdentityFact>(sql`
        select m.id as "bindingId",m.user_id as "userId"
        from provider_subject_mappings m
        join users u on u.id=m.user_id and u.active=true
        where m.provider='selarti.client-thread.v1'
          and m.tenant_token=${input.tenantToken}
          and m.subject_token=${input.subjectToken}
          and m.token_version=1
        limit 2
      `);
      return result.rows.map((row) => ({
        bindingId: row.bindingId,
        userId: row.userId,
      }));
    } catch {
      throw new Error("client_conversation_identity_unavailable");
    }
  }
}
