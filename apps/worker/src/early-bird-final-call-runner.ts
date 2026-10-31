import { renderFinalCallMessage } from "./early-bird-final-call-message.js";

export type FinalCallClaim = Readonly<{
  noticeId: string;
  attemptId: string;
  userId: string;
  kind: "first" | "repeat";
}>;
export type FinalCallCandidate = Readonly<{
  name: string;
  basePriceMinor: bigint;
  clientStartAtMs: number;
  triggerAtMs: number;
  configVersion: string;
  checkoutUrl: string;
  paymentId: string;
}>;
export type FinalCallResult =
  | Readonly<{ kind: "delivered"; messageId: string }>
  | Readonly<{ kind: "cancelled" | "retry" | "uncertain" }>;

/**
 * Storage must atomically claim notices and prepare only the current ONBOARDING_ONLY
 * resident's verified, full-base-price checkout. dispatch commits uncertainty before
 * network I/O. finish must compare both notice and attempt IDs; uncertain must never
 * automatically return to pending. The runner is not usable without this store.
 */
export interface FinalCallStore {
  claim(): Promise<FinalCallClaim | null>;
  prepare(
    claim: FinalCallClaim,
  ): Promise<
    | Readonly<{ kind: "ready"; candidate: FinalCallCandidate }>
    | Readonly<{ kind: "ineligible" | "pending" }>
  >;
  dispatch(claim: FinalCallClaim): Promise<boolean>;
  finish(claim: FinalCallClaim, result: FinalCallResult): Promise<boolean>;
}

/**
 * This port is a capability: it must recheck current payment state, current
 * verification, consent and checkout binding as part of send admission and must
 * prevent a send after a revocation has completed. It must recheck the current
 * phase, configuration version and trigger/launch times using the authoritative clock. A plain Telegram client does
 * not satisfy it. Until such a capability exists, keep this runner uncomposed.
 */
export interface FinalCallSender {
  readonly strictAuthority: true;
  sendIfAuthorized(
    input: {
      claim: FinalCallClaim;
      paymentId: string;
      basePriceMinor: bigint;
      clientStartAtMs: number;
      triggerAtMs: number;
      configVersion: string;
      checkoutUrl: string;
      text: string;
    },
    signal: AbortSignal,
  ): Promise<
    | Readonly<{ kind: "delivered"; messageId: string }>
    | Readonly<{ kind: "cancelled" | "uncertain" }>
  >;
}

export class EarlyBirdFinalCallRunner {
  constructor(
    private readonly store: FinalCallStore,
    private readonly sender: FinalCallSender | undefined,
  ) {}

  async run(
    limit: number,
    signal: AbortSignal,
  ): Promise<{ delivered: number; uncertain: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_notice_limit_invalid");
    const result = { delivered: 0, uncertain: 0 };
    if (!this.sender || this.sender.strictAuthority !== true || signal.aborted)
      return result;
    for (let i = 0; i < limit && !signal.aborted; i++) {
      const claim = await this.store.claim();
      if (!claim) break;
      let prepared: Awaited<ReturnType<FinalCallStore["prepare"]>>;
      try {
        prepared = await this.store.prepare(claim);
      } catch {
        await this.store.finish(claim, { kind: "retry" });
        continue;
      }
      if (prepared.kind !== "ready") {
        await this.store.finish(claim, {
          kind: prepared.kind === "ineligible" ? "cancelled" : "retry",
        });
        continue;
      }
      const candidate = prepared.candidate;
      let text: string;
      try {
        if (
          !/^[A-Za-z0-9_-]{1,64}$/u.test(candidate.paymentId) ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(candidate.configVersion)
        )
          throw new Error("early_bird_notice_invalid");
        text = renderFinalCallMessage(candidate);
      } catch {
        await this.store.finish(claim, { kind: "cancelled" });
        continue;
      }
      if (signal.aborted) {
        await this.store.finish(claim, { kind: "retry" });
        break;
      }
      if (!(await this.store.dispatch(claim))) continue;
      let disposition: FinalCallResult;
      try {
        const sent = await this.sender.sendIfAuthorized(
          {
            claim,
            paymentId: candidate.paymentId,
            basePriceMinor: candidate.basePriceMinor,
            clientStartAtMs: candidate.clientStartAtMs,
            triggerAtMs: candidate.triggerAtMs,
            configVersion: candidate.configVersion,
            checkoutUrl: candidate.checkoutUrl,
            text,
          },
          signal,
        );
        if (
          sent.kind === "delivered" &&
          !/^[1-9][0-9]{0,19}$/u.test(sent.messageId)
        )
          disposition = { kind: "uncertain" };
        else if (sent.kind === "delivered" || sent.kind === "uncertain")
          disposition = sent;
        else if (sent.kind === "cancelled")
          // A persisted dispatch marker means we cannot prove the network did not start.
          disposition = { kind: "uncertain" };
        else disposition = { kind: "uncertain" };
      } catch {
        disposition = { kind: "uncertain" };
      }
      let saved = false;
      try {
        saved = await this.store.finish(claim, disposition);
      } catch {
        // Dispatch has already been committed; leave it for reconciliation.
      }
      if (!saved) result.uncertain++;
      else if (disposition.kind === "delivered") result.delivered++;
      else if (disposition.kind === "uncertain") result.uncertain++;
    }
    return result;
  }
}
