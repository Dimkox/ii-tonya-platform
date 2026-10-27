import {
  backupScheduleSchema,
  backupVerificationBindingSchema,
  requireBackupVerificationEvidence,
  type BackupVerificationBinding,
  type BackupVerificationEvidence,
  type BackupSchedule,
} from "@ii-tonya/contracts";

export type PrivacyProcessorName =
  "object_store" | "selarti" | "planerka" | "make_projection";

export interface ProcessorErasureCommand {
  readonly jobId: string;
  readonly processor: PrivacyProcessorName;
  readonly idempotencyKey: string;
  readonly opaqueTarget: string;
}

export type ProcessorReconcileCommand = ProcessorErasureCommand;

export type ProcessorErasureOutcome =
  | { readonly kind: "erased"; readonly receipt: string }
  | { readonly kind: "unknown_outcome" };

export interface PrivacyProcessor {
  readonly name: PrivacyProcessorName;
  erase(command: ProcessorErasureCommand): Promise<ProcessorErasureOutcome>;
  reconcile(
    command: ProcessorReconcileCommand,
  ): Promise<"erased" | "not_erased" | "unknown">;
}
export interface DeletionManifestCipher {
  verifyEnvelope(envelope: {
    ciphertext: string;
    keyReference: string;
    algorithm: string;
    version: string;
  }): Promise<boolean>;
  decrypt(envelope: {
    ciphertext: string;
    keyReference: string;
    algorithm: string;
    version: string;
  }): Promise<string>;
}

export type ProcessorAttemptState =
  "pending" | "started" | "unknown_outcome" | "acknowledged" | "dead_letter";

export interface ErasureJobState {
  readonly jobId: string;
  readonly status:
    "pending" | "processor_complete" | "backup_verified" | "dead_letter";
  readonly backupVerification?: unknown;
  readonly backupEvidence?: {
    readonly policyVersion: string;
    readonly expiresNoLaterThan: string;
    readonly verificationState: "scheduled" | "verified";
  };
}

export interface ErasureRepository {
  getJob(jobId: string): Promise<ErasureJobState>;
  getAttempt(
    jobId: string,
    processor: PrivacyProcessorName,
  ): Promise<ProcessorAttemptState>;
  loadManifest(
    jobId: string,
    processor: PrivacyProcessorName,
  ): Promise<{
    ciphertext: string;
    keyReference: string;
    algorithm: string;
    version: string;
  }>;
  markStarted(
    jobId: string,
    processor: PrivacyProcessorName,
    idempotencyKey: string,
  ): Promise<void>;
  markUnknown(jobId: string, processor: PrivacyProcessorName): Promise<void>;
  acknowledge(
    jobId: string,
    processor: PrivacyProcessorName,
    receiptHash: string,
  ): Promise<void>;
  deadLetter(
    jobId: string,
    processor: PrivacyProcessorName,
    reason: string,
  ): Promise<void>;
  completeProcessors(jobId: string, evidence: BackupSchedule): Promise<void>;
  verifyBackup(
    jobId: string,
    evidence: BackupVerificationEvidence,
  ): Promise<ErasureJobState>;
}

export type BackupVerificationResult =
  | { readonly kind: "verified"; readonly evidence: BackupVerificationEvidence }
  | { readonly kind: "unavailable" | "rejected" | "unknown" };

/** Trusted server-only port. No default adapter; client receipts are not proof. */
export interface BackupErasureVerifier {
  verify(
    request: BackupVerificationBinding,
    signal: AbortSignal,
  ): Promise<BackupVerificationResult>;
}

export interface ErasureDeps {
  readonly repository: ErasureRepository;
  readonly processors: readonly PrivacyProcessor[];
  readonly backupPolicy: {
    readonly version: string;
    expiresNoLaterThan(now: Date): Date;
  };
  readonly now: () => Date;
  readonly hashReceipt: (receipt: string) => string;
  readonly manifestCipher: DeletionManifestCipher;
  readonly capability?: { enabled: boolean };
  readonly backupVerifier?: BackupErasureVerifier;
}

export interface ErasureWorkflowResult {
  readonly jobId: string;
  readonly status: ErasureJobState["status"];
}

const orderedProcessors: readonly PrivacyProcessorName[] = [
  "object_store",
  "selarti",
  "planerka",
  "make_projection",
];

function processorMap(
  processors: readonly PrivacyProcessor[],
): Map<PrivacyProcessorName, PrivacyProcessor> {
  const byName = new Map(
    processors.map((processor) => [processor.name, processor]),
  );
  if (byName.size !== processors.length)
    throw new Error("Duplicate privacy processor");
  if (
    byName.size !== orderedProcessors.length ||
    orderedProcessors.some((name) => !byName.has(name))
  ) {
    throw new Error(
      "Privacy processor set is incomplete or contains an unsupported processor",
    );
  }
  return byName;
}
function validManifestEnvelope(envelope: {
  ciphertext: string;
  keyReference: string;
  algorithm: string;
  version: string;
}): boolean {
  return (
    envelope.ciphertext.trim().length > 0 &&
    envelope.keyReference.trim().length > 0 &&
    envelope.keyReference !== "unbound-placeholder" &&
    envelope.algorithm.trim().length > 0 &&
    envelope.version.trim().length > 0
  );
}

function jobBinding(
  deps: ErasureDeps,
  job: ErasureJobState,
  jobId: string,
): BackupVerificationBinding {
  const binding = backupVerificationBindingSchema.safeParse({
    jobId: job.jobId,
    policyVersion: job.backupEvidence?.policyVersion,
    expiresNoLaterThan: job.backupEvidence?.expiresNoLaterThan,
  });
  if (
    !binding.success ||
    job.jobId !== jobId ||
    binding.data.policyVersion !== deps.backupPolicy.version
  ) {
    throw new Error("Backup verification evidence is incomplete or invalid");
  }
  return binding.data;
}

function durableResult(
  deps: ErasureDeps,
  job: ErasureJobState,
  jobId: string,
): ErasureWorkflowResult {
  if (!job || job.jobId !== jobId)
    throw new Error("Backup verification evidence is incomplete or invalid");
  if (job.status === "backup_verified") {
    if (job.backupEvidence?.verificationState !== "verified") {
      throw new Error("Backup verification evidence is incomplete or invalid");
    }
    requireBackupVerificationEvidence(
      job.backupVerification,
      jobBinding(deps, job, jobId),
      deps.now(),
    );
  }
  return { jobId: job.jobId, status: job.status };
}

async function verifyWithTimeout(
  verifier: BackupErasureVerifier,
  binding: BackupVerificationBinding,
): Promise<BackupVerificationResult> {
  const controller = new AbortController();
  const deadline = performance.now() + 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => verifier.verify(binding, controller.signal)),
      new Promise<BackupVerificationResult>((resolve) => {
        timer = setTimeout(() => {
          // Settle the timeout first even if an abort handler resolves the adapter.
          resolve({ kind: "unavailable" });
          controller.abort();
        }, 5_000);
      }),
    ]);
    // A blocking adapter can resolve in the microtask queue before an overdue
    // timer runs. Wall-clock changes must not extend the verification budget.
    if (performance.now() >= deadline) {
      controller.abort();
      return { kind: "unavailable" };
    }
    return result;
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runErasureWorkflow(
  deps: ErasureDeps,
  jobId: string,
): Promise<ErasureWorkflowResult> {
  if (!deps.capability?.enabled)
    throw new Error("Privacy processing is disabled");
  const job = await deps.repository.getJob(jobId);
  if (job.status === "dead_letter")
    throw new Error("Erasure job is dead-lettered");
  if (job.status === "processor_complete" || job.status === "backup_verified")
    return durableResult(deps, job, jobId);
  const processors = processorMap(deps.processors);
  for (const name of orderedProcessors) {
    const processor = processors.get(name);
    if (processor === undefined) continue;
    const idempotencyKey = `${jobId}:${name}`;
    const state = await deps.repository.getAttempt(jobId, name);
    if (state === "acknowledged") continue;
    const manifest = await deps.repository.loadManifest(jobId, name);
    if (
      !validManifestEnvelope(manifest) ||
      !(await deps.manifestCipher.verifyEnvelope(manifest))
    ) {
      throw new Error("Privacy deletion manifest envelope is invalid");
    }
    const opaqueTarget = await deps.manifestCipher.decrypt(manifest);
    if (state === "unknown_outcome" || state === "started") {
      const reconciled = await processor.reconcile({
        jobId,
        processor: name,
        idempotencyKey,
        opaqueTarget,
      });
      if (reconciled === "erased") {
        await deps.repository.acknowledge(
          jobId,
          name,
          deps.hashReceipt(`reconciled:${idempotencyKey}`),
        );
        continue;
      }
      if (reconciled === "unknown") {
        await deps.repository.deadLetter(jobId, name, "reconcile_unknown");
        throw new Error(`Erasure processor ${name} reconciliation is unknown`);
      }
    }
    // The durable started state is written before any provider call.
    await deps.repository.markStarted(jobId, name, idempotencyKey);
    let outcome: ProcessorErasureOutcome;
    try {
      outcome = await processor.erase({
        jobId,
        processor: name,
        idempotencyKey,
        opaqueTarget,
      });
    } catch (error) {
      await deps.repository.markUnknown(jobId, name);
      throw error;
    }
    if (outcome.kind === "unknown_outcome") {
      await deps.repository.markUnknown(jobId, name);
      const reconciled = await processor.reconcile({
        jobId,
        processor: name,
        idempotencyKey,
        opaqueTarget,
      });
      if (reconciled !== "erased") {
        await deps.repository.deadLetter(
          jobId,
          name,
          `reconcile_${reconciled}`,
        );
        throw new Error(`Erasure processor ${name} outcome is ${reconciled}`);
      }
      await deps.repository.acknowledge(
        jobId,
        name,
        deps.hashReceipt(`reconciled:${idempotencyKey}`),
      );
      continue;
    }
    await deps.repository.acknowledge(
      jobId,
      name,
      deps.hashReceipt(outcome.receipt),
    );
  }
  const expiry = deps.backupPolicy.expiresNoLaterThan(deps.now());
  const schedule = backupScheduleSchema.safeParse({
    policyVersion: deps.backupPolicy.version,
    expiresNoLaterThan: Number.isFinite(expiry.getTime())
      ? expiry.toISOString()
      : undefined,
    verificationState: "scheduled",
  });
  if (!schedule.success) throw new Error("Backup schedule is invalid");
  await deps.repository.completeProcessors(jobId, schedule.data);
  return { jobId, status: "processor_complete" };
}

export async function verifyExpiredBackup(
  deps: ErasureDeps,
  jobId: string,
): Promise<ErasureWorkflowResult> {
  if (!deps.capability?.enabled)
    throw new Error("Privacy processing is disabled");
  const job = await deps.repository.getJob(jobId);
  if (job.status === "backup_verified") return durableResult(deps, job, jobId);
  if (
    job.status !== "processor_complete" ||
    job.backupEvidence?.verificationState !== "scheduled"
  ) {
    throw new Error("Backup verification is not scheduled");
  }
  const binding = jobBinding(deps, job, jobId);
  const now = deps.now().getTime();
  if (!Number.isFinite(now) || Date.parse(binding.expiresNoLaterThan) > now) {
    throw new Error("Backup expiry has not elapsed");
  }
  if (!deps.backupVerifier)
    throw new Error("Backup verification is unavailable");
  const result = await verifyWithTimeout(deps.backupVerifier, binding);
  if (result?.kind !== "verified")
    throw new Error("Backup verification is unavailable");
  const evidence = requireBackupVerificationEvidence(
    result.evidence,
    jobBinding(deps, job, jobId),
    deps.now(),
  );
  return durableResult(
    deps,
    await deps.repository.verifyBackup(jobId, evidence),
    jobId,
  );
}
