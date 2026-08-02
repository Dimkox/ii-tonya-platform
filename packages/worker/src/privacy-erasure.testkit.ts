import { createHash } from "node:crypto";
import type {
  ErasureDeps,
  ErasureJobState,
  PrivacyProcessor,
  PrivacyProcessorName,
  ProcessorAttemptState,
} from "./privacy-erasure.js";

export interface ErasureFixture extends ErasureDeps {
  processorCalls(name: PrivacyProcessorName): number;
  job(): ErasureJobState;
  reconcileCalls(name: PrivacyProcessorName): number;
}

export function erasureFixture(input: {
  processors: readonly PrivacyProcessorName[];
  crashAfter?: PrivacyProcessorName;
  started?: PrivacyProcessorName;
  reconciled?: PrivacyProcessorName;
}): ErasureFixture {
  const attempts = new Map<PrivacyProcessorName, ProcessorAttemptState>();
  const calls = new Map<PrivacyProcessorName, number>();
  const reconciles = new Map<PrivacyProcessorName, number>();
  let job: ErasureJobState = { jobId: "erase-job-1", status: "pending" };
  let crashPending = input.crashAfter !== undefined;
  const repository: ErasureDeps["repository"] = {
    async getJob(jobId) { return { ...job, jobId }; },
    async getAttempt(_jobId, processor) { return attempts.get(processor) ?? (input.started === processor ? "started" : "pending"); },
    async loadManifest(_jobId, processor) { return { ciphertext: `cipher:${processor}:target`, keyReference: "test-key", algorithm: "test", version: "v1" }; },
    async markStarted(_jobId, processor) { attempts.set(processor, "started"); },
    async markUnknown(_jobId, processor) { attempts.set(processor, "unknown_outcome"); },
    async acknowledge(_jobId, processor) {
      attempts.set(processor, "acknowledged");
      if (crashPending && input.crashAfter === processor) {
        crashPending = false;
        throw new Error("simulated crash");
      }
    },
    async deadLetter(_jobId, processor) { attempts.set(processor, "dead_letter"); job = { ...job, status: "dead_letter" }; },
    async completeProcessors(jobId, backupEvidence) { job = { jobId, status: "processor_complete", backupEvidence }; },
    async verifyBackup(jobId) { job = { ...job, jobId, status: "backup_verified", backupEvidence: { ...job.backupEvidence!, verificationState: "verified" } }; },
  };
  const processors: PrivacyProcessor[] = input.processors.map((name) => ({
    name,
    async erase() {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return { kind: "erased", receipt: `receipt:${name}` };
    },
    async reconcile() {
      reconciles.set(name, (reconciles.get(name) ?? 0) + 1);
      return input.reconciled === name ? "erased" : "not_erased";
    },
  }));
  return {
    repository,
    processors,
    backupPolicy: {
      version: "backup-retention-v1",
      expiresNoLaterThan: (now) => new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    },
    now: () => new Date("2026-07-28T10:00:00.000Z"),
    hashReceipt: (receipt) => createHash("sha256").update(receipt).digest("hex"),
    manifestCipher: {
      async verifyEnvelope(envelope) { return envelope.keyReference === "test-key" && envelope.algorithm === "test" && envelope.version === "v1"; },
      async decrypt(envelope) { return envelope.ciphertext.replace(/^cipher:[^:]+:/, ""); },
    },
    capability: { enabled: true },
    processorCalls: (name) => calls.get(name) ?? 0,
    reconcileCalls: (name) => reconciles.get(name) ?? 0,
    job: () => ({ ...job }),
  };
}
