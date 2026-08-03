import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import type { DrizzleDb } from "../client.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { PostgresExpertReferralAdminRepository } from "./expert-referral-admin-repository.js";
import {
  expertReferralOverrideApprovalPayload,
  PostgresExpertReferralRepository,
  type ExpertReferralCodeCrypto,
} from "./expert-referral-repository.js";

describe("PostgresExpertReferralAdminRepository", () => {
  let testDb: ExpertReferralTestDatabase | undefined;
  const crypto = new ExpertCodeCrypto({
    currentVersion: "v1",
    activeVersions: ["v1"],
    key: () => new Uint8Array(32).fill(29),
  });

  beforeAll(async () => {
    testDb = await startExpertReferralTestDatabase();
  }, 120_000);
  beforeEach(async () => testDb!.reset());
  afterAll(async () => testDb?.stop());

  async function overrideApprovals(input: {
    inviterExpertId: string;
    additionalQuota: number;
    duplicateApprover?: boolean;
  }) {
    const overrideId = randomUUID();
    const bootstrap = await testDb!.createAdminAudit({
      action: "unrelated.bootstrap",
      objectId: randomUUID(),
    });
    const validFrom = new Date(Date.now() - 60_000);
    const validUntil = new Date(Date.now() + 60 * 60_000);
    const payload = expertReferralOverrideApprovalPayload({
      overrideId,
      inviterExpertId: input.inviterExpertId,
      additionalQuota: input.additionalQuota,
      reasonCode: "approved_test",
      validFrom,
      validUntil,
      requesterId: bootstrap.adminId,
      requesterSessionIdHash: bootstrap.sessionIdHash,
    });
    const approverOneId = await testDb!.createUser();
    const first = await testDb!.createAdminAudit({
      action: "expert_referral.issuance_override",
      objectType: "expert_referral_issuance_override",
      objectId: overrideId,
      adminId: bootstrap.adminId,
      sessionIdHash: bootstrap.sessionIdHash,
      approverId: approverOneId,
      payload,
    });
    const second = await testDb!.createAdminAudit({
      action: "expert_referral.issuance_override",
      objectType: "expert_referral_issuance_override",
      objectId: overrideId,
      adminId: bootstrap.adminId,
      sessionIdHash: bootstrap.sessionIdHash,
      approverId: input.duplicateApprover
        ? approverOneId
        : await testDb!.createUser(),
      payload,
    });
    return { overrideId, payload, first, second };
  }

  it("atomically consumes both approvals at override creation and uses their immutable facts later", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    await testDb!.seedExpertReferralQuotaLimit(inviter.expertId);
    const pair = await overrideApprovals({
      inviterExpertId: inviter.expertId,
      additionalQuota: 1,
    });
    const admin = new PostgresExpertReferralAdminRepository(testDb!.db, crypto);
    await expect(admin.execute({
      action: "expert_referral.issuance_override",
      objectId: pair.overrideId,
      approvalId: pair.first.approvalId,
      secondApprovalId: pair.second.approvalId,
      nonce: pair.first.nonce,
      secondNonce: pair.second.nonce,
      correlationId: `test-${randomUUID()}`,
      payload: pair.payload,
      sessionIdHash: pair.first.sessionIdHash,
      environmentCeilings: { expertReferral: true, expertResidencyBilling: true },
    })).resolves.toMatchObject({ allowed: true, overrideId: pair.overrideId });

    const approvals = await testDb!.db.execute<{ consumed: boolean }>(sql`
      select consumed_at is not null as consumed
      from admin_approvals
      where id in (${pair.first.approvalId}::uuid, ${pair.second.approvalId}::uuid)
      order by id
    `);
    expect(approvals.rows).toHaveLength(2);
    expect(approvals.rows.every((row) => row.consumed)).toBe(true);

    const batchApproval = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
    });
    const repository = new PostgresExpertReferralRepository(testDb!.db, crypto);
    await expect(repository.issueBatch({
      inviterExpertId: inviter.expertId,
      count: 1,
      issuedByAdminId: batchApproval.adminId,
      approvalId: batchApproval.approvalId,
      adminSessionIdHash: batchApproval.sessionIdHash,
      overrideId: pair.overrideId,
    })).resolves.toMatchObject({ codes: { length: 1 } });
  });

  it("denies duplicate approvers without consuming either approval and writes a denied audit", async () => {
    const inviter = await testDb!.createExpertIdentity();
    const pair = await overrideApprovals({
      inviterExpertId: inviter.expertId,
      additionalQuota: 1,
      duplicateApprover: true,
    });
    const admin = new PostgresExpertReferralAdminRepository(testDb!.db, crypto);
    await expect(admin.execute({
      action: "expert_referral.issuance_override",
      objectId: pair.overrideId,
      approvalId: pair.first.approvalId,
      secondApprovalId: pair.second.approvalId,
      nonce: pair.first.nonce,
      secondNonce: pair.second.nonce,
      correlationId: `test-${randomUUID()}`,
      payload: pair.payload,
      sessionIdHash: pair.first.sessionIdHash,
      environmentCeilings: { expertReferral: true, expertResidencyBilling: true },
    })).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    const state = await testDb!.db.execute<{ unconsumed: boolean }>(sql`
      select consumed_at is null as unconsumed from admin_approvals
      where id in (${pair.first.approvalId}::uuid, ${pair.second.approvalId}::uuid)
    `);
    expect(state.rows.every((row) => row.unconsumed)).toBe(true);
    const audit = await testDb!.db.execute<{ decision: string }>(sql`
      select decision from audit_events
      where object_id=${pair.overrideId}::uuid and decision='denied'
    `);
    expect(audit.rows).toEqual([{ decision: "denied" }]);
  });

  it("retries the whole serializable unit without double consumption or exposing first-attempt plaintext", async () => {
    await testDb!.enableExpertReferralCommands();
    const inviter = await testDb!.createExpertIdentity();
    const payload = { count: 1, inviterExpertId: inviter.expertId };
    const approval = await testDb!.createAdminAudit({
      action: "expert_referral.batch_generate",
      objectType: "expert",
      objectId: inviter.expertId,
      payload,
    });
    let injectSerializationFailure = true;
    const retryDb = new Proxy(testDb!.db, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return async (callback: Parameters<DrizzleDb["transaction"]>[0]) =>
          testDb!.db.transaction(async (tx) => {
            const result = await callback(tx);
            if (injectSerializationFailure) {
              injectSerializationFailure = false;
              throw Object.assign(new Error("forced serialization failure"), { code: "40001" });
            }
            return result;
          });
      },
    }) as DrizzleDb;
    const plaintextAttempts: string[][] = [];
    const recordingCrypto: ExpertReferralCodeCrypto = {
      issue(count) {
        const issued = crypto.issue(count);
        plaintextAttempts.push(issued.map((code) => code.plaintext));
        return issued;
      },
      digestCandidates: (plaintext) => crypto.digestCandidates(plaintext),
    };
    const admin = new PostgresExpertReferralAdminRepository(retryDb, recordingCrypto);
    const command = {
      action: "expert_referral.batch_generate",
      objectId: inviter.expertId,
      approvalId: approval.approvalId,
      nonce: approval.nonce,
      correlationId: `test-${randomUUID()}`,
      payload,
      sessionIdHash: approval.sessionIdHash,
      environmentCeilings: { expertReferral: true, expertResidencyBilling: true },
    } as const;
    const result = await admin.execute(command);
    expect(plaintextAttempts).toHaveLength(2);
    expect(result).toMatchObject({ allowed: true, codes: plaintextAttempts[1] });
    expect(JSON.stringify(result)).not.toContain(plaintextAttempts[0]![0]);
    if (!result.allowed || typeof result.batchId !== "string") throw new Error("Expected successful batch result");
    const replay = await admin.execute(command);
    expect(replay).toEqual({ allowed: true, replayed: true, batchId: result.batchId, count: 1 });
    expect(JSON.stringify(replay)).not.toMatch(/codes|plaintext|digest|hash/iu);
    const committed = await testDb!.db.execute<{ batches: number; consumed: number; audits: number; results: number; safeResult: unknown }>(sql`
      select
        (select count(*)::int from expert_referral_code_batches) as batches,
        (select count(*)::int from admin_approvals where id=${approval.approvalId}::uuid and consumed_at is not null) as consumed,
        (select count(*)::int from audit_events where object_id=${inviter.expertId}::uuid and decision='allowed') as audits,
        (select count(*)::int from expert_referral_admin_execution_results where approval_id=${approval.approvalId}::uuid) as results,
        (select safe_result from expert_referral_admin_execution_results where approval_id=${approval.approvalId}::uuid) as "safeResult"
    `);
    expect(committed.rows[0]).toMatchObject({ batches: 1, consumed: 1, audits: 1, results: 1 });
    expect(JSON.stringify(committed.rows[0]?.safeResult)).not.toMatch(/codes|plaintext|digest|hash/iu);
    await expect(testDb!.db.execute(sql`
      update expert_referral_admin_execution_results set safe_result='{}'::jsonb
      where approval_id=${approval.approvalId}::uuid
    `)).rejects.toMatchObject({ code: "55000" });
  });
});
