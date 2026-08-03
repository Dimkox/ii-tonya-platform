import { sql } from "drizzle-orm";
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
    const firstCommand = {
      expectedVersion: 0,
      newCommandsEnabled: true,
      rewardGrantsEnabled: false,
    };
    const firstAudit = await testDb!.createFeatureControlApproval(firstCommand);
    await expect(
      repository.setFeatureControl({
        ...firstCommand,
        approvalId: firstAudit.approvalId,
        adminSessionIdHash: firstAudit.sessionIdHash,
      }),
    ).resolves.toMatchObject({
      persisted: true,
      version: 1,
      newCommandsEnabled: true,
      rewardGrantsEnabled: false,
    });
    await expect(
      repository.setFeatureControl({
        expectedVersion: 1,
        newCommandsEnabled: false,
        rewardGrantsEnabled: false,
        approvalId: firstAudit.approvalId,
        adminSessionIdHash: firstAudit.sessionIdHash,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_APPROVAL_INVALID" });

    const staleCommand = {
      expectedVersion: 0,
      newCommandsEnabled: false,
      rewardGrantsEnabled: false,
    };
    const staleAudit = await testDb!.createFeatureControlApproval(staleCommand);
    await expect(
      repository.setFeatureControl({
        ...staleCommand,
        approvalId: staleAudit.approvalId,
        adminSessionIdHash: staleAudit.sessionIdHash,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });

    const secondCommand = {
      expectedVersion: 1,
      newCommandsEnabled: false,
      rewardGrantsEnabled: true,
    };
    const secondAudit = await testDb!.createFeatureControlApproval(secondCommand);
    await expect(
      repository.setFeatureControl({
        ...secondCommand,
        approvalId: secondAudit.approvalId,
        adminSessionIdHash: secondAudit.sessionIdHash,
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it.each(["action", "object", "session", "payload"] as const)(
    "rejects a feature switch approval with wrong %s binding",
    async (field) => {
      const repository = new PostgresExpertReferralControlRepository(testDb!.db);
      const command = {
        expectedVersion: 0,
        newCommandsEnabled: true,
        rewardGrantsEnabled: false,
      };
      const audit = await testDb!.createFeatureControlApproval(command);
      const unrelatedAudit =
        field === "session"
          ? await testDb!.createAdminAudit({
              action: "unrelated.action",
              objectId: crypto.randomUUID(),
            })
          : undefined;
      const mutation = {
        action: sql`action = 'unrelated.action'`,
        object: sql`object_id = ${crypto.randomUUID()}::uuid`,
        session: sql`requester_session_id_hash = ${unrelatedAudit?.sessionIdHash}`,
        payload: sql`payload_hash = ${`sha256:${"b".repeat(64)}`}`,
      }[field];
      await testDb!.db.execute(sql`
        update admin_approvals set ${mutation}
        where id = ${audit.approvalId}::uuid
      `);
      await expect(
        repository.setFeatureControl({
          ...command,
          approvalId: audit.approvalId,
          adminSessionIdHash: audit.sessionIdHash,
        }),
      ).rejects.toMatchObject({ code: "FEATURE_CONTROL_APPROVAL_INVALID" });
    },
  );

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
      repository.openAbuseHold({ ...openCommand, reasonCode: "different" }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
    await expect(
      repository.openAbuseHold({
        ...openCommand,
        adminSessionIdHash: "different-session",
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
    const conflictingOpenAudit = await testDb!.createAdminAudit({
      action: "expert_referral.abuse_hold_open",
      objectId: expert.expertId,
    });
    await expect(
      repository.openAbuseHold({
        ...openCommand,
        approvalId: conflictingOpenAudit.approvalId,
        adminSessionIdHash: conflictingOpenAudit.sessionIdHash,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
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
    await expect(
      repository.closeAbuseHold({ ...closeCommand, reasonCode: "different" }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
    await expect(
      repository.closeAbuseHold({
        ...closeCommand,
        adminSessionIdHash: "different-session",
      }),
    ).rejects.toMatchObject({ code: "FEATURE_CONTROL_CONFLICT" });
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
