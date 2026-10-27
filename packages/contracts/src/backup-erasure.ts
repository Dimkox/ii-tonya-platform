import { z } from "zod";

const machineIdentifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const canonicalUtc = z.iso.datetime({ precision: 3 }).refine((value) => {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
});

export const backupVerificationBindingSchema = z.strictObject({
  jobId: z.uuid().refine((value) => value === value.toLowerCase()),
  policyVersion: machineIdentifier,
  expiresNoLaterThan: canonicalUtc,
});

export const backupScheduleSchema = z.strictObject({
  policyVersion: machineIdentifier,
  expiresNoLaterThan: canonicalUtc,
  verificationState: z.literal("scheduled"),
});

/** Minimal reference to an attestation verified by trusted server composition.
 * A hash on its own is not verification and this schema provides no authenticity.
 */
export const backupVerificationEvidenceSchema = z.strictObject({
  evidenceVersion: z.literal(1),
  ...backupVerificationBindingSchema.shape,
  verifiedAt: canonicalUtc,
  method: z.enum(["inventory_attestation", "deletion_attestation"]),
  verifierId: machineIdentifier,
  receiptSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type BackupVerificationBinding = z.infer<
  typeof backupVerificationBindingSchema
>;
export type BackupVerificationEvidence = z.infer<
  typeof backupVerificationEvidenceSchema
>;
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

/** Call with the worker's clock for admission, and DATABASE time for persistence. */
export function requireBackupVerificationEvidence(
  value: unknown,
  binding: BackupVerificationBinding,
  now: Date,
): BackupVerificationEvidence {
  const parsed = backupVerificationEvidenceSchema.safeParse(value);
  const request = backupVerificationBindingSchema.safeParse(binding);
  if (!parsed.success || !request.success || !Number.isFinite(now.getTime())) {
    throw new Error("Backup verification evidence is incomplete or invalid");
  }
  const evidence = parsed.data;
  if (
    evidence.jobId !== binding.jobId ||
    evidence.policyVersion !== binding.policyVersion ||
    evidence.expiresNoLaterThan !== binding.expiresNoLaterThan ||
    Date.parse(evidence.verifiedAt) < Date.parse(evidence.expiresNoLaterThan) ||
    Date.parse(evidence.verifiedAt) > now.getTime()
  ) {
    throw new Error("Backup verification evidence is incomplete or invalid");
  }
  return evidence;
}
