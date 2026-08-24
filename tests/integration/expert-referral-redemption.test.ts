import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  ExpertCodeCrypto,
  type ExpertCodeKeyring,
} from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
import { PostgresExpertReferralControlRepository } from "../../packages/db/src/repositories/expert-referral-control-repository.js";
import { ExpertReferralTestkit } from "../../packages/db/src/testkit/expert-referral.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const keyring: ExpertCodeKeyring = {
  currentVersion: "v1",
  versions: ["v1"],
  key(version) {
    if (version !== "v1") throw new Error("unknown_key_version");
    return new Uint8Array(32).fill(7);
  },
};

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;
let repo: PostgresExpertReferralRepository;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
  repo = new PostgresExpertReferralRepository(
    testDb.db,
    new ExpertCodeCrypto(keyring),
  );
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

describe("expert referral code lifecycle", () => {
  it("issues a complete batch while persisting no plaintext code", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const evidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 2, overrideId: null },
    );

    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 2,
      ...evidence,
    });
    const stored = await fixtures.storedCodes();

    expect(batch.codes).toHaveLength(2);
    expect(stored).toHaveLength(2);
    expect(stored.map(({ status }) => status)).toEqual(["issued", "issued"]);
    expect(JSON.stringify(stored)).not.toContain(batch.codes[0]?.plaintext);
    expect(JSON.stringify(stored)).not.toContain(batch.codes[1]?.plaintext);
    expect(await repo.maskedInventory(inviter.expertId)).toEqual(
      stored.map((code) => ({
        batchId: batch.batchId,
        status: code.status,
        maskedSuffix: code.maskedSuffix,
        createdAt: expect.any(Date),
      })),
    );
  });

  it("fails closed when commands are disabled or issuance exceeds quota", async () => {
    const inviter = await fixtures.createExpert();
    const evidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );

    await expect(
      repo.issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        ...evidence,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_commands_disabled" });

    await fixtures.enableFeatureControl();
    await fixtures.seedIssuedQuota(inviter.expertId, 1000);
    const secondEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    await expect(
      repo.issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        ...secondEvidence,
      }),
    ).rejects.toMatchObject({
      code: "expert_referral_issuance_quota_exceeded",
    });
  });

  it("consumes a bounded dual-approved issuance override exactly once per extra code", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    await fixtures.seedIssuedQuota(inviter.expertId, 1000);
    const overrideId = await fixtures.createIssuanceOverride(
      inviter.expertId,
      2,
    );
    const issueOne = async () => {
      const evidence = await fixtures.createAdminEvidence(
        "expert_referral.batch_generate",
        inviter.expertId,
        { count: 1, overrideId },
      );
      return repo.issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        overrideId,
        ...evidence,
      });
    };

    await issueOne();
    await issueOne();
    expect(await fixtures.issuanceOverrideConsumedCount(overrideId)).toBe(2);
    await expect(issueOne()).rejects.toMatchObject({
      code: "expert_referral_override_invalid",
    });
    expect(await fixtures.issuanceOverrideConsumedCount(overrideId)).toBe(2);
  });

  it("redeems one code into an immutable inviter binding and supports masked revocation", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const invitee = await fixtures.createExpert();
    const issueEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 2, overrideId: null },
    );
    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 2,
      ...issueEvidence,
    });

    const redeemed = await repo.redeemCode({
      plaintext: batch.codes[0]!.plaintext,
      inviteeExpertId: invitee.expertId,
      provider: invitee.provider,
      externalId: invitee.externalId,
    });
    expect(redeemed).toMatchObject({
      inviterExpertId: inviter.expertId,
      inviteeExpertId: invitee.expertId,
    });
    expect(await fixtures.referralCount(invitee.expertId)).toBe(1);

    const revokeEvidence = await fixtures.createAdminEvidence(
      "expert_referral.code_revoke",
      batch.codes[1]!.codeId,
      { reasonCode: "inviter_request" },
    );
    const revoked = await repo.revokeCode({
      codeId: batch.codes[1]!.codeId,
      reasonCode: "inviter_request",
      ...revokeEvidence,
    });
    expect(revoked).toMatchObject({
      status: "revoked",
      maskedSuffix: batch.codes[1]!.maskedSuffix,
    });
    expect(JSON.stringify(revoked)).not.toContain(batch.codes[1]!.plaintext);
    await expect(
      repo.revokeCode({
        codeId: batch.codes[1]!.codeId,
        reasonCode: "different_reason",
        ...revokeEvidence,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
  });

  it("rejects self-referral, ineligible identity, and an open abuse hold", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const inactiveInvitee = await fixtures.createExpert({ active: false });
    const issueEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 3, overrideId: null },
    );
    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 3,
      ...issueEvidence,
    });

    await expect(
      repo.redeemCode({
        plaintext: batch.codes[0]!.plaintext,
        inviteeExpertId: inviter.expertId,
        provider: inviter.provider,
        externalId: inviter.externalId,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_self_referral" });

    await expect(
      repo.redeemCode({
        plaintext: batch.codes[1]!.plaintext,
        inviteeExpertId: inactiveInvitee.expertId,
        provider: inactiveInvitee.provider,
        externalId: inactiveInvitee.externalId,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_invitee_ineligible" });

    const heldInvitee = await fixtures.createExpert();
    const holdEvidence = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      heldInvitee.expertId,
      { reasonCode: "identity_review" },
    );
    await new PostgresExpertReferralControlRepository(testDb.db).openAbuseHold({
      expertId: heldInvitee.expertId,
      reasonCode: "identity_review",
      ...holdEvidence,
    });
    await expect(
      repo.redeemCode({
        plaintext: batch.codes[2]!.plaintext,
        inviteeExpertId: heldInvitee.expertId,
        provider: heldInvitee.provider,
        externalId: heldInvitee.externalId,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_invitee_ineligible" });
  });

  it("rejects revoked codes, mismatched channels, prior bindings, and prior settlements", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const boundInvitee = await fixtures.createExpert();
    const otherInvitee = await fixtures.createExpert();
    const settledInvitee = await fixtures.createExpert();
    await fixtures.seedFirstResidencySettlement(settledInvitee.expertId);
    const issueEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 4, overrideId: null },
    );
    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 4,
      ...issueEvidence,
    });
    const revokeEvidence = await fixtures.createAdminEvidence(
      "expert_referral.code_revoke",
      batch.codes[0]!.codeId,
      { reasonCode: "security_review" },
    );
    await repo.revokeCode({
      codeId: batch.codes[0]!.codeId,
      reasonCode: "security_review",
      ...revokeEvidence,
    });

    await expect(
      repo.redeemCode({
        plaintext: batch.codes[0]!.plaintext,
        inviteeExpertId: otherInvitee.expertId,
        provider: otherInvitee.provider,
        externalId: otherInvitee.externalId,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_code_unavailable" });

    await repo.redeemCode({
      plaintext: batch.codes[1]!.plaintext,
      inviteeExpertId: boundInvitee.expertId,
      provider: boundInvitee.provider,
      externalId: boundInvitee.externalId,
    });
    await expect(
      repo.redeemCode({
        plaintext: batch.codes[2]!.plaintext,
        inviteeExpertId: boundInvitee.expertId,
        provider: boundInvitee.provider,
        externalId: boundInvitee.externalId,
      }),
    ).rejects.toMatchObject({ code: "expert_referral_already_bound" });

    await expect(
      repo.redeemCode({
        plaintext: batch.codes[2]!.plaintext,
        inviteeExpertId: otherInvitee.expertId,
        provider: otherInvitee.provider,
        externalId: "wrong-channel",
      }),
    ).rejects.toMatchObject({ code: "expert_referral_invitee_ineligible" });

    await expect(
      repo.redeemCode({
        plaintext: batch.codes[3]!.plaintext,
        inviteeExpertId: settledInvitee.expertId,
        provider: settledInvitee.provider,
        externalId: settledInvitee.externalId,
      }),
    ).rejects.toMatchObject({
      code: "expert_referral_first_residency_settled",
    });
  });

  it("redacts persisted digests from database collision errors", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const plaintext = "EXR_AAAAAAAAAAAAAAAAAAAAAA";
    const digest = "hmac-sha256:v1:" + "a".repeat(64);
    const fixedCrypto = {
      issue: () => [
        { plaintext, digest, keyVersion: 1, maskedSuffix: "…AAAA" },
      ],
      digestCandidates: () => [{ keyVersion: 1, digest }],
      verify: () => true,
    };
    const collisionRepo = new PostgresExpertReferralRepository(
      testDb.db,
      fixedCrypto,
    );
    const firstEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    const secondEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    await collisionRepo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      ...firstEvidence,
    });

    let caught: unknown;
    try {
      await collisionRepo.issueBatch({
        inviterExpertId: inviter.expertId,
        count: 1,
        ...secondEvidence,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "expert_referral_issuance_failed" });
    expect(String(caught)).not.toContain(digest);
  });

  it("redacts every raw database error property when revocation fails", async () => {
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const issueEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      ...issueEvidence,
    });
    const stored = (await fixtures.storedCodes())[0]!;
    const revokeEvidence = await fixtures.createAdminEvidence(
      "expert_referral.code_revoke",
      batch.codes[0]!.codeId,
      { reasonCode: "security_response" },
    );
    await testDb.db.execute(sql`
      create function test_fail_expert_referral_revoke() returns trigger as $$
      begin
        if new.status = 'revoked' then
          raise exception 'forced revoke failure' using detail = old.code_hash;
        end if;
        return new;
      end
      $$ language plpgsql
    `);
    await testDb.db.execute(sql`
      create trigger test_fail_expert_referral_revoke
      before update on expert_referral_codes
      for each row execute function test_fail_expert_referral_revoke()
    `);

    let caught: unknown;
    try {
      await repo.revokeCode({
        codeId: batch.codes[0]!.codeId,
        reasonCode: "security_response",
        ...revokeEvidence,
      });
    } catch (error) {
      caught = error;
    } finally {
      await testDb.db.execute(
        sql`drop trigger test_fail_expert_referral_revoke on expert_referral_codes`,
      );
      await testDb.db.execute(
        sql`drop function test_fail_expert_referral_revoke()`,
      );
    }

    expect(caught).toMatchObject({
      code: "expert_referral_revocation_failed",
      databaseCode: "P0001",
    });
    const exposedProperties = Object.fromEntries(
      Reflect.ownKeys(caught as object).map((key) => [
        String(key),
        (caught as Record<PropertyKey, unknown>)[key],
      ]),
    );
    expect(JSON.stringify(exposedProperties)).not.toContain(stored.codeHash);
    expect(exposedProperties).not.toHaveProperty("cause");
    expect(exposedProperties).not.toHaveProperty("query");
    expect(exposedProperties).not.toHaveProperty("params");
  });
});
