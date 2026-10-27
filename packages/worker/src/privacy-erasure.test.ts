import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupVerificationEvidence } from "@ii-tonya/contracts";
import { requireBackupVerificationEvidence } from "@ii-tonya/contracts";
import { erasureFixture } from "./privacy-erasure.testkit.js";
import { runErasureWorkflow, verifyExpiredBackup } from "./privacy-erasure.js";
import type { ErasureDeps, ErasureJobState } from "./privacy-erasure.js";

const proofJobId = "10000000-0000-4000-8000-000000000001";
const proof: BackupVerificationEvidence = {
  evidenceVersion: 1,
  jobId: proofJobId,
  policyVersion: "backup-retention-v1",
  expiresNoLaterThan: "2026-08-27T10:00:00.000Z",
  verifiedAt: "2026-08-28T10:00:00.000Z",
  method: "inventory_attestation",
  verifierId: "test-inventory-v1",
  receiptSha256: "a".repeat(64),
};

async function backupFixture() {
  const fixture = erasureFixture({
    processors: ["object_store", "selarti", "planerka", "make_projection"],
  });
  await runErasureWorkflow(fixture, proofJobId);
  const deps: ErasureDeps = {
    ...fixture,
    now: () => new Date(proof.verifiedAt),
    backupVerifier: {
      verify: async () => ({ kind: "verified", evidence: proof }),
    },
  };
  return { deps, fixture };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("trusted backup attestation", () => {
  it("rejects a verified result after a monotonic deadline even before the timer can run", async () => {
    const { deps, fixture } = await backupFixture();
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(100);
    let signal!: AbortSignal;
    deps.backupVerifier!.verify = async (_request, abortSignal) => {
      signal = abortSignal;
      // Models a verifier blocking the event loop for 5.1s, then resolving
      // in the microtask queue before the overdue timeout callback executes.
      monotonic.mockReturnValue(5_200);
      return { kind: "verified", evidence: proof };
    };
    await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow(
      "Backup verification is unavailable",
    );
    expect(signal.aborted).toBe(true);
    expect(fixture.job().status).toBe("processor_complete");
  });

  it("requires lowercase canonical UUIDs even when proof and request casing agree", () => {
    const lowercase = "abcdef01-2345-4678-89ab-cdef01234567";
    const binding = {
      jobId: lowercase,
      policyVersion: proof.policyVersion,
      expiresNoLaterThan: proof.expiresNoLaterThan,
    };
    expect(
      requireBackupVerificationEvidence(
        { ...proof, jobId: lowercase },
        binding,
        new Date(proof.verifiedAt),
      ).jobId,
    ).toBe(lowercase);
    expect(() =>
      requireBackupVerificationEvidence(
        { ...proof, jobId: lowercase.toUpperCase() },
        { ...binding, jobId: lowercase.toUpperCase() },
        new Date(proof.verifiedAt),
      ),
    ).toThrow("Backup verification evidence is incomplete or invalid");
  });
  it("commits the exact verified binding and returns the persisted result", async () => {
    const { deps, fixture } = await backupFixture();
    const verifier = vi.spyOn(deps.backupVerifier!, "verify");
    await expect(verifyExpiredBackup(deps, proofJobId)).resolves.toEqual({
      jobId: proofJobId,
      status: "backup_verified",
    });
    expect(verifier).toHaveBeenCalledWith(
      {
        jobId: proofJobId,
        policyVersion: proof.policyVersion,
        expiresNoLaterThan: proof.expiresNoLaterThan,
      },
      expect.any(AbortSignal),
    );
    expect(fixture.job().backupVerification).toEqual(proof);
    // Valid persisted evidence is sufficient for idempotent replay without a new verifier.
    const withoutVerifier = { ...deps };
    delete withoutVerifier.backupVerifier;
    await expect(
      verifyExpiredBackup(withoutVerifier, proofJobId),
    ).resolves.toMatchObject({ status: "backup_verified" });
    await expect(runErasureWorkflow(deps, proofJobId)).resolves.toMatchObject({
      status: "backup_verified",
    });
    expect(verifier).toHaveBeenCalledTimes(1);
  });

  it.each([
    "unavailable",
    "rejected",
    "unknown",
    "throw",
    "unexpected",
    "null",
  ])("does not certify a %s verifier result", async (kind) => {
    const { deps, fixture } = await backupFixture();
    deps.backupVerifier!.verify = async () => {
      if (kind === "throw") throw new Error("secret provider response");
      return (kind === "null" ? null : { kind }) as never;
    };
    await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow(
      "Backup verification is unavailable",
    );
    expect(fixture.job().status).toBe("processor_complete");
  });

  const invalidProofs = [
    { jobId: "10000000-0000-4000-8000-000000000002" },
    { policyVersion: "backup-retention-v2" },
    { expiresNoLaterThan: "2026-08-26T10:00:00.000Z" },
    { verifiedAt: "2026-08-29T10:00:00.000Z" },
    { verifiedAt: "2026-08-26T10:00:00.000Z" },
    { verifiedAt: "2026-02-30T10:00:00.000Z" },
    { verifiedAt: "2026-08-28T10:00:00Z" },
    { verifiedAt: "Infinity" },
    { expiresNoLaterThan: "invalid" },
    { evidenceVersion: 2 },
    { receiptSha256: "A".repeat(64) },
    { receiptSha256: "a".repeat(63) },
    { receiptSha256: undefined },
    { method: "elapsed_time" },
    { verifierId: "" },
    { verifierId: "x".repeat(129) },
    { verifierId: "raw provider response" },
    { policyVersion: "x".repeat(129) },
    { unknown: "raw subject data" },
  ];
  it.each(invalidProofs)(
    "rejects malformed or unbound evidence %j",
    async (change) => {
      const { deps, fixture } = await backupFixture();
      deps.backupVerifier!.verify = async () => ({
        kind: "verified",
        evidence: { ...proof, ...change } as never,
      });
      await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow(
        "Backup verification evidence is incomplete or invalid",
      );
      expect(fixture.job().status).toBe("processor_complete");
    },
  );

  it.each([
    "pending",
    "unelapsed",
    "invalid-expiry",
    "invalid-clock",
    "policy-changed",
    "wrong-job",
    "prescheduled-verified",
  ])("does not call the verifier when %s", async (condition) => {
    const { deps, fixture } = await backupFixture();
    const job = fixture.job();
    const verifier = vi.spyOn(deps.backupVerifier!, "verify");
    deps.repository.getJob = async () => ({
      ...job,
      ...(condition === "pending" ? { status: "pending" as const } : {}),
      ...(condition === "wrong-job" ? { jobId: "another-job" } : {}),
      backupEvidence: {
        ...job.backupEvidence!,
        ...(condition === "invalid-expiry"
          ? { expiresNoLaterThan: "invalid" }
          : {}),
        ...(condition === "prescheduled-verified"
          ? { verificationState: "verified" as const }
          : {}),
      },
    });
    const callDeps = {
      ...deps,
      ...(condition === "invalid-clock" ? { now: () => new Date(NaN) } : {}),
      ...(condition === "unelapsed"
        ? { now: () => new Date("2026-08-01T00:00:00.000Z") }
        : {}),
      ...(condition === "policy-changed"
        ? { backupPolicy: { ...deps.backupPolicy, version: "v2" } }
        : {}),
    };
    await expect(verifyExpiredBackup(callDeps, proofJobId)).rejects.toThrow();
    expect(verifier).not.toHaveBeenCalled();
  });

  it.each([
    { name: "runErasureWorkflow", run: runErasureWorkflow },
    { name: "verifyExpiredBackup", run: verifyExpiredBackup },
  ])("rejects legacy terminal state via $name", async ({ run }) => {
    const { deps, fixture } = await backupFixture();
    for (const backupVerification of [
      undefined,
      { ...proof, policyVersion: "old-policy" },
      { ...proof, verifiedAt: "2099-01-01T00:00:00.000Z" },
    ]) {
      deps.repository.getJob = async () => ({
        ...fixture.job(),
        status: "backup_verified",
        backupEvidence: {
          ...fixture.job().backupEvidence!,
          verificationState: "verified",
        },
        backupVerification,
      });
      await expect(run(deps, proofJobId)).rejects.toThrow(
        "Backup verification evidence is incomplete or invalid",
      );
    }
  });

  it.each([false, undefined])(
    "disabled capability %s performs no I/O",
    async (enabled) => {
      const { deps } = await backupFixture();
      const getJob = vi.spyOn(deps.repository, "getJob");
      const verifier = vi.spyOn(deps.backupVerifier!, "verify");
      const disabled = { ...deps };
      if (enabled === undefined) delete disabled.capability;
      else disabled.capability = { enabled };
      for (const run of [runErasureWorkflow, verifyExpiredBackup]) {
        await expect(run(disabled, proofJobId)).rejects.toThrow(
          "Privacy processing is disabled",
        );
      }
      expect(getJob).not.toHaveBeenCalled();
      expect(verifier).not.toHaveBeenCalled();
    },
  );

  it("does not return optimistic success after CAS loss or missing durable proof", async () => {
    const { deps, fixture } = await backupFixture();
    deps.repository.verifyBackup = async () => fixture.job();
    await expect(verifyExpiredBackup(deps, proofJobId)).resolves.toMatchObject({
      status: "processor_complete",
    });
    deps.repository.verifyBackup = async () => {
      throw new Error("CAS lost");
    };
    await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow(
      "CAS lost",
    );
    deps.repository.verifyBackup = async () => ({
      ...fixture.job(),
      status: "backup_verified",
    });
    await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow(
      "Backup verification evidence is incomplete or invalid",
    );
    deps.repository.verifyBackup = async () =>
      undefined as unknown as ErasureJobState;
    await expect(verifyExpiredBackup(deps, proofJobId)).rejects.toThrow();
  });

  it("aborts a timed out verifier and ignores its late success", async () => {
    const { deps, fixture } = await backupFixture();
    vi.useFakeTimers();
    let finish!: (value: {
      kind: "verified";
      evidence: BackupVerificationEvidence;
    }) => void;
    let signal!: AbortSignal;
    deps.backupVerifier!.verify = async (_request, abortSignal) => {
      signal = abortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const pending = verifyExpiredBackup(deps, proofJobId).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toMatchObject({
      message: "Backup verification is unavailable",
    });
    expect(signal.aborted).toBe(true);
    finish({ kind: "verified", evidence: proof });
    await vi.runAllTimersAsync();
    expect(fixture.job().status).toBe("processor_complete");
  });
});

describe("processor-wide erasure", () => {
  it.each(["unknown", "not_erased"] as const)(
    "dead-letters uncertain processor erasure when reconciliation is %s",
    async (reconciled) => {
      const deps = erasureFixture({
        processors: ["object_store", "selarti", "planerka", "make_projection"],
      });
      deps.processors[0]!.erase = async () => ({ kind: "unknown_outcome" });
      deps.processors[0]!.reconcile = async () => reconciled;
      await expect(runErasureWorkflow(deps, proofJobId)).rejects.toThrow(
        `outcome is ${reconciled}`,
      );
      expect(deps.job().status).toBe("dead_letter");
      expect(deps.processorCalls("selarti")).toBe(0);
    },
  );

  it("persists unknown on processor exception then reconciles without repeating erasure", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
    });
    const erase = vi.fn(async () => {
      throw new Error("transport failed");
    });
    deps.processors[0]!.erase = erase;
    await expect(runErasureWorkflow(deps, proofJobId)).rejects.toThrow(
      "transport failed",
    );
    expect(await deps.repository.getAttempt(proofJobId, "object_store")).toBe(
      "unknown_outcome",
    );
    deps.processors[0]!.reconcile = async () => "erased";
    await expect(runErasureWorkflow(deps, proofJobId)).resolves.toMatchObject({
      status: "processor_complete",
    });
    expect(erase).toHaveBeenCalledTimes(1);
  });

  it("elapsed_expiry_without_verifier_never_certifies", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
    });
    const jobId = "10000000-0000-4000-8000-000000000001";
    await runErasureWorkflow(deps, jobId);
    await expect(
      verifyExpiredBackup(
        {
          ...deps,
          now: () => new Date("2026-08-28T10:00:00.000Z"),
        },
        jobId,
      ),
    ).rejects.toThrow("Backup verification is unavailable");
    expect(deps.job().status).toBe("processor_complete");
  });
  it("resumes after a crash without repeating an acknowledged processor deletion", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
      crashAfter: "selarti",
    });
    await expect(runErasureWorkflow(deps, "erase-job-1")).rejects.toThrow(
      "simulated crash",
    );
    await runErasureWorkflow(deps, "erase-job-1");
    expect(deps.processorCalls("object_store")).toBe(1);
    expect(deps.processorCalls("selarti")).toBe(1);
    expect(deps.processorCalls("planerka")).toBe(1);
    expect(deps.processorCalls("make_projection")).toBe(1);
    expect(deps.job()).toMatchObject({ status: "processor_complete" });
  });

  it("records backup expiry evidence instead of claiming immediate backup deletion", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
    });
    await runErasureWorkflow(deps, "erase-job-2");
    expect(deps.job().backupEvidence).toEqual({
      policyVersion: "backup-retention-v1",
      expiresNoLaterThan: "2026-08-27T10:00:00.000Z",
      verificationState: "scheduled",
    });
  });

  it("fails closed when the configured processor set is not exactly the required four", async () => {
    const deps = erasureFixture({ processors: ["object_store"] });
    await expect(runErasureWorkflow(deps, "erase-job-3")).rejects.toThrow(
      "Privacy processor set is incomplete",
    );
  });

  it("reconciles a recovered started attempt before any retry", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
      started: "object_store",
      reconciled: "object_store",
    });
    await runErasureWorkflow(deps, "erase-job-4");
    expect(deps.processorCalls("object_store")).toBe(0);
    expect(deps.reconcileCalls("object_store")).toBe(1);
  });

  it("does not load or dispatch a manifest while privacy processing is disabled", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
    });
    await expect(
      runErasureWorkflow(
        { ...deps, capability: { enabled: false } },
        "erase-job-5",
      ),
    ).rejects.toThrow("Privacy processing is disabled");
    expect(deps.processorCalls("object_store")).toBe(0);
  });

  it("does not read or mutate backup state while privacy processing is disabled", async () => {
    const deps = erasureFixture({
      processors: ["object_store", "selarti", "planerka", "make_projection"],
    });
    await expect(
      verifyExpiredBackup(
        { ...deps, capability: { enabled: false } },
        "erase-job-6",
      ),
    ).rejects.toThrow("Privacy processing is disabled");
  });
});
