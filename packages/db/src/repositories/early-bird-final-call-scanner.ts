import {
  decideFinalCall,
  nextFinalCallTick,
  type FinalCallAttempt,
} from "./early-bird-final-call.js";

export type FinalCallCandidate = Readonly<{
  userId: string;
  paymentStatus: string;
  verified: boolean;
  messagingConsent: boolean;
  first: FinalCallAttempt;
  repeat: FinalCallAttempt;
}>;
export type FinalCallScanBatch = Readonly<{
  nowMs: number;
  configVersion: string;
  phase: string;
  triggerAtMs: number;
  clientStartAtMs: number;
  candidates: readonly FinalCallCandidate[];
}>;
/**
 * readDueUnqueued must use the database clock and authoritative state, not a bot's
 * input. It must filter ineligible residents and already inserted notice kinds
 * before the limit, keyed by (user, kind), so a first notice never hides its
 * repeat and repeated scans make progress beyond the first page. Cancelled
 * never-sent attempts must not block a corrected attempt; delivered, dispatched
 * and uncertain attempts must block any duplicate. enqueueIfCurrent must lock and recheck current config/version, phase,
 * user, verification, consent, payment and delivery history in the same DB
 * transaction as an idempotent insert. A stale scan is never authority to send.
 */
export interface FinalCallScanStore {
  readDueUnqueued(limit: number): Promise<FinalCallScanBatch>;
  enqueueIfCurrent(
    input: Readonly<{
      userId: string;
      kind: "first" | "repeat";
      configVersion: string;
      triggerAtMs: number;
      clientStartAtMs: number;
      scheduledAtMs: number;
    }>,
  ): Promise<"queued" | "stale">;
}
export class EarlyBirdFinalCallScanner {
  constructor(private readonly store: FinalCallScanStore) {}
  async scan(
    limit: number,
  ): Promise<{ examined: number; queued: number; failed: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_notice_limit_invalid");
    const batch = await this.store.readDueUnqueued(limit);
    if (
      !batch ||
      !Array.isArray(batch.candidates) ||
      batch.candidates.length > limit ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(batch.configVersion)
    )
      throw new Error("early_bird_notice_batch_invalid");
    const result = { examined: batch.candidates.length, queued: 0, failed: 0 };
    if (batch.phase !== "WAVE_1_EARLY_BIRD") return result;
    for (const candidate of batch.candidates) {
      const kind = decideFinalCall({
        ...candidate,
        nowMs: batch.nowMs,
        triggerAtMs: batch.triggerAtMs,
        clientStartAtMs: batch.clientStartAtMs,
      });
      if (!kind) continue;
      const eligibleAtMs =
        kind === "first"
          ? batch.triggerAtMs
          : candidate.first.deliveredAtMs! + 3 * 86400000;
      const scheduledAtMs = nextFinalCallTick(
        batch.triggerAtMs,
        eligibleAtMs,
        batch.clientStartAtMs,
      );
      if (scheduledAtMs === null || scheduledAtMs > batch.nowMs) continue;
      try {
        const status = await this.store.enqueueIfCurrent({
          userId: candidate.userId,
          kind,
          configVersion: batch.configVersion,
          triggerAtMs: batch.triggerAtMs,
          clientStartAtMs: batch.clientStartAtMs,
          scheduledAtMs,
        });
        if (status === "queued") result.queued++;
      } catch {
        result.failed++;
      }
    }
    return result;
  }
}
