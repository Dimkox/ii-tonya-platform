import {
  createExpertCommandProcessor,
  type ExpertCommandProcessor,
} from "./expert-command-processor.js";
import type { ExpertTelegramCheckoutCapability } from "./expert-residency-checkout.js";

type ProcessorDependencies = Parameters<typeof createExpertCommandProcessor>[0];
type Principal = Parameters<
  ExpertCommandProcessor["processCommand"]
>[0]["principal"];
type AuthenticatedClientView = Parameters<
  ExpertCommandProcessor["processClientView"]
>[0]["authenticated"];

export interface ExpertTelegramIngressFactoryDependencies extends ProcessorDependencies {
  readonly checkoutReadiness?: boolean;
  readonly checkout?: ExpertTelegramCheckoutCapability;
  resolvePrincipal(telegramUserId: string): Promise<Principal | null>;
  authenticateClientView(input: {
    readonly data: string;
    readonly telegramUserId: string;
    readonly correlationId: string;
  }): Promise<AuthenticatedClientView | null>;
}

export const createExpertTelegramIngress = (
  deps: ExpertTelegramIngressFactoryDependencies,
) => {
  if (deps.checkoutReadiness === true && deps.checkout === undefined) {
    throw new Error("Expert Telegram checkout capability is required");
  }
  const processor = createExpertCommandProcessor(deps);
  return {
    resolvePrincipal: deps.resolvePrincipal,
    authenticateClientView: deps.authenticateClientView,
    processCommand: processor.processCommand,
    processClientView: processor.processClientView,
    answerCallbackQuery: deps.views.answerCallbackQuery.bind(deps.views),
  };
};
