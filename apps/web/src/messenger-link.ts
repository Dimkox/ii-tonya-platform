import type { PublicConfig } from "./config.js";
import type { TariffCode } from "./content.js";

export type MessengerIntent = TariffCode | "client" | "expert";

export function buildMessengerLink(
  config: PublicConfig,
  intent: MessengerIntent,
): URL {
  const target = new URL(config.expertChatUrl.href);
  target.searchParams.set(
    "start",
    intent === "client" ? "client" : `expert_${intent}`,
  );
  return target;
}
