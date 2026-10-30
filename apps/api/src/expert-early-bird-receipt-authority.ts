import type { ResidentFormInput } from "@ii-tonya/application";
import type { WaveInvoice } from "./expert-early-bird-service.js";
type IdentityScope = Pick<
  ResidentFormInput,
  "botId" | "botKey" | "telegramUserId" | "chatId"
>;
type Scope = IdentityScope & { offerId: string; choiceId: string };
/** Enabled only with DB-backed scoped resolution, receipt vault, and atomic preparer. */
export function createEarlyBirdReceiptAuthority(options: {
  source: { resolveCurrent(input: IdentityScope): Promise<Scope | null> };
  contacts: {
    capture(
      scope: Scope,
      email: string,
      idempotencyKey: string,
    ): Promise<{ id: string; expiresAt: string }>;
  };
  prepare: {
    prepare(
      scope: Scope,
    ): Promise<{ kind: "prepared" | "replay" | "unavailable" } | WaveInvoice>;
  };
}): {
  captureReceipt(
    input: ResidentFormInput,
    email: string,
  ): Promise<boolean | WaveInvoice>;
} {
  return {
    async captureReceipt(input, email) {
      if (!Number.isSafeInteger(input.updateId) || input.updateId < 0)
        return false;
      const scope = await options.source.resolveCurrent({
        botId: input.botId,
        botKey: input.botKey,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      });
      if (!scope) return false;
      await options.contacts.capture(
        scope,
        email,
        `wave-receipt:${input.botId}:${input.updateId}`,
      );
      const result = await options.prepare.prepare(scope);
      return result.kind === "invoice" ? result : true;
    },
  };
}
