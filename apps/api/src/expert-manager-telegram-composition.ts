import {
  createExpertManagerTelegramService,
  type ExpertManagerTelegramTransport,
} from "@ii-tonya/application";
import {
  PostgresExpertManagerTelegramRepository,
  PostgresExpertCampaignQuoteRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { ExpertVerificationCapability } from "./expert-verification-composition.js";
import type { ExpertManagerTelegramCapability } from "./routes/expert-manager-telegram.js";
/** Explicit capability only: never enabled by a bot ID, environment inheritance or admin role alone. */
export function createExpertManagerTelegramComposition(
  db: DrizzleDb,
  input: {
    enabled: boolean;
    botId: string;
    botKey: string;
    webhookSecret: string;
    callbackSecret: Uint8Array;
    transport: ExpertManagerTelegramTransport;
    verification: ExpertVerificationCapability;
  },
): ExpertManagerTelegramCapability | undefined {
  if (!input.enabled) return undefined;
  return {
    enabled: true,
    botId: input.botId,
    botKey: input.botKey,
    webhookSecret: input.webhookSecret,
    service: createExpertManagerTelegramService({
      enabled: true,
      botId: input.botId,
      secret: input.callbackSecret,
      repository: new PostgresExpertManagerTelegramRepository(db),
      verification: input.verification.service,
      transport: input.transport,
      verifyProfile: (facts) =>
        new PostgresExpertCampaignQuoteRepository(db).verifyProfile(facts),
    }),
  };
}
