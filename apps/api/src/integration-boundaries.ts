import type { RuntimeConfig } from "@ii-tonya/config";
import {
  DisabledSelartiAdapter,
  type SelartiPort,
} from "@ii-tonya/integrations";
import type { TelegramCallbackService } from "./routes/telegram-webhook.js";

/** Fail-closed Telegram callback boundary used while TELEGRAM_ENABLED=false. */
export const disabledTelegramCallbacks: TelegramCallbackService = Object.freeze(
  {
    async isAuthorizedIdentity() {
      return false;
    },
    async verifyCallback() {
      return false;
    },
    async process() {
      throw new Error("Telegram integration is disabled");
    },
  },
);

export interface IntegrationBoundaryCapabilities {
  selarti?: SelartiPort;
  telegramCallbacks?: TelegramCallbackService;
}

export interface IntegrationBoundaries {
  selarti: SelartiPort;
  telegramCallbacks: TelegramCallbackService;
}

/**
 * Picks the Selarti and Telegram callback boundaries from env flags.
 * Flag off: the disabled boundary, even if a capability is supplied.
 * Flag on: the supplied live capability; a missing one stops startup.
 */
export function resolveIntegrationBoundaries(
  config: Pick<RuntimeConfig, "integrations">,
  capabilities: IntegrationBoundaryCapabilities = {},
): IntegrationBoundaries {
  const selarti = config.integrations.selarti
    ? capabilities.selarti
    : new DisabledSelartiAdapter();
  if (
    selarti === undefined ||
    (config.integrations.selarti && isDisabledSelarti(selarti))
  )
    throw new Error("selarti_capability_required");
  const telegramCallbacks = config.integrations.telegram
    ? capabilities.telegramCallbacks
    : disabledTelegramCallbacks;
  if (
    telegramCallbacks === undefined ||
    (config.integrations.telegram &&
      telegramCallbacks === disabledTelegramCallbacks)
  )
    throw new Error("telegram_callback_capability_required");
  return { selarti, telegramCallbacks };
}

export const isDisabledSelarti = (port: SelartiPort): boolean =>
  port instanceof DisabledSelartiAdapter;

/** Startup guard: an enabled flag must not run on a disabled boundary. */
export function assertIntegrationBoundaries(
  config: Pick<RuntimeConfig, "integrations">,
  deps: IntegrationBoundaries,
): void {
  if (config.integrations.selarti && isDisabledSelarti(deps.selarti))
    throw new Error("selarti_capability_required");
  if (
    config.integrations.telegram &&
    deps.telegramCallbacks === disabledTelegramCallbacks
  )
    throw new Error("telegram_callback_capability_required");
}
