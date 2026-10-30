import {
  PostgresDeferredFinalCallCampaign,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createDeferredFinalCallJob } from "./early-bird-deferred-final-call.js";
import { createFinalCallTelegramTransport } from "./early-bird-final-call-telegram.js";

/** Explicit runtime capability; absence preserves the disabled state. Telegram
 * transport is configured by the trusted composition, not a prompt/recipient.
 * Sending first commits queue uncertainty, then rechecks current authority.
 */
export function createDeferredFinalCallRuntime(
  options:
    | {
        db: DrizzleDb;
        botKey: string;
        messagingPolicyVersion: string;
        expectedLogin: string;
        token: string;
        fetch?: typeof fetch;
      }
    | undefined,
) {
  if (!options) return undefined;
  if (!options.botKey || !options.messagingPolicyVersion)
    throw new Error("early_bird_final_call_configuration_invalid");
  const campaign = new PostgresDeferredFinalCallCampaign(options.db, options);
  const run = createDeferredFinalCallJob(
    campaign,
    createFinalCallTelegramTransport(options),
  );
  return {
    campaign,
    run,
  };
}
