import { PostgresEarlyBirdLaunchKit, type DrizzleDb } from "@ii-tonya/db";
import {
  LAUNCH_KIT_DIGEST,
  LAUNCH_KIT_VERSION,
} from "./early-bird-launch-kit-content.js";
import { createLaunchKitTelegramTransport } from "./early-bird-launch-kit-telegram.js";
export function createEarlyBirdLaunchKitRuntime(
  options:
    | {
        db: DrizzleDb;
        expectedLogin: string;
        botKey: string;
        messagingPolicyVersion: string;
        token: string;
        fetch?: typeof fetch;
      }
    | undefined,
) {
  if (!options) return undefined;
  const store = new PostgresEarlyBirdLaunchKit(options.db, {
    ...options,
    contentVersion: LAUNCH_KIT_VERSION,
    payloadDigest: LAUNCH_KIT_DIGEST,
  });
  const transport = createLaunchKitTelegramTransport(options);
  let running = false;
  return {
    async run(limit = 20, signal: AbortSignal = new AbortController().signal) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw new Error("early_bird_launch_kit_limit_invalid");
      const counts = { queued: 0, delivered: 0, uncertain: 0 };
      if (running || signal.aborted) return counts;
      running = true;
      try {
        counts.queued = await store.enqueue(limit);
        for (let i = 0; i < limit && !signal.aborted; i++) {
          const claim = await store.claim();
          if (!claim) break;
          let result: Awaited<ReturnType<typeof store.sendIfCurrent>>;
          try {
            result = await store.sendIfCurrent(claim, (target) =>
              transport.send({ ...target, signal }),
            );
          } catch {
            result = { kind: "uncertain" };
          }
          if (!(await store.finish(claim, result))) {
            counts.uncertain++;
            continue;
          }
          if (result.kind === "delivered") counts.delivered++;
          if (result.kind === "uncertain") counts.uncertain++;
        }
        return counts;
      } finally {
        running = false;
      }
    },
  };
}
