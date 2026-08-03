import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import {
  effectiveFeatureControl,
  nextFeatureControlVersion,
  PostgresExpertReferralControlRepository,
} from "./expert-referral-control-repository.js";

describe("expert referral durable controls", () => {
  it("treats an absent feature-control row as disabled", () => {
    expect(effectiveFeatureControl(undefined)).toEqual({
      persisted: false,
      version: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    });
  });

  it("requires the exact persisted version for an update", () => {
    expect(nextFeatureControlVersion(0, undefined)).toBe(1);
    expect(nextFeatureControlVersion(3, { version: 3 })).toBe(4);
    expect(() => nextFeatureControlVersion(2, { version: 3 })).toThrowError(
      "Expert referral feature control version conflict",
    );
  });
});

describe("PostgresExpertReferralControlRepository", () => {
  let testDb: ExpertReferralTestDatabase | undefined;

  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => {
    await testDb!.reset();
  });
  afterAll(async () => {
    await testDb?.stop();
  });

  it("persists optimistic controls and rejects stale versions", async () => {
    const repository = new PostgresExpertReferralControlRepository(testDb!.db);
    const firstAudit = await testDb!.createAdminAudit({
      action: "expert_referral.feature_switch",
      objectId: crypto.randomUUID(),
    });
    await expect(
      repository.setFeatureControl({
        expectedVersion: 0,
        newCommandsEnabled: true,
        rewardGrantsEnabled: false,
        approvalId: firstAudit.approvalId,
        adminSessionIdHash: firstAudit.sessionIdHash,
      }),
    ).resolves.toMatchObject({
      persisted: true,
      version: 1,
      newCommandsEnabled: true,
      rewardGrantsEnabled: false,
    });
    const staleAudit = await testDb!.createAdminAudit({
      action: "expert_referral.feature_switch",
      objectId: crypto.randomUUID(),
    });
    await expect(
      repository.setFeatureControl({
        expectedVersion: 0,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
        approvalId: staleAudit.approvalId,
        adminSessionIdHash: staleAudit.sessionIdHash,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
  });

  it("opens and closes holds idempotently under the expert lock", async () => {
    const expert = await testDb!.createExpertIdentity();
    const repository = new PostgresExpertReferralControlRepository(testDb!.db);
    const openAudit = await testDb!.createAdminAudit({
      action: "expert_referral.abuse_hold_open",
      objectId: expert.expertId,
    });
    const openCommand = {
      expertId: expert.expertId,
      reasonCode: "manual_review",
      approvalId: openAudit.approvalId,
      adminSessionIdHash: openAudit.sessionIdHash,
    };
    const opened = await repository.openAbuseHold(openCommand);
    await expect(repository.openAbuseHold(openCommand)).resolves.toEqual(
      opened,
    );
    await expect(
      testDb!.db.transaction((tx) =>
        repository.lockEligibility(tx, expert.expertId),
      ),
    ).resolves.toMatchObject({ abuseCleared: false });

    const closeAudit = await testDb!.createAdminAudit({
      action: "expert_referral.abuse_hold_close",
      objectId: expert.expertId,
    });
    const closeCommand = {
      expertId: expert.expertId,
      reasonCode: "review_complete",
      approvalId: closeAudit.approvalId,
      adminSessionIdHash: closeAudit.sessionIdHash,
    };
    const closed = await repository.closeAbuseHold(closeCommand);
    await expect(repository.closeAbuseHold(closeCommand)).resolves.toEqual(
      closed,
    );
    await expect(repository.openAbuseHold(openCommand)).resolves.toEqual(
      closed,
    );
    await expect(
      testDb!.db.transaction((tx) =>
        repository.lockEligibility(tx, expert.expertId),
      ),
    ).resolves.toMatchObject({ abuseCleared: true });
  });
});
