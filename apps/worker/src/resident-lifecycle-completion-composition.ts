import {
  assertResidentLifecycleCompletionConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
import {
  PostgresResidentLifecycleCompletionRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createBookingNotificationTransport } from "@ii-tonya/integrations";
/** Distinct original WORK-bot binding; no PROMO/client token substitution. */
export function createResidentLifecycleCompletionWorker(
  db: DrizzleDb,
  config: RuntimeConfig,
  fetch?: typeof globalThis.fetch,
) {
  assertResidentLifecycleCompletionConfig(config);
  const c = config.residentLifecycleCompletion;
  if (!c || (!c.enabled && !c.deliveryEnabled)) return undefined;
  const work = config.expertCard!;
  const repository = new PostgresResidentLifecycleCompletionRepository(db, {
    workBotId: work.workBotId,
    workBotKey: work.workBotKey,
    messagingConsentPolicyVersion: work.messagingConsentPolicyVersion,
    ...(c.deliveryEnabled
      ? {
          transport: createBookingNotificationTransport({
            botKey: work.workBotKey,
            token: work.workBotToken!,
            ...(fetch ? { fetch } : {}),
          }),
        }
      : {}),
  });
  let running = false,
    accepting = true;
  return {
    async runOnce() {
      if (running) throw new Error("resident_lifecycle_cycle_busy");
      running = true;
      try {
        if (!accepting) {
          await repository.recoverReceipts();
          return { examined: 0, delivered: 0, reason: "closing" };
        }
        const examined = c.enabled ? await repository.processBatch() : 0;
        const delivered = c.deliveryEnabled
          ? await repository.deliverBatch()
          : 0;
        return { examined, delivered };
      } finally {
        running = false;
      }
    },
    stopAccepting() {
      accepting = false;
      repository.stopAccepting();
    },
  };
}
