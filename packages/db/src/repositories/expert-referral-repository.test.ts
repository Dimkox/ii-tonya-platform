import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import {
  calculateIssuanceOverrideUsage,
  deriveExpertReferralBatchStatus,
  toPublicIssuedExpertReferralCode,
  parseExpertCodeKeyVersion,
  PostgresExpertReferralRepository,
} from "./expert-referral-repository.js";

describe("expert referral issuance policy", () => {
  it("requires override capacity equal to the largest exceeded quota", () => {
    expect(
      calculateIssuanceOverrideUsage({
        count: 2,
        outstandingOrUnsettled: 999,
        issuedInRollingWindow: 900,
      }),
    ).toBe(1);
    expect(
      calculateIssuanceOverrideUsage({
        count: 10,
        outstandingOrUnsettled: 995,
        issuedInRollingWindow: 999,
      }),
    ).toBe(9);
    expect(
      calculateIssuanceOverrideUsage({
        count: 10,
        outstandingOrUnsettled: 100,
        issuedInRollingWindow: 100,
      }),
    ).toBe(0);
    expect(
      calculateIssuanceOverrideUsage({
        count: 1,
        outstandingOrUnsettled: 1005,
        issuedInRollingWindow: 1005,
      }),
    ).toBe(1);
  });

  it("maps only canonical vN crypto versions to database integers", () => {
    expect(parseExpertCodeKeyVersion("v12")).toBe(12);
    expect(() => parseExpertCodeKeyVersion("current")).toThrowError(
      "Invalid expert referral key version",
    );
  });

  it("returns plaintext once without exposing persistent lookup material", () => {
    const result = toPublicIssuedExpertReferralCode("code-id", {
      plaintext: "EXR_AAAAAAAAAAAAAAAAAAAAAA",
      digest: `hmac-sha256:v1:${"a".repeat(64)}`,
      hash: "a".repeat(64),
      keyVersion: "v1",
      maskedSuffix: "AAAAAA",
    });
    expect(result).toEqual({
      id: "code-id",
      plaintext: "EXR_AAAAAAAAAAAAAAAAAAAAAA",
      maskedSuffix: "AAAAAA",
    });
    expect(JSON.stringify(result)).not.toMatch(/digest|hash/iu);
  });

  it.each([
    { statuses: ["issued", "issued"] as const, expected: "issued" },
    {
      statuses: ["redeemed", "redeemed"] as const,
      expected: "fully_redeemed",
    },
    { statuses: ["revoked", "revoked"] as const, expected: "revoked" },
    {
      statuses: ["issued", "redeemed"] as const,
      expected: "partially_redeemed",
    },
    {
      statuses: ["redeemed", "revoked"] as const,
      expected: "partially_redeemed",
    },
  ])("derives $expected for $statuses", ({ statuses, expected }) => {
    expect(deriveExpertReferralBatchStatus(statuses)).toBe(expected);
  });
});

describe("PostgresExpertReferralRepository issuance quotas", () => {
  let testDb: ExpertReferralTestDatabase | undefined;
  const crypto = new ExpertCodeCrypto({
    currentVersion: "v1",
    activeVersions: ["v1"],
    key: () => new Uint8Array(32).fill(17),
  });

  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => {
    await testDb!.reset();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  async function issue(
    repository: PostgresExpertReferralRepository,
    inviterExpertId: string,
    count: number,
    overrideId?: string,
  ) {
    const audit = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviterExpertId,
    });
    return repository.issueBatch({
      inviterExpertId,
      count,
      issuedByAdminId: audit.adminId,
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
      ...(overrideId === undefined ? {} : { overrideId }),
    });
  }

  it("enforces both 1000-code limits and consumes a bounded dual approval", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    await expect(
      issue(repository, inviter.expertId, 1000),
    ).resolves.toMatchObject({
      codes: { length: 1000 },
    });
    await expect(issue(repository, inviter.expertId, 1)).rejects.toMatchObject({
      code: "EXPERT_REFERRAL_QUOTA_EXCEEDED",
    });

    const revokeAudit = await testDb!.createAdminAudit({
      action: "expert_referral.code_revoke",
      objectId: inviter.expertId,
    });
    await testDb!.db.execute(sql`
      update expert_referral_codes
      set status = 'revoked', revoked_at = transaction_timestamp(),
          revoked_approval_id = ${revokeAudit.approvalId}::uuid,
          revoked_admin_session_id_hash = ${revokeAudit.sessionIdHash}
      where inviter_expert_id = ${inviter.expertId}::uuid
    `);
    await expect(issue(repository, inviter.expertId, 1)).rejects.toMatchObject({
      code: "EXPERT_REFERRAL_QUOTA_EXCEEDED",
    });

    const override = await testDb!.createDualApprovedOverride({
      inviterExpertId: inviter.expertId,
      additionalQuota: 1,
    });
    await expect(
      issue(repository, inviter.expertId, 1, override.overrideId),
    ).resolves.toMatchObject({ codes: { length: 1 } });
    const consumed = await testDb!.db.execute<{ consumed: number }>(sql`
      select consumed_count as consumed
      from expert_referral_issuance_overrides
      where id = ${override.overrideId}::uuid
    `);
    expect(consumed.rows[0]?.consumed).toBe(1);
  });

  it.each([
    "action",
    "object",
    "session",
    "payload",
    "expired",
    "consumed",
  ] as const)("rejects an override with invalid %s approval binding", async (field) => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    await testDb!.seedExpertReferralQuotaLimit(inviter.expertId);
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const override = await testDb!.createDualApprovedOverride({
      inviterExpertId: inviter.expertId,
      additionalQuota: 1,
    });
    const unrelatedAudit =
      field === "session"
        ? await testDb!.createAdminAudit({
            action: "unrelated.action",
            objectId: randomUUID(),
          })
        : undefined;
    const mutation = {
      action: sql`action = 'unrelated.action'`,
      object: sql`object_id = ${randomUUID()}::uuid`,
      session: sql`requester_session_id_hash = ${unrelatedAudit?.sessionIdHash}`,
      payload: sql`payload_hash = ${`sha256:${"b".repeat(64)}`}`,
      expired: sql`expires_at = transaction_timestamp() - interval '1 second'`,
      consumed: sql`consumed_at = transaction_timestamp()`,
    }[field];
    await testDb!.db.execute(sql`
      update admin_approvals set ${mutation}
      where id = ${override.approvalOneId}::uuid
    `);
    await expect(
      issue(repository, inviter.expertId, 1, override.overrideId),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_OVERRIDE_INVALID" });
  });

  it("rejects reuse of already consumed override approvals", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    await testDb!.seedExpertReferralQuotaLimit(inviter.expertId);
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const override = await testDb!.createDualApprovedOverride({
      inviterExpertId: inviter.expertId,
      additionalQuota: 2,
    });
    await issue(repository, inviter.expertId, 1, override.overrideId);
    await expect(
      issue(repository, inviter.expertId, 1, override.overrideId),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_OVERRIDE_INVALID" });
  });
});
