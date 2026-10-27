import { beforeAll, afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";
import {
  PostgresErasureRequestRepository,
  createErasureRequestExecution,
} from "../../packages/db/src/repositories/erasure-request-repository.js";
import {
  PostgresPrivacyRepository,
  PostgresPrivacyWorkflowRepository,
} from "../../packages/db/src/repositories/privacy-repository.js";
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  expect((await db.db.execute(sql`show server_version_num`)).rows[0]).toEqual({
    server_version_num: "170005",
  });
  await db.migrate();
}, 180000);
afterAll(async () => db?.stop());
const repo = () => new PostgresErasureRequestRepository(db.db);
it("binds actual erasure atomically and preserves pending status when capture is unavailable", async () => {
  const userId = await db.createUser();
  const accepted = await repo().accept({
    userId,
    receiptDigest: "e".repeat(64),
  });
  if (accepted.kind !== "accepted") throw new Error("fixture");
  const command = {
    requestId: accepted.request.id,
    targetUserId: userId,
    correlationId: "erasure-request-test",
    idempotencyKey: `erasure-request:${accepted.request.id}`,
    pseudonym: "hmac:synthetic",
  };
  await expect(
    new PostgresPrivacyRepository(db.db, {
      privacyMutationCapability: { enabled: true },
    }).startErasureAtomically(command),
  ).rejects.toThrow();
  expect((await repo().findOwned(userId))?.jobId).toBeNull();
  const privacy = new PostgresPrivacyRepository(db.db, {
    privacyMutationCapability: {
      enabled: true,
      captureManifests: async () =>
        (
          ["object_store", "selarti", "planerka", "make_projection"] as const
        ).map((processor) => ({
          processor,
          ciphertext: "synthetic",
          keyReference: "synthetic-key",
          algorithm: "synthetic",
          version: "1",
          subjectDeletionKeyHash: "synthetic",
        })),
      verifyEnvelope: () => true,
    },
  });
  const job = await createErasureRequestExecution(
    privacy,
    () => "hmac:synthetic",
  ).begin({ id: accepted.request.id, userId });
  expect((await repo().findOwned(userId))?.jobId).toBe(job.jobId);
  expect((await repo().findByReceiptDigest("e".repeat(64)))?.jobId).toBe(
    job.jobId,
  );
  expect(await repo().getVerifiedJob(job.jobId)).toEqual({
    status: "pending",
    retainedFacts: { ledgerFactsPreserved: 0, auditFactsPreserved: 0 },
  });
  expect((await privacy.startErasureAtomically(command)).jobId).toBe(job.jobId);
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int as n from privacy_deletion_jobs where user_id=${userId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ n: 1 });
  await expect(
    privacy.startErasureAtomically({
      ...command,
      targetUserId: await db.createUser(),
    }),
  ).rejects.toThrow();
  const workflow = new PostgresPrivacyWorkflowRepository(db.db, {
    enabled: true,
  });
  const times = (
    await db.db.execute<{ expiry: string; verified: string }>(
      sql`select to_char(now()-interval '2 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expiry,to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as verified`,
    )
  ).rows[0]!;
  await db.db.execute(
    sql`update client_booking_erasure_work set phase='complete' where deletion_job_id=${job.jobId}::uuid`,
  );
  await db.db.execute(
    sql`update privacy_processor_attempts set status='acknowledged',receipt_ref='synthetic' where deletion_job_id=${job.jobId}::uuid`,
  );
  await workflow.completeProcessors(job.jobId, {
    policyVersion: "synthetic-policy",
    expiresNoLaterThan: times.expiry,
    verificationState: "scheduled",
  });
  expect((await repo().getVerifiedJob(job.jobId)).status).toBe(
    "processor_complete",
  );
  await workflow.verifyBackup(job.jobId, {
    evidenceVersion: 1,
    jobId: job.jobId,
    policyVersion: "synthetic-policy",
    expiresNoLaterThan: times.expiry,
    verifiedAt: times.verified,
    method: "deletion_attestation",
    verifierId: "synthetic-verifier",
    receiptSha256: "f".repeat(64),
  });
  expect(
    (
      await new PostgresErasureRequestRepository(
        db.db,
        "synthetic-policy",
      ).getVerifiedJob(job.jobId)
    ).status,
  ).toBe("backup_verified");
  await expect(repo().getVerifiedJob(job.jobId)).rejects.toThrow();
});
it("serializes concurrent retries, rejects replacement and cross-owner digest reuse", async () => {
  const userId = await db.createUser();
  const input = { userId, receiptDigest: "a".repeat(64) };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => repo().accept(input)),
  );
  expect(results.every((r) => r.kind === "accepted")).toBe(true);
  expect(
    new Set(
      results.map((r) => (r.kind === "accepted" ? r.request.id : "error")),
    ).size,
  ).toBe(1);
  expect(
    await repo().accept({ userId, receiptDigest: "b".repeat(64) }),
  ).toEqual({ kind: "conflict" });
  expect(
    await repo().accept({
      userId: await db.createUser(),
      receiptDigest: input.receiptDigest,
    }),
  ).toEqual({ kind: "conflict" });
  expect(
    (
      await db.db.execute(
        sql`select count(*)::int as n from client_erasure_requests where user_id=${userId}::uuid`,
      )
    ).rows[0],
  ).toEqual({ n: 1 });
});
it("retains receipt access after deactivation but denies new requests and revoked credentials", async () => {
  const userId = await db.createUser();
  const receiptDigest = "c".repeat(64);
  expect((await repo().accept({ userId, receiptDigest })).kind).toBe(
    "accepted",
  );
  await db.db.execute(
    sql`update users set active=false where id=${userId}::uuid`,
  );
  expect(await repo().findByReceiptDigest(receiptDigest)).not.toBeNull();
  expect(await repo().accept({ userId, receiptDigest })).toEqual({
    kind: "denied",
  });
  await db.db.execute(
    sql`update client_erasure_requests set receipt_revoked_at=now() where user_id=${userId}::uuid`,
  );
  expect(await repo().findByReceiptDigest(receiptDigest)).toBeNull();
});
it("database rejects foreign job binding and forged completion never becomes a receipt", async () => {
  const userId = await db.createUser();
  const other = await db.createUser();
  await repo().accept({ userId, receiptDigest: "d".repeat(64) });
  const foreign = randomUUID();
  await db.db.execute(
    sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values (${foreign}::uuid,${other}::uuid,'foreign','pending')`,
  );
  await expect(
    db.db.execute(
      sql`update client_erasure_requests set job_id=${foreign}::uuid where user_id=${userId}::uuid`,
    ),
  ).rejects.toThrow();
  await expect(repo().getVerifiedJob(foreign)).rejects.toThrow();
  const own = randomUUID();
  await db.db.execute(
    sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values (${own}::uuid,${userId}::uuid,'own','backup_verified')`,
  );
  await db.db.execute(
    sql`update client_erasure_requests set job_id=${own}::uuid where user_id=${userId}::uuid`,
  );
  await expect(repo().getVerifiedJob(own)).rejects.toThrow();
});
