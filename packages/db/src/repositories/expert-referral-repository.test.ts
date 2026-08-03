import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import {
  calculateIssuanceOverrideUsage,
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

    const overrideId = await testDb!.createDualApprovedOverride({
      inviterExpertId: inviter.expertId,
      additionalQuota: 1,
    });
    await expect(
      issue(repository, inviter.expertId, 1, overrideId),
    ).resolves.toMatchObject({ codes: { length: 1 } });
    const consumed = await testDb!.db.execute<{ consumed: number }>(sql`
      select consumed_count as consumed
      from expert_referral_issuance_overrides
      where id = ${overrideId}::uuid
    `);
    expect(consumed.rows[0]?.consumed).toBe(1);
  });
});
