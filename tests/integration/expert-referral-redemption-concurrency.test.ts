import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ExpertCodeCrypto,
  type ExpertCodeKeyring,
} from "../../packages/application/src/expert-code-crypto.js";
import { PostgresExpertReferralRepository } from "../../packages/db/src/repositories/expert-referral-repository.js";
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
    return new Uint8Array(32).fill(9);
  },
};

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);

afterAll(async () => testDb?.stop(), 120_000);
beforeEach(async () => testDb.reset());

describe("expert referral redemption concurrency", () => {
  it("allows exactly one invitee to consume a single code", async () => {
    const fixtures = new ExpertReferralTestkit(testDb.db);
    await fixtures.enableFeatureControl();
    const inviter = await fixtures.createExpert();
    const invitees = await Promise.all([
      fixtures.createExpert(),
      fixtures.createExpert(),
    ]);
    const evidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      inviter.expertId,
      { count: 1, overrideId: null },
    );
    const repo = new PostgresExpertReferralRepository(
      testDb.db,
      new ExpertCodeCrypto(keyring),
    );
    const batch = await repo.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      ...evidence,
    });
    const plaintext = batch.codes[0]!.plaintext;

    const outcomes = await Promise.allSettled(
      invitees.map((invitee) =>
        repo.redeemCode({
          plaintext,
          inviteeExpertId: invitee.expertId,
          provider: invitee.provider,
          externalId: invitee.externalId,
        }),
      ),
    );

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(await fixtures.referralCount()).toBe(1);
  });

  it("does not deadlock issuance against redemption for the same expert", async () => {
    const fixtures = new ExpertReferralTestkit(testDb.db);
    await fixtures.enableFeatureControl();
    const issuer = await fixtures.createExpert();
    const redeemingExpert = await fixtures.createExpert();
    const repo = new PostgresExpertReferralRepository(
      testDb.db,
      new ExpertCodeCrypto(keyring),
    );
    const sourceEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      issuer.expertId,
      { count: 1, overrideId: null },
    );
    const concurrentEvidence = await fixtures.createAdminEvidence(
      "expert_referral.batch_generate",
      redeemingExpert.expertId,
      { count: 1, overrideId: null },
    );
    const source = await repo.issueBatch({
      inviterExpertId: issuer.expertId,
      count: 1,
      ...sourceEvidence,
    });

    const [issued, redeemed] = await Promise.all([
      repo.issueBatch({
        inviterExpertId: redeemingExpert.expertId,
        count: 1,
        ...concurrentEvidence,
      }),
      repo.redeemCode({
        plaintext: source.codes[0]!.plaintext,
        inviteeExpertId: redeemingExpert.expertId,
        provider: redeemingExpert.provider,
        externalId: redeemingExpert.externalId,
      }),
    ]);

    expect(issued.codes).toHaveLength(1);
    expect(redeemed.inviteeExpertId).toBe(redeemingExpert.expertId);
  });
});
