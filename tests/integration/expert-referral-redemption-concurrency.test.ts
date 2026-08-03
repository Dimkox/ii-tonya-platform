import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let testDb: ExpertReferralTestDatabase | undefined;

describe("expert referral redemption concurrency", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => {
    await testDb!.reset();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  it("allows exactly one invitee to redeem a code", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const first = await testDb!.createExpertIdentity();
    const second = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralRepository(
      testDb!.db,
      new ExpertCodeCrypto({
        currentVersion: "v1",
        activeVersions: ["v1"],
        key: () => new Uint8Array(32).fill(13),
      }),
    );
    const audit = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const issued = await repository.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      issuedByAdminId: audit.adminId,
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
    const plaintext = issued.codes[0]!.plaintext;

    const attempts = await Promise.allSettled(
      [first, second].map((invitee) =>
        repository.redeemCode({
          plaintext,
          userId: invitee.userId,
          provider: invitee.provider,
          externalId: invitee.externalId,
        }),
      ),
    );
    expect({
      succeeded: attempts.filter(({ status }) => status === "fulfilled").length,
      rejected: attempts.filter(({ status }) => status === "rejected").length,
    }).toEqual({ succeeded: 1, rejected: 1 });
  });
});
