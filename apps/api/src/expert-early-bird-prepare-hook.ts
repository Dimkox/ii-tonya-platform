import type { ResidentFormInput } from "@ii-tonya/application";
import type { WaveInvoice } from "./expert-early-bird-service.js";

type Choice = ResidentFormInput & {
  offerId: string;
  revision: number;
  choice: "now" | "later";
};
/** This internal port must authenticate the Telegram scope, resolve receipt data and stable operation identifiers in PostgreSQL, and fail closed. */
export interface EarlyBirdPrepareAuthority {
  prepare(
    input: Choice & { choiceId: string },
  ): Promise<{ kind: "prepared" | "replay" | "unavailable" } | WaveInvoice>;
}
/** Records preparation only; it never creates, sends, or displays a provider invoice. */
export async function afterEarlyBirdChoice(
  input: Choice,
  choiceId: string,
  formEligible: boolean,
  authority?: EarlyBirdPrepareAuthority,
  deferred?: EarlyBirdPrepareAuthority,
): Promise<{ kind: "form" | "pending" } | WaveInvoice> {
  if (formEligible) return { kind: "form" };
  const selected = input.choice === "now" ? authority : deferred;
  if (selected) {
    const outcome = await selected.prepare({ ...input, choiceId });
    if (outcome.kind === "invoice") return outcome;
  }
  return { kind: "pending" };
}
