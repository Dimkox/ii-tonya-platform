import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { BackupVerificationEvidence } from "@ii-tonya/contracts";
import {
  runErasureWorkflow,
  verifyExpiredBackup,
  type ErasureDeps,
} from "../../packages/worker/src/privacy-erasure.js";
import {
  PostgresPrivacyRepository,
  PostgresPrivacyWorkflowRepository,
} from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
let repository: PostgresPrivacyWorkflowRepository;
const processors = [
  "object_store",
  "selarti",
  "planerka",
  "make_projection",
] as const;
const receipt = {
  jobId: "original",
  contentRefsDeleted: 2,
  profileFieldsDeleted: 3,
  ledgerFactsPreserved: 4,
  auditFactsPreserved: 5,
  additional: { retained: true },
};

beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
  repository = new PostgresPrivacyWorkflowRepository(testDb.db, {
    enabled: true,
  });
}, 120_000);
afterAll(async () => testDb?.stop(), 60_000);

async function seed(status = "processor_complete") {
  const userId = await testDb.createUser();
  const jobId = randomUUID();
  const times = (
    await testDb.db.execute<{ expiry: string; verified: string }>(sql`
    select to_char(clock_timestamp() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expiry,
      to_char(clock_timestamp() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as verified
  `)
  ).rows[0]!;
  const evidence: BackupVerificationEvidence = {
    evidenceVersion: 1,
    jobId,
    policyVersion: "backup-test-v1",
    expiresNoLaterThan: times.expiry,
    verifiedAt: times.verified,
    method: "deletion_attestation",
    verifierId: "test-only-verifier",
    receiptSha256: "a".repeat(64),
  };
  await testDb.db.execute(sql`
    insert into privacy_deletion_jobs (id, user_id, idempotency_key, status, backup_policy_version, backup_expires_at, backup_verification_state, erasure_receipt)
    values (${jobId}::uuid, ${userId}::uuid, ${jobId}, ${status}, ${evidence.policyVersion}, ${evidence.expiresNoLaterThan}::timestamptz, 'scheduled', ${JSON.stringify(receipt)}::jsonb)
  `);
  for (const processor of processors) {
    await testDb.db.execute(sql`
      insert into privacy_processor_attempts (deletion_job_id, processor, status, receipt_ref, idempotency_key)
      values (${jobId}::uuid, ${processor}, 'acknowledged', 'synthetic', ${`${jobId}:${processor}`})
    `);
  }
  return { jobId, userId, evidence };
}

async function snapshot(jobId: string) {
  return (
    await testDb.db.execute<{ value: unknown }>(sql`
    select to_jsonb(j) as value from privacy_deletion_jobs j where id=${jobId}::uuid
  `)
  ).rows[0]!.value;
}

async function unchangedOnReject(
  jobId: string,
  action: () => Promise<unknown>,
) {
  const before = await snapshot(jobId);
  await expect(action()).rejects.toThrow();
  expect(await snapshot(jobId)).toEqual(before);
}

describe("database-authoritative backup attestation", () => {
  it.each([
    "verified-at",
    "expiry-microsecond",
    "processor",
    "booking",
    "extra-processor",
    "future-proof",
  ])(
    "rejects corrupted terminal %s through real-repository worker entrypoints and public replay",
    async (condition) => {
      const { jobId, userId, evidence } = await seed();
      await repository.verifyBackup(jobId, evidence);
      if (condition === "verified-at")
        await testDb.db.execute(
          sql`update privacy_deletion_jobs set backup_verified_at=backup_verified_at + interval '1 second' where id=${jobId}::uuid`,
        );
      if (condition === "expiry-microsecond")
        await testDb.db.execute(
          sql`update privacy_deletion_jobs set backup_expires_at=backup_expires_at + interval '1 microsecond' where id=${jobId}::uuid`,
        );
      if (condition === "processor")
        await testDb.db.execute(
          sql`update privacy_processor_attempts set status='unknown_outcome' where deletion_job_id=${jobId}::uuid and processor='selarti'`,
        );
      if (condition === "booking")
        await testDb.db.execute(
          sql`insert into client_booking_erasure_work (deletion_job_id, phase) values (${jobId}::uuid, 'cancel_active')`,
        );
      if (condition === "extra-processor")
        await testDb.db.execute(
          sql`insert into privacy_processor_attempts (deletion_job_id, processor, status, idempotency_key) values (${jobId}::uuid, 'extra', 'acknowledged', ${`${jobId}:extra`})`,
        );
      if (condition === "future-proof")
        await testDb.db.execute(sql`
        update privacy_deletion_jobs set backup_verified_at='2099-01-01T00:00:00Z',
          erasure_receipt=jsonb_set(erasure_receipt, '{backupVerification,verifiedAt}', '"2099-01-01T00:00:00.000Z"'::jsonb)
        where id=${jobId}::uuid
      `);
      const deps = terminalWorkerDeps(evidence.policyVersion);
      for (const run of [runErasureWorkflow, verifyExpiredBackup]) {
        await unchangedOnReject(jobId, () => run(deps, jobId));
      }
      await unchangedOnReject(jobId, () =>
        publicErasureRepository(evidence.policyVersion).startErasureAtomically({
          targetUserId: userId,
          correlationId: jobId,
          idempotencyKey: jobId,
          pseudonym: "synthetic",
        }),
      );
    },
  );

  it("both real-repository worker entrypoints replay valid terminal proof", async () => {
    const { jobId, evidence } = await seed();
    await repository.verifyBackup(jobId, evidence);
    for (const run of [runErasureWorkflow, verifyExpiredBackup]) {
      await expect(
        run(terminalWorkerDeps(evidence.policyVersion), jobId),
      ).resolves.toEqual({ jobId, status: "backup_verified" });
    }
  });

  it.each([undefined, "backup-test-v2"])(
    "public terminal replay denies configured policy %s, while nonterminal replay remains available",
    async (activePolicy) => {
      const { jobId, userId, evidence } = await seed();
      const publicRepository = publicErasureRepository(activePolicy);
      const command = {
        targetUserId: userId,
        correlationId: jobId,
        idempotencyKey: jobId,
        pseudonym: "synthetic",
      };
      await expect(
        publicRepository.startErasureAtomically(command),
      ).resolves.toMatchObject({ status: "processor_complete" });
      await repository.verifyBackup(jobId, evidence);
      await unchangedOnReject(jobId, () =>
        publicRepository.startErasureAtomically(command),
      );
    },
  );

  it.each(["pending", "processor_complete"])(
    "does not complete %s while processor or booking work is concurrently downgraded",
    async (status) => {
      for (const child of ["processor", "booking"] as const) {
        const { jobId, evidence } = await seed(status);
        if (child === "booking")
          await testDb.db.execute(
            sql`insert into client_booking_erasure_work (deletion_job_id, phase) values (${jobId}::uuid, 'complete')`,
          );
        const before = await snapshot(jobId);
        const locker = await testDb.db.$client.connect();
        let pending: Promise<unknown> | undefined;
        try {
          await locker.query("begin");
          const pid = (
            await locker.query<{ pid: number }>(
              "select pg_backend_pid() as pid",
            )
          ).rows[0]!.pid;
          if (child === "processor")
            await locker.query(
              "update privacy_processor_attempts set status='unknown_outcome' where deletion_job_id=$1 and processor='selarti'",
              [jobId],
            );
          else
            await locker.query(
              "update client_booking_erasure_work set phase='cleanup_public' where deletion_job_id=$1",
              [jobId],
            );
          let settled = false;
          const operation =
            status === "pending"
              ? repository.completeProcessors(jobId, {
                  policyVersion: evidence.policyVersion,
                  expiresNoLaterThan: evidence.expiresNoLaterThan,
                  verificationState: "scheduled",
                })
              : repository.verifyBackup(jobId, evidence);
          pending = operation.then(
            (value) => {
              settled = true;
              return value;
            },
            (error: unknown) => {
              settled = true;
              return error;
            },
          );
          await waitForRowLock(
            pid,
            child === "processor"
              ? "privacy_processor_attempts"
              : "client_booking_erasure_work",
          );
          expect(settled).toBe(false);
          await locker.query("commit");
          expect(await pending).toBeInstanceOf(Error);
          expect(await snapshot(jobId)).toEqual(before);
        } finally {
          await locker.query("rollback");
          locker.release();
          await pending;
        }
      }
    },
  );

  it("deadLetter takes the parent lock before any processor row lock", async () => {
    const { jobId } = await seed("pending");
    await testDb.db.execute(
      sql`update privacy_processor_attempts set status='unknown_outcome' where deletion_job_id=${jobId}::uuid and processor='selarti'`,
    );
    const locker = await testDb.db.$client.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await locker.query("begin");
      await locker.query(
        "select id from privacy_deletion_jobs where id=$1 for update",
        [jobId],
      );
      const pid = (
        await locker.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]!.pid;
      pending = repository
        .deadLetter(jobId, "selarti", "reconcile_unknown")
        .catch((error: unknown) => error);
      await waitForRowLock(pid, "privacy_deletion_jobs");
      // A NOWAIT child lock succeeds only if deadLetter has not taken child first.
      await testDb.db.execute(
        sql`select id from privacy_processor_attempts where deletion_job_id=${jobId}::uuid and processor='selarti' for update nowait`,
      );
      await locker.query("commit");
      expect(await pending).toBeUndefined();
      expect(await repository.getJob(jobId)).toMatchObject({
        status: "dead_letter",
      });
      expect(await repository.getAttempt(jobId, "selarti")).toBe("dead_letter");
      expect(await repository.getAttempt(jobId, "object_store")).toBe(
        "acknowledged",
      );
    } finally {
      await locker.query("rollback");
      locker.release();
      await pending;
    }
  });

  it.each(["processor_complete", "backup_verified"])(
    "rejects stale deadLetter for %s without downgrading job or children",
    async (status) => {
      const { jobId, evidence } = await seed();
      if (status === "backup_verified")
        await repository.verifyBackup(jobId, evidence);
      await unchangedOnReject(jobId, () =>
        repository.deadLetter(jobId, "selarti", "late-failure"),
      );
      expect(await repository.getAttempt(jobId, "selarti")).toBe(
        "acknowledged",
      );
    },
  );
  it("cannot certify with a date alone, including a caller-selected future clock", async () => {
    const { jobId } = await seed();
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(
        jobId,
        new Date("2099-01-01T00:00:00.000Z") as never,
      ),
    );
  });

  it.each([
    { jobId: "10000000-0000-4000-8000-000000000002" },
    { policyVersion: "different-policy" },
    { expiresNoLaterThan: "2020-01-01T00:00:00.000Z" },
    { verifiedAt: "2099-01-01T00:00:00.000Z" },
    { verifiedAt: "2020-01-01T00:00:00.000Z" },
    { verifiedAt: "not-a-date" },
    { expiresNoLaterThan: "infinity" },
    { receiptSha256: "NOT-A-HASH" },
    { verifierId: "" },
    { method: "timer" },
    { evidenceVersion: 2 },
    { unknown: "raw data" },
  ])("rejects evidence %j without changing the job", async (change) => {
    const { jobId, evidence } = await seed();
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(jobId, { ...evidence, ...change } as never),
    );
  });

  it("requires DB expiry even when a caller supplies matching future schedule and proof", async () => {
    const { jobId, evidence } = await seed();
    await testDb.db.execute(
      sql`update privacy_deletion_jobs set backup_expires_at='2099-01-01T00:00:00Z' where id=${jobId}::uuid`,
    );
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(jobId, {
        ...evidence,
        expiresNoLaterThan: "2099-01-01T00:00:00.000Z",
        verifiedAt: "2099-01-02T00:00:00.000Z",
      }),
    );
  });

  it("persists proof atomically, preserves all other receipt fields, and replays identical evidence", async () => {
    const { jobId, evidence } = await seed();
    const result = await repository.verifyBackup(jobId, evidence);
    expect(result).toMatchObject({
      jobId,
      status: "backup_verified",
      backupVerification: evidence,
      backupEvidence: { verificationState: "verified" },
    });
    expect(await repository.getJob(jobId)).toEqual(result);
    expect(await snapshot(jobId)).toMatchObject({
      erasure_receipt: { ...receipt, backupVerification: evidence },
    });
    const before = await snapshot(jobId);
    await expect(
      repository.verifyBackup(jobId, { ...evidence }),
    ).resolves.toEqual(result);
    expect(await snapshot(jobId)).toEqual(before);
  });

  it("serializes conflicting verifiers without replacing the winning receipt", async () => {
    const { jobId, evidence } = await seed();
    const other = { ...evidence, receiptSha256: "b".repeat(64) };
    const outcomes = await Promise.allSettled([
      repository.verifyBackup(jobId, evidence),
      repository.verifyBackup(jobId, other),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const winner = outcomes[0]!.status === "fulfilled" ? evidence : other;
    expect(await repository.getJob(jobId)).toMatchObject({
      backupVerification: winner,
    });
    await expect(repository.verifyBackup(jobId, winner)).resolves.toMatchObject(
      { status: "backup_verified" },
    );
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(jobId, {
        ...winner,
        verifierId: "another-verifier",
      }),
    );
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(jobId, {
        ...winner,
        method: "inventory_attestation",
      }),
    );
  });

  it("concurrent matching proofs are idempotent", async () => {
    const { jobId, evidence } = await seed();
    const results = await Promise.all([
      repository.verifyBackup(jobId, evidence),
      repository.verifyBackup(jobId, evidence),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      status: "backup_verified",
      backupVerification: evidence,
    });
  });

  it("does not truncate a changed expiry into a matching proof", async () => {
    const { jobId, evidence } = await seed();
    await testDb.db.execute(
      sql`update privacy_deletion_jobs set backup_expires_at=backup_expires_at + interval '1 microsecond' where id=${jobId}::uuid`,
    );
    await unchangedOnReject(jobId, () =>
      repository.verifyBackup(jobId, evidence),
    );
  });

  it.each(["missing", "unknown-four", "extra", "unacknowledged"])(
    "requires the exact acknowledged processor set: %s",
    async (condition) => {
      const { jobId, evidence } = await seed();
      if (condition === "missing")
        await testDb.db.execute(
          sql`delete from privacy_processor_attempts where deletion_job_id=${jobId}::uuid and processor='selarti'`,
        );
      if (condition === "unknown-four")
        await testDb.db.execute(
          sql`update privacy_processor_attempts set processor='unknown-' || processor where deletion_job_id=${jobId}::uuid`,
        );
      if (condition === "unacknowledged")
        await testDb.db.execute(
          sql`update privacy_processor_attempts set status='unknown_outcome' where deletion_job_id=${jobId}::uuid and processor='selarti'`,
        );
      if (condition === "extra")
        await testDb.db.execute(
          sql`insert into privacy_processor_attempts (deletion_job_id, processor, status, idempotency_key) values (${jobId}::uuid, 'extra', 'pending', ${`${jobId}:extra`})`,
        );
      await unchangedOnReject(jobId, () =>
        repository.verifyBackup(jobId, evidence),
      );
      await testDb.db.execute(
        sql`update privacy_deletion_jobs set status='pending' where id=${jobId}::uuid`,
      );
      await unchangedOnReject(jobId, () =>
        repository.completeProcessors(jobId, {
          policyVersion: evidence.policyVersion,
          expiresNoLaterThan: evidence.expiresNoLaterThan,
          verificationState: "scheduled",
        }),
      );
    },
  );

  it.each(["pending", "dead_letter", "unscheduled"])(
    "does not verify state %s",
    async (status) => {
      const { jobId, evidence } = await seed(
        status === "unscheduled" ? "processor_complete" : status,
      );
      if (status === "unscheduled")
        await testDb.db.execute(
          sql`update privacy_deletion_jobs set backup_verification_state=null where id=${jobId}::uuid`,
        );
      await unchangedOnReject(jobId, () =>
        repository.verifyBackup(jobId, evidence),
      );
    },
  );

  it.each([null, [], "bad-receipt", 1])(
    "preserves malformed receipt %j and fails closed",
    async (value) => {
      const { jobId, evidence } = await seed();
      await testDb.db.execute(
        sql`update privacy_deletion_jobs set erasure_receipt=${JSON.stringify(value)}::jsonb where id=${jobId}::uuid`,
      );
      await unchangedOnReject(jobId, () =>
        repository.verifyBackup(jobId, evidence),
      );
    },
  );

  it.each(["cancel_active", "cleanup_public", "dead_letter"])(
    "keeps the booking erasure fence for %s",
    async (phase) => {
      const { jobId, evidence } = await seed();
      await testDb.db.execute(
        sql`insert into client_booking_erasure_work (deletion_job_id, phase) values (${jobId}::uuid, ${phase})`,
      );
      await unchangedOnReject(jobId, () =>
        repository.verifyBackup(jobId, evidence),
      );
      await testDb.db.execute(
        sql`update privacy_deletion_jobs set status='pending' where id=${jobId}::uuid`,
      );
      await unchangedOnReject(jobId, () =>
        repository.completeProcessors(jobId, {
          policyVersion: evidence.policyVersion,
          expiresNoLaterThan: evidence.expiresNoLaterThan,
          verificationState: "scheduled",
        }),
      );
    },
  );

  it.each([
    { verificationState: "verified" },
    { expiresNoLaterThan: "infinity" },
    { expiresNoLaterThan: "invalid" },
    { policyVersion: "" },
    { policyVersion: " " },
    { policyVersion: "a".repeat(129) },
    { unknown: true },
  ])("does not schedule invalid or preverified evidence %j", async (change) => {
    const { jobId, evidence } = await seed("pending");
    await unchangedOnReject(jobId, () =>
      repository.completeProcessors(jobId, {
        policyVersion: evidence.policyVersion,
        expiresNoLaterThan: evidence.expiresNoLaterThan,
        verificationState: "scheduled",
        ...change,
      } as never),
    );
  });

  it("schedules only after processor and booking completion", async () => {
    const { jobId, evidence } = await seed("pending");
    await testDb.db.execute(
      sql`insert into client_booking_erasure_work (deletion_job_id, phase) values (${jobId}::uuid, 'complete')`,
    );
    await repository.completeProcessors(jobId, {
      policyVersion: evidence.policyVersion,
      expiresNoLaterThan: evidence.expiresNoLaterThan,
      verificationState: "scheduled",
    });
    expect(await repository.getJob(jobId)).toMatchObject({
      status: "processor_complete",
      backupEvidence: { verificationState: "scheduled" },
    });
    await expect(
      repository.verifyBackup(jobId, evidence),
    ).resolves.toMatchObject({ status: "backup_verified" });
  });

  it.each([
    "missing",
    "wrong-policy",
    "wrong-expiry",
    "future",
    "wrong-verified-at",
  ])(
    "rejects legacy terminal proof %s through direct and public replay paths",
    async (condition) => {
      const { jobId, userId, evidence } = await seed();
      const storedEvidence =
        condition === "missing"
          ? undefined
          : {
              ...evidence,
              ...(condition === "wrong-policy"
                ? { policyVersion: "old-v1" }
                : {}),
              ...(condition === "wrong-expiry"
                ? { expiresNoLaterThan: "2020-01-01T00:00:00.000Z" }
                : {}),
              ...(condition === "future"
                ? { verifiedAt: "2099-01-01T00:00:00.000Z" }
                : {}),
            };
      await testDb.db.execute(sql`
      update privacy_deletion_jobs set status='backup_verified', backup_verification_state='verified',
        backup_verified_at=${condition === "wrong-verified-at" ? "2020-01-01T00:00:00.000Z" : evidence.verifiedAt}::timestamptz,
        erasure_receipt=${JSON.stringify({ ...receipt, backupVerification: storedEvidence })}::jsonb
      where id=${jobId}::uuid
    `);
      await unchangedOnReject(jobId, () =>
        repository.verifyBackup(jobId, evidence),
      );
      const publicRepository = publicErasureRepository("backup-test-v1");
      const before = await snapshot(jobId);
      await expect(
        publicRepository.startErasureAtomically({
          targetUserId: userId,
          correlationId: jobId,
          idempotencyKey: jobId,
          pseudonym: "synthetic",
        }),
      ).rejects.toThrow(
        "Backup verification evidence is incomplete or invalid",
      );
      expect(await snapshot(jobId)).toEqual(before);
    },
  );

  it("public replay can report verified only with bound persisted proof", async () => {
    const { jobId, userId, evidence } = await seed();
    await repository.verifyBackup(jobId, evidence);
    await expect(
      publicErasureRepository("backup-test-v1").startErasureAtomically({
        targetUserId: userId,
        correlationId: jobId,
        idempotencyKey: jobId,
        pseudonym: "synthetic",
      }),
    ).resolves.toMatchObject({
      status: "backup_verified",
      contentRefsDeleted: 2,
      ledgerFactsPreserved: 4,
    });
  });

  it("default-off repository never performs the mutation", async () => {
    const { jobId, evidence } = await seed();
    await unchangedOnReject(jobId, () =>
      new PostgresPrivacyWorkflowRepository(testDb.db).verifyBackup(
        jobId,
        evidence,
      ),
    );
    await unchangedOnReject(jobId, () =>
      new PostgresPrivacyWorkflowRepository(testDb.db).completeProcessors(
        jobId,
        {
          policyVersion: evidence.policyVersion,
          expiresNoLaterThan: evidence.expiresNoLaterThan,
          verificationState: "scheduled",
        },
      ),
    );
  });
});

function publicErasureRepository(activeBackupPolicyVersion?: string) {
  return new PostgresPrivacyRepository(testDb.db, {
    privacyMutationCapability: {
      enabled: true,
      ...(activeBackupPolicyVersion === undefined
        ? {}
        : { activeBackupPolicyVersion }),
      captureManifests: async () =>
        processors.map((processor) => ({
          processor,
          ciphertext: "synthetic-envelope",
          keyReference: "test-key",
          algorithm: "test",
          version: "1",
          subjectDeletionKeyHash: "synthetic-hash",
        })),
      verifyEnvelope: () => true,
    },
  });
}

function terminalWorkerDeps(policyVersion: string): ErasureDeps {
  return {
    repository,
    processors: [],
    backupPolicy: {
      version: policyVersion,
      expiresNoLaterThan: () => {
        throw new Error("terminal path must not schedule");
      },
    },
    now: () => new Date(),
    hashReceipt: () => {
      throw new Error("terminal path must not hash");
    },
    manifestCipher: {
      verifyEnvelope: async () => {
        throw new Error("terminal path must not load manifests");
      },
      decrypt: async () => {
        throw new Error("terminal path must not decrypt");
      },
    },
    capability: { enabled: true },
  };
}

async function waitForRowLock(
  blockerPid: number,
  relation: string,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const waiting = await testDb.db.execute<{ query: string }>(sql`
      select query from pg_stat_activity
      where datname=current_database() and ${blockerPid}::integer=any(pg_blocking_pids(pid))
    `);
    if (waiting.rows.some((row) => row.query.includes(relation))) return;
  }
  throw new Error(`Expected a measured row-lock wait on ${relation}`);
}
