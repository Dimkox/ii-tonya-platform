export type PrivacyProcessorName =
  | "object_store"
  | "selarti"
  | "planerka"
  | "make_projection";

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
  reconcile(command: ProcessorReconcileCommand): Promise<"erased" | "not_erased" | "unknown">;
}
export interface DeletionManifestCipher {
  decrypt(envelope: { ciphertext: string; keyReference: string; algorithm: string; version: string }): Promise<string>;
}

export type ProcessorAttemptState =
  | "pending"
  | "started"
  | "unknown_outcome"
  | "acknowledged"
  | "dead_letter";

export interface ErasureJobState {
  readonly jobId: string;
  readonly status: "pending" | "processor_complete" | "backup_verified" | "dead_letter";
  readonly backupEvidence?: {
    readonly policyVersion: string;
    readonly expiresNoLaterThan: string;
    readonly verificationState: "scheduled" | "verified";
  };
}

export interface ErasureRepository {
  getJob(jobId: string): Promise<ErasureJobState>;
  getAttempt(jobId: string, processor: PrivacyProcessorName): Promise<ProcessorAttemptState>;
  loadManifest(jobId: string, processor: PrivacyProcessorName): Promise<{ ciphertext: string; keyReference: string; algorithm: string; version: string }>;
  markStarted(jobId: string, processor: PrivacyProcessorName, idempotencyKey: string): Promise<void>;
  markUnknown(jobId: string, processor: PrivacyProcessorName): Promise<void>;
  acknowledge(jobId: string, processor: PrivacyProcessorName, receiptHash: string): Promise<void>;
  deadLetter(jobId: string, processor: PrivacyProcessorName, reason: string): Promise<void>;
  completeProcessors(jobId: string, evidence: NonNullable<ErasureJobState["backupEvidence"]>): Promise<void>;
  verifyBackup(jobId: string, verifiedAt: Date): Promise<void>;
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
}

export interface ErasureWorkflowResult {
  readonly jobId: string;
  readonly status: ErasureJobState["status"];
}

const orderedProcessors: readonly PrivacyProcessorName[] = [
  "object_store", "selarti", "planerka", "make_projection",
];

function processorMap(processors: readonly PrivacyProcessor[]): Map<PrivacyProcessorName, PrivacyProcessor> {
  const byName = new Map(processors.map((processor) => [processor.name, processor]));
  if (byName.size !== processors.length) throw new Error("Duplicate privacy processor");
  if (byName.size !== orderedProcessors.length || orderedProcessors.some((name) => !byName.has(name))) {
    throw new Error("Privacy processor set is incomplete or contains an unsupported processor");
  }
  return byName;
}

export async function runErasureWorkflow(
  deps: ErasureDeps,
  jobId: string,
): Promise<ErasureWorkflowResult> {
  const job = await deps.repository.getJob(jobId);
  if (job.status === "dead_letter") throw new Error("Erasure job is dead-lettered");
  if (job.status === "processor_complete" || job.status === "backup_verified") return { jobId, status: job.status };
  const processors = processorMap(deps.processors);
  for (const name of orderedProcessors) {
    const processor = processors.get(name);
    if (processor === undefined) continue;
    const idempotencyKey = `${jobId}:${name}`;
    const manifest = await deps.repository.loadManifest(jobId, name);
    const opaqueTarget = await deps.manifestCipher.decrypt(manifest);
    const state = await deps.repository.getAttempt(jobId, name);
    if (state === "acknowledged") continue;
    if (state === "unknown_outcome" || state === "started") {
      const reconciled = await processor.reconcile({ jobId, processor: name, idempotencyKey, opaqueTarget });
      if (reconciled === "erased") {
        await deps.repository.acknowledge(jobId, name, deps.hashReceipt(`reconciled:${idempotencyKey}`));
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
      outcome = await processor.erase({ jobId, processor: name, idempotencyKey, opaqueTarget });
    } catch (error) {
      await deps.repository.markUnknown(jobId, name);
      throw error;
    }
    if (outcome.kind === "unknown_outcome") {
      await deps.repository.markUnknown(jobId, name);
      const reconciled = await processor.reconcile({ jobId, processor: name, idempotencyKey, opaqueTarget });
      if (reconciled !== "erased") {
        await deps.repository.deadLetter(jobId, name, `reconcile_${reconciled}`);
        throw new Error(`Erasure processor ${name} outcome is ${reconciled}`);
      }
      await deps.repository.acknowledge(jobId, name, deps.hashReceipt(`reconciled:${idempotencyKey}`));
      continue;
    }
    await deps.repository.acknowledge(jobId, name, deps.hashReceipt(outcome.receipt));
  }
  const expiry = deps.backupPolicy.expiresNoLaterThan(deps.now());
  await deps.repository.completeProcessors(jobId, {
    policyVersion: deps.backupPolicy.version,
    expiresNoLaterThan: expiry.toISOString(),
    verificationState: "scheduled",
  });
  return { jobId, status: "processor_complete" };
}

export async function verifyExpiredBackup(
  deps: ErasureDeps,
  jobId: string,
): Promise<ErasureWorkflowResult> {
  const job = await deps.repository.getJob(jobId);
  if (job.status === "backup_verified") return { jobId, status: "backup_verified" };
  if (job.status !== "processor_complete" || job.backupEvidence?.verificationState !== "scheduled") {
    throw new Error("Backup verification is not scheduled");
  }
  if (new Date(job.backupEvidence.expiresNoLaterThan).getTime() > deps.now().getTime()) {
    throw new Error("Backup expiry has not elapsed");
  }
  await deps.repository.verifyBackup(jobId, deps.now());
  return { jobId, status: "backup_verified" };
}
