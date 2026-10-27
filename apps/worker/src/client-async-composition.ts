import type { loadEnv } from "@ii-tonya/config";
import { createClientAsyncTelegramTransport } from "@ii-tonya/integrations";
import type { ClientAsyncCapabilities } from "./client-async-outbox.js";

/** Resolve readiness before opening the database; no provider request during composition. */
export function composeClientAsyncTelegram(
  config: ReturnType<typeof loadEnv>,
  options: {
    telegram?: ClientAsyncCapabilities["telegram"];
    fetch?: typeof globalThis.fetch;
  } = {},
): ClientAsyncCapabilities["telegram"] | undefined {
  if (config.features.b2TelegramDispatch !== true) return undefined;
  const unavailable = () =>
    new Error("b2_telegram_delivery_capability_unavailable");
  if (
    config.features.telegramEgressConsentGate !== true ||
    !config.clientTelegramBotKey ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(config.clientTelegramBotKey)
  )
    throw unavailable();
  // Explicit injected business adapters remain a trusted compatibility seam.
  if (options.telegram !== undefined) {
    if (
      typeof options.telegram.transport?.request !== "function" ||
      !(options.telegram.sendMessageUrl instanceof URL)
    )
      throw unavailable();
    return options.telegram;
  }
  try {
    if (!config.clientTelegramBotToken) throw unavailable();
    const transport = createClientAsyncTelegramTransport({
      token: config.clientTelegramBotToken,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    return {
      transport,
      sendMessageUrl: new URL(
        `https://api.telegram.org/bot${config.clientTelegramBotToken}/sendMessage`,
      ),
    };
  } catch {
    throw unavailable();
  }
}
