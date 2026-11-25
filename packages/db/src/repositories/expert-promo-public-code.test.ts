import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresExpertPromoRepository } from "./expert-promo-repository.js";

const ownerId = "aaaaaaaa-bbbb-4000-8000-000000000001";
const canonical = "promo_1234567890abcdef1234567890abcdef";
const request = {
  botId: "717171",
  botKey: "promo",
  telegramUserId: "12345",
  chatId: "12345",
  requestKey: "test-update",
  requestDigest: "a".repeat(64),
  refCode: "REF_AAAAAAAABBBB",
};

function repository(active: boolean, owners = [canonical]) {
  const dialect = new PgDialect();
  const tx = {
    async execute(query: SQL) {
      const { sql, params } = dialect.sqlToQuery(query);
      if (params.includes("AAAAAAAABBBB"))
        return { rows: owners.map((refCode) => ({ refCode })) };
      if (
        sql.includes("ci.user_id") &&
        sql.includes("from channel_identities ci") &&
        sql.includes("ci.status='active'")
      )
        return { rows: active ? [{ userId: ownerId }] : [] };
      if (sql.includes('as "decisionId"'))
        return {
          rows: [{ decisionId: ownerId, revision: "1", policyVersion: "v1" }],
        };
      if (sql.includes("for share of c,u") && params.includes(canonical))
        return { rows: [{ userId: ownerId }] };
      if (sql.includes("select ci.id,ci.user_id"))
        return {
          rows: [
            {
              id: ownerId,
              userId: ownerId,
              ...request,
              active: true,
              status: "unresolved",
            },
          ],
        };
      if (
        sql.includes("from expert_promo_enrollments") &&
        sql.includes("for update")
      )
        return {
          rows: [
            {
              status: "pending",
              botId: request.botId,
              refCode: canonical,
              valid: true,
            },
          ],
        };
      return { rows: [] };
    },
  };
  const db = {
    transaction: (work: (executor: typeof tx) => unknown) => work(tx),
  };
  return new PostgresExpertPromoRepository(db as unknown as DrizzleDb, {
    messagingConsentPolicyVersion: "v1",
  });
}

describe("public waitlist referral codes", () => {
  it("resumes a pending enrollment using its public code", async () => {
    await expect(repository(false).beginEnrollment(request)).resolves.toEqual({
      kind: "waiting_content",
    });
  });

  it("recognizes the same owner for a typed public code and rejects self-referral", async () => {
    await expect(repository(true).register(request)).rejects.toThrow(
      "promo_self_referral",
    );
  });

  it("declines an ambiguous public prefix without selecting an inviter", async () => {
    await expect(
      repository(false, [canonical, "promo_" + "f".repeat(32)]).beginEnrollment(
        request,
      ),
    ).rejects.toThrow("promo_invalid_request");
  });
});
