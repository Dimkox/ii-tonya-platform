import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresExpertReferralControlRepository } from "./expert-referral-control-repository.js";
import {
  EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID,
  ExpertReferralTestkit,
} from "../testkit/expert-referral.js";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";

let testDb: TestDatabase;
let fixtures: ExpertReferralTestkit;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  fixtures = new ExpertReferralTestkit(testDb.db);
}, 120_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

describe("expert referral durable controls", () => {
  it("treats an absent feature row as persisted default-off state", async () => {
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    const state = await testDb.db.transaction((tx) =>
      repo.lockFeatureControl(tx),
    );

    expect(state).toEqual({
      persisted: false,
      version: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    });
  });

  it("updates feature state only at the expected durable version", async () => {
    const evidence = await fixtures.createAdminEvidence(
      "expert_referral.feature_switch",
      EXPERT_REFERRAL_FEATURE_CONTROL_TEST_OBJECT_ID,
      {
        expectedVersion: 0,
        newCommandsEnabled: true,
        rewardGrantsEnabled: false,
      },
    );
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    const enabled = await repo.updateFeatureControl({
      expectedVersion: 0,
      newCommandsEnabled: true,
      rewardGrantsEnabled: false,
      ...evidence,
    });

    expect(enabled).toMatchObject({
      persisted: true,
      version: 1,
      newCommandsEnabled: true,
    });
    expect(
      await fixtures.auditEventCount("expert_referral.feature_switch"),
    ).toBe(1);
    await expect(
      repo.updateFeatureControl({
        expectedVersion: 0,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
        ...evidence,
      }),
    ).rejects.toMatchObject({ code: "feature_control_version_conflict" });
  });

  it("opens and closes one audited abuse hold idempotently", async () => {
    const expert = await fixtures.createExpert();
    const opened = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      expert.expertId,
      { reasonCode: "identity_review" },
    );
    const closed = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_close",
      expert.expertId,
      { reasonCode: "identity_cleared" },
    );
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    const first = await repo.openAbuseHold({
      expertId: expert.expertId,
      reasonCode: "identity_review",
      ...opened,
    });
    const replay = await repo.openAbuseHold({
      expertId: expert.expertId,
      reasonCode: "identity_review",
      ...opened,
    });
    expect(replay).toEqual(first);

    const ineligible = await testDb.db.transaction((tx) =>
      repo.lockEligibility(tx, expert.expertId),
    );
    expect(ineligible).toMatchObject({
      uniqueIdentity: true,
      abuseCleared: false,
    });

    const closedResult = await repo.closeAbuseHold({
      expertId: expert.expertId,
      reasonCode: "identity_cleared",
      ...closed,
    });
    expect(
      await repo.closeAbuseHold({
        expertId: expert.expertId,
        reasonCode: "identity_cleared",
        ...closed,
      }),
    ).toEqual(closedResult);
    expect(
      (
        await testDb.db.transaction((tx) =>
          repo.lockEligibility(tx, expert.expertId),
        )
      ).abuseCleared,
    ).toBe(true);
    expect(
      await fixtures.auditEventCount("expert_referral.abuse_hold_open"),
    ).toBe(1);
    expect(
      await fixtures.auditEventCount("expert_referral.abuse_hold_close"),
    ).toBe(1);
  });

  it("locks channel identity as part of transaction-time eligibility", async () => {
    const expert = await fixtures.createExpert();
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    expect(
      (
        await testDb.db.transaction((tx) =>
          repo.lockEligibility(tx, expert.expertId),
        )
      ).uniqueIdentity,
    ).toBe(true);

    await fixtures.deleteChannelIdentities(expert.userId);
    expect(
      (
        await testDb.db.transaction((tx) =>
          repo.lockEligibility(tx, expert.expertId),
        )
      ).uniqueIdentity,
    ).toBe(false);
  });

  it("rejects an approval bound to another action and a conflicting hold replay", async () => {
    const expert = await fixtures.createExpert();
    const wrongAction = await fixtures.createAdminEvidence(
      "expert_referral.code_revoke",
      expert.expertId,
      { reasonCode: "identity_review" },
    );
    const wrongPayload = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      expert.expertId,
      { reasonCode: "approved_reason" },
    );
    const opened = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      expert.expertId,
      { reasonCode: "identity_review" },
    );
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    await expect(
      repo.openAbuseHold({
        expertId: expert.expertId,
        reasonCode: "identity_review",
        ...wrongAction,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
    await expect(
      repo.openAbuseHold({
        expertId: expert.expertId,
        reasonCode: "different_reason",
        ...wrongPayload,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });

    await repo.openAbuseHold({
      expertId: expert.expertId,
      reasonCode: "identity_review",
      ...opened,
    });
    await expect(
      repo.openAbuseHold({
        expertId: expert.expertId,
        reasonCode: "different_reason",
        ...opened,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
  });

  it("rejects an approval whose approver session belongs to another admin", async () => {
    const expert = await fixtures.createExpert();
    const evidence = await fixtures.createAdminEvidence(
      "expert_referral.abuse_hold_open",
      expert.expertId,
      { reasonCode: "identity_review" },
    );
    await fixtures.replaceApprovalApproverSessionWithUnrelated(
      evidence.approvalId,
    );
    const repo = new PostgresExpertReferralControlRepository(testDb.db);

    await expect(
      repo.openAbuseHold({
        expertId: expert.expertId,
        reasonCode: "identity_review",
        ...evidence,
      }),
    ).rejects.toMatchObject({ code: "admin_evidence_invalid" });
  });
});
