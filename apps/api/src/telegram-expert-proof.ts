import { createHmac } from "node:crypto";
import type { ExpertIdentityProofVerifier } from "@ii-tonya/application";
import { createTelegramClientProofVerifier } from "./telegram-client-proof.js";
export function createTelegramExpertProofVerifier(options: {
  botToken: string;
  resolveIdentity: (externalId: string) => Promise<{
    userId: string;
    expertId: string;
    channelIdentityId: string;
    externalId: string;
    botKey: string | null;
    externalChatId: string | null;
  } | null>;
  widgetEnabled?: boolean;
  now?: () => number;
}): ExpertIdentityProofVerifier {
  // Reuse signed-Telegram parsing/crypto, never a client bearer or client lookup.
  return {
    async verify(input) {
      if (
        input.signal.aborted ||
        input.expectedAudience !== "ii-tonya-expert" ||
        input.expectedScope !== "expert_session:create"
      )
        return null;
      const binding: {
        owner: Awaited<ReturnType<typeof options.resolveIdentity>>;
      } = { owner: null };
      const mechanics = createTelegramClientProofVerifier({
        ...options,
        resolveIdentity: async (id) => {
          binding.owner = await options.resolveIdentity(id);
          if (binding.owner?.externalId !== id) binding.owner = null;
          return binding.owner?.userId ?? null;
        },
      });
      const proof = await mechanics.verify({
        ...input,
        expectedAudience: "ii-tonya-client",
        expectedScope: "client_session:create",
      });
      if (!proof || !binding.owner || input.signal.aborted) return null;
      return {
        ...binding.owner,
        audience: "ii-tonya-expert",
        scope: "expert_session:create",
        expiresAt: proof.expiresAt,
        replayDigest: `expert-login:v1:${createHmac("sha256", options.botToken).update(`expert-session:${proof.replayDigest}`).digest("hex")}`,
      };
    },
  };
}
