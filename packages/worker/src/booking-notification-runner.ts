import type { BookingNotificationHttpOutcome } from "@ii-tonya/integrations";
import type { BookingNotificationTopic } from "@ii-tonya/contracts";

interface Claim {
  topic?: BookingNotificationTopic;
  id: string;
  reservationId: string;
  leaseToken: string;
  workerId: string;
}
interface Prepared {
  attemptId: string;
  deliveryId: string;
  botKey: string;
  chatId: string;
  deadline: string;
  wireVersion: 1;
  body: string;
  bodySha256: string;
}
type Receipt = { botKey: string; chatId: string; messageId: number };
type Outcome = Exclude<BookingNotificationHttpOutcome, { kind: "applied" }>;
export interface BookingNotificationRunnerDependencies {
  repository: {
    capturePending(limit: number): Promise<unknown>;
    recoverExpired(limit: number): Promise<unknown>;
    claimDeliveries(limit: number, workerId: string): Promise<Claim[]>;
    admitPrepared(claim: Claim): Promise<Prepared | undefined>;
    resolveReceipt(attemptId: string, receipt: Receipt): Promise<boolean>;
    recordOutcome(attemptId: string, outcome: Outcome): Promise<boolean>;
  };
  callbacks: { issueApprovalPair(deliveryId: string): Promise<unknown> };
  transport: {
    sendPrepared(grant: Prepared): Promise<BookingNotificationHttpOutcome>;
  };
  workerId: string;
  sendEnabled: boolean;
}
export interface BookingNotificationRunReport {
  sent: number;
  pendingCompletion: boolean;
}

/** One HTTP invocation per consumed grant. The pending slot is NOT a durable spool. */
export function createBookingNotificationRunner(
  deps: BookingNotificationRunnerDependencies,
) {
  if (!deps.workerId || deps.workerId.length > 128)
    throw new Error("notification_worker_invalid");
  let accepting = deps.sendEnabled;
  let closed = false;
  let draining = false;
  let flushing: Promise<void> | undefined;
  let active: Promise<BookingNotificationRunReport> | undefined;
  let pending:
    { attemptId: string; outcome: BookingNotificationHttpOutcome } | undefined;
  const flush = (): Promise<void> => {
    if (flushing) return flushing;
    if (!pending || closed) return Promise.resolve();
    const savedPending = pending;
    flushing = (async () => {
      try {
        const { attemptId, outcome } = savedPending;
        const saved =
          outcome.kind === "applied"
            ? await deps.repository.resolveReceipt(attemptId, outcome.receipt)
            : await deps.repository.recordOutcome(attemptId, outcome);
        if (saved && pending === savedPending) pending = undefined;
      } catch {
        /* Retain original evidence; never retry HTTP. */
      }
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };
  const cycle = async (): Promise<BookingNotificationRunReport> => {
    let sent = 0;
    if (closed) return { sent, pendingCompletion: pending !== undefined };
    if (pending) {
      await flush();
      return { sent, pendingCompletion: pending !== undefined };
    }
    if (draining) return { sent, pendingCompletion: false };
    try {
      await deps.repository.recoverExpired(20);
      if (closed || draining) return { sent, pendingCompletion: false };
      await deps.repository.capturePending(20);
      if (!accepting) return { sent, pendingCompletion: false };
      const claim = (
        await deps.repository.claimDeliveries(1, deps.workerId)
      )[0];
      if (!claim || !claim.topic || !accepting)
        return { sent, pendingCompletion: false };
      if (claim.topic === "telegram.reservation_request")
        await deps.callbacks.issueApprovalPair(claim.id);
      if (!accepting) return { sent, pendingCompletion: false };
      const grant = await deps.repository.admitPrepared(claim);
      if (!grant) return { sent, pendingCompletion: false };
      let outcome: BookingNotificationHttpOutcome;
      if (!accepting) outcome = { kind: "not_applied" };
      else {
        sent = 1;
        try {
          outcome = await deps.transport.sendPrepared(grant);
        } catch {
          outcome = { kind: "unknown", reasonCode: "delivery_uncertain" };
        }
      }
      pending = { attemptId: grant.attemptId, outcome };
      await flush();
    } catch {
      /* Database failure before a grant gives no send authority. */
    }
    return { sent, pendingCompletion: pending !== undefined };
  };
  const runOnce = () => {
    if (!active)
      active = cycle().finally(() => {
        active = undefined;
      });
    return active;
  };
  return {
    runOnce,
    stopAccepting() {
      accepting = false;
    },
    async drain(deadline: number): Promise<void> {
      accepting = false;
      draining = true;
      const remaining = deadline - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        closed = true;
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            if (active) await active;
            if (!closed && Date.now() < deadline && pending) await flush();
          })(),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.min(remaining, 2147483647));
          }),
        ]);
      } finally {
        closed = true;
        clearTimeout(timer);
      }
    },
  };
}
