import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpertCodeCrypto } from "../../../application/src/expert-code-crypto.js";
import { expectPostgresErrorCause } from "../../../../tests/support/postgres-error.js";
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

const rejected = async (operation: Promise<unknown>): Promise<unknown> =>
  operation.then(
    () => {
      throw new Error("Expected PostgreSQL rejection");
    },
    (error: unknown) => error,
  );

const expectAdminResultPostgresError = async (
  operation: Promise<unknown>,
  code: string,
  message: string,
): Promise<void> => {
  expectPostgresErrorCause(await rejected(operation), code, message);
};

const checkConstraintMessage = (constraint: string): string =>
  `new row for relation "expert_referral_admin_execution_results" violates check constraint "${constraint}"`;

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
    const command = {
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
    } as const;
    await expect(admin.execute(command)).resolves.toMatchObject({ allowed: true, overrideId: pair.overrideId });
    await expect(admin.execute(command)).resolves.toEqual({ allowed: true, replayed: true, overrideId: pair.overrideId });

    const approvals = await testDb!.db.execute<{ consumed: boolean }>(sql`
      select consumed_at is not null as consumed
      from admin_approvals
      where id in (${pair.first.approvalId}::uuid, ${pair.second.approvalId}::uuid)
      order by id
    `);
    expect(approvals.rows).toHaveLength(2);
    expect(approvals.rows.every((row) => row.consumed)).toBe(true);

    await testDb!.db.execute(sql`update admin_approvals set consumed_at=null where id=${pair.second.approvalId}::uuid`);
    await expect(admin.execute(command)).resolves.toEqual({ allowed: false, reasonCode: "approval_denied" });
    await testDb!.db.execute(sql`update admin_approvals set consumed_at=transaction_timestamp() where id=${pair.second.approvalId}::uuid`);

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

  it("rejects NULL dual bindings and semantically invalid or recursively secret safe results", async () => {
    const objectId = randomUUID();
    const audit = await testDb!.createAdminAudit({ action: "expert_referral.code_revoke", objectId, objectType: "expert_referral_code" });
    const base = sql`${audit.approvalId}::uuid,'expert_referral.code_revoke',${objectId}::uuid,${`sha256:${"a".repeat(64)}`},${`sha256:${"b".repeat(64)}`},${audit.sessionIdHash}`;
    await expectAdminResultPostgresError(testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,action,object_id,payload_hash,nonce_hash,requester_session_id_hash,safe_result) values (${base},${JSON.stringify({ id: randomUUID(), status: "banana" })}::jsonb)`), "23514", checkConstraintMessage("expert_referral_admin_result_exact_schema"));
    const overrideAudit = await testDb!.createAdminAudit({ action: "expert_referral.issuance_override", objectId, objectType: "expert_referral_issuance_override" });
    await expectAdminResultPostgresError(testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,action,object_id,payload_hash,nonce_hash,requester_session_id_hash,safe_result) values (${overrideAudit.approvalId}::uuid,'expert_referral.issuance_override',${objectId}::uuid,${`sha256:${"c".repeat(64)}`},${`sha256:${"d".repeat(64)}`},${overrideAudit.sessionIdHash},${JSON.stringify({ overrideId: objectId })}::jsonb)`), "23514", checkConstraintMessage("expert_referral_admin_result_second_binding"));
    const featureAudit = await testDb!.createAdminAudit({ action: "expert_referral.feature_switch", objectId: "00000000-0000-0000-0000-000000000041", objectType: "expert_referral_feature_control" });
    await expectAdminResultPostgresError(testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,action,object_id,payload_hash,nonce_hash,requester_session_id_hash,expected_version,safe_result) values (${featureAudit.approvalId}::uuid,'expert_referral.feature_switch','00000000-0000-0000-0000-000000000041'::uuid,${`sha256:${"e".repeat(64)}`},${`sha256:${"f".repeat(64)}`},${featureAudit.sessionIdHash},2,${JSON.stringify({ version: 9 })}::jsonb)`), "23514", checkConstraintMessage("expert_referral_admin_result_exact_schema"));
    const batchAudit = await testDb!.createAdminAudit({ action: "expert_referral.batch_generate", objectId, objectType: "expert" });
    await expectAdminResultPostgresError(testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,action,object_id,payload_hash,nonce_hash,requester_session_id_hash,safe_result) values (${batchAudit.approvalId}::uuid,'expert_referral.batch_generate',${objectId}::uuid,${`sha256:${"1".repeat(64)}`},${`sha256:${"2".repeat(64)}`},${batchAudit.sessionIdHash},${JSON.stringify({ batchId: { plaintext: "secret" }, count: 1 })}::jsonb)`), "23514", checkConstraintMessage("expert_referral_admin_result_exact_schema"));
    await testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,action,object_id,payload_hash,nonce_hash,requester_session_id_hash,safe_result) values (${audit.approvalId}::uuid,'expert_referral.code_revoke',${objectId}::uuid,${`sha256:${"3".repeat(64)}`},${`sha256:${"4".repeat(64)}`},${audit.sessionIdHash},${JSON.stringify({ id: objectId, status: "revoked" })}::jsonb)`);
    await expectAdminResultPostgresError(testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,second_approval_id,action,object_id,payload_hash,nonce_hash,second_nonce_hash,requester_session_id_hash,safe_result) values (${overrideAudit.approvalId}::uuid,${audit.approvalId}::uuid,'expert_referral.issuance_override',${objectId}::uuid,${`sha256:${"5".repeat(64)}`},${`sha256:${"6".repeat(64)}`},${`sha256:${"7".repeat(64)}`},${overrideAudit.sessionIdHash},${JSON.stringify({ overrideId: objectId })}::jsonb)`), "23505", "expert_referral_admin_approval_global_unique");
    await expectAdminResultPostgresError(testDb!.db.execute(sql`truncate table expert_referral_admin_execution_results`), "55000", "expert_referral_admin_result_immutable");
  });

  it("serializes swapped cross-column approval bindings so only one insert commits", async () => {
    const objectOne = randomUUID(), objectTwo = randomUUID();
    const first = await testDb!.createAdminAudit({ action: "expert_referral.issuance_override", objectId: objectOne, objectType: "expert_referral_issuance_override" });
    const second = await testDb!.createAdminAudit({ action: "expert_referral.issuance_override", objectId: objectTwo, objectType: "expert_referral_issuance_override" });
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    const inserts = await Promise.allSettled([
      testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,second_approval_id,action,object_id,payload_hash,nonce_hash,second_nonce_hash,requester_session_id_hash,safe_result) values (${first.approvalId}::uuid,${second.approvalId}::uuid,'expert_referral.issuance_override',${objectOne}::uuid,${hash("a")},${hash("b")},${hash("c")},${first.sessionIdHash},${JSON.stringify({ overrideId: objectOne })}::jsonb)`),
      testDb!.db.execute(sql`insert into expert_referral_admin_execution_results (approval_id,second_approval_id,action,object_id,payload_hash,nonce_hash,second_nonce_hash,requester_session_id_hash,safe_result) values (${second.approvalId}::uuid,${first.approvalId}::uuid,'expert_referral.issuance_override',${objectTwo}::uuid,${hash("d")},${hash("e")},${hash("f")},${second.sessionIdHash},${JSON.stringify({ overrideId: objectTwo })}::jsonb)`),
    ]);
    expect(inserts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(inserts.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps immutable triggers enabled after transactional test cleanup", async () => {
    const triggers = await testDb!.db.execute<{ name: string; enabled: string }>(sql`select tgname as name,tgenabled as enabled from pg_trigger where tgrelid='expert_referral_admin_execution_results'::regclass and tgname in ('expert_referral_admin_results_immutable','expert_referral_admin_results_truncate_immutable') order by tgname`);
    expect(triggers.rows).toEqual([
      { name: "expert_referral_admin_results_immutable", enabled: "O" },
      { name: "expert_referral_admin_results_truncate_immutable", enabled: "O" },
    ]);
  });

  it("consumes swapped dual approvals in one global order without leaking a deadlock", async () => {
    const inviter = await testDb!.createExpertIdentity();
    const pair = await overrideApprovals({ inviterExpertId: inviter.expertId, additionalQuota: 1 });
    const admin = new PostgresExpertReferralAdminRepository(testDb!.db, crypto);
    const base = { action: "expert_referral.issuance_override" as const, objectId: pair.overrideId, payload: pair.payload, sessionIdHash: pair.first.sessionIdHash, environmentCeilings: { expertReferral: true, expertResidencyBilling: true } };
    const executions = await Promise.allSettled([
      admin.execute({ ...base, approvalId: pair.first.approvalId, secondApprovalId: pair.second.approvalId, nonce: pair.first.nonce, secondNonce: pair.second.nonce, correlationId: `normal-${randomUUID()}` }),
      admin.execute({ ...base, approvalId: pair.second.approvalId, secondApprovalId: pair.first.approvalId, nonce: pair.second.nonce, secondNonce: pair.first.nonce, correlationId: `swapped-${randomUUID()}` }),
    ]);
    expect(executions.filter((result) => result.status === "fulfilled" && result.value.allowed)).toHaveLength(1);
    for (const result of executions) if (result.status === "rejected") expect((result.reason as { code?: string }).code).not.toBe("40P01");
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
    await expectAdminResultPostgresError(testDb!.db.execute(sql`
      update expert_referral_admin_execution_results set safe_result='{}'::jsonb
      where approval_id=${approval.approvalId}::uuid
    `), "55000", "expert_referral_admin_result_immutable");
  });
});
