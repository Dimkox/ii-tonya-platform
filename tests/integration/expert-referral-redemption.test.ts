import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../packages/application/src/expert-code-crypto.js";
import {
  ExpertReferralCommandError,
  PostgresExpertReferralRepository,
} from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertReferralControlRepository } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

let testDb: ExpertReferralTestDatabase | undefined;

const crypto = new ExpertCodeCrypto({
  currentVersion: "v1",
  activeVersions: ["v1"],
  key: () => new Uint8Array(32).fill(11),
});

describe("expert referral lifecycle", () => {
  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    await testDb!.reset();
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  async function issueOne(inviterExpertId: string) {
    const audit = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviterExpertId,
    });
    return new PostgresExpertReferralRepository(testDb!.db, crypto).issueBatch({
      inviterExpertId,
      count: 1,
      issuedByAdminId: audit.adminId,
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    });
  }

  it("persists no plaintext and atomically binds one eligible invitee", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const invitee = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const issued = await issueOne(inviter.expertId);
    const plaintext = issued.codes[0]!.plaintext;

    const stored = await testDb!.db.execute<Record<string, unknown>>(sql`
      select * from expert_referral_codes
    `);
    expect(JSON.stringify(stored.rows)).not.toContain(plaintext);
    expect(stored.rows[0]).toMatchObject({
      code_hash: issued.codes[0]!.hash,
      key_version: 1,
      masked_suffix: issued.codes[0]!.maskedSuffix,
    });

    const result = await repository.redeemCode({
      plaintext,
      userId: invitee.userId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });
    expect(result).toMatchObject({
      inviterExpertId: inviter.expertId,
      inviteeExpertId: invitee.expertId,
    });
    await expect(repository.maskedInventory(inviter.expertId)).resolves.toEqual(
      [
        expect.objectContaining({
          status: "redeemed",
          maskedSuffix: issued.codes[0]!.maskedSuffix,
        }),
      ],
    );
  });

  it("fails closed while the durable command switch is absent", async () => {
    const inviter = await testDb!.createExpertIdentity();
    await expect(issueOne(inviter.expertId)).rejects.toMatchObject({
      code: "EXPERT_REFERRAL_DISABLED",
    });
  });

  it.each([
    { active: false, verified: true, label: "inactive" },
    { active: true, verified: false, label: "unverified" },
  ])("rejects an $label invitee", async ({ active, verified }) => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const invitee = await testDb!.createExpertIdentity({ active, verified });
    const issued = await issueOne(inviter.expertId);
    await expect(
      new PostgresExpertReferralRepository(testDb!.db, crypto).redeemCode({
        plaintext: issued.codes[0]!.plaintext,
        userId: invitee.userId,
        provider: invitee.provider,
        externalId: invitee.externalId,
      }),
    ).rejects.toBeInstanceOf(ExpertReferralCommandError);
  });

  it("rejects self-referral, an open abuse hold, and prior settlement", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const held = await testDb!.createExpertIdentity();
    const settled = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const selfCode = await issueOne(inviter.expertId);
    await expect(
      repository.redeemCode({
        plaintext: selfCode.codes[0]!.plaintext,
        userId: inviter.userId,
        provider: inviter.provider,
        externalId: inviter.externalId,
      }),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_NOT_ELIGIBLE" });

    const holdAudit = await testDb!.createAdminAudit({
      action: "expert_referral.abuse_hold_open",
      objectId: held.expertId,
    });
    await new PostgresExpertReferralControlRepository(testDb!.db).openAbuseHold(
      {
        expertId: held.expertId,
        reasonCode: "manual_review",
        approvalId: holdAudit.approvalId,
        adminSessionIdHash: holdAudit.sessionIdHash,
      },
    );
    const heldCode = await issueOne(inviter.expertId);
    await expect(
      repository.redeemCode({
        plaintext: heldCode.codes[0]!.plaintext,
        userId: held.userId,
        provider: held.provider,
        externalId: held.externalId,
      }),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_NOT_ELIGIBLE" });

    await testDb!.seedFirstSettlement(settled.expertId);
    const settledCode = await issueOne(inviter.expertId);
    await expect(
      repository.redeemCode({
        plaintext: settledCode.codes[0]!.plaintext,
        userId: settled.userId,
        provider: settled.provider,
        externalId: settled.externalId,
      }),
    ).rejects.toMatchObject({ code: "EXPERT_REFERRAL_NOT_ELIGIBLE" });
  });

  it("revokes an unused code idempotently and never exposes its digest", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    const issued = await issueOne(inviter.expertId);
    const audit = await testDb!.createAdminAudit({
      action: "expert_referral.code_revoke",
      objectId: issued.codes[0]!.id,
    });
    const command = {
      codeId: issued.codes[0]!.id,
      approvalId: audit.approvalId,
      adminSessionIdHash: audit.sessionIdHash,
    };
    await expect(repository.revokeCode(command)).resolves.toMatchObject({
      status: "revoked",
    });
    await expect(repository.revokeCode(command)).resolves.toMatchObject({
      status: "revoked",
    });
    expect(
      JSON.stringify(await repository.maskedInventory(inviter.expertId)),
    ).not.toContain(issued.codes[0]!.hash);
  });
});
