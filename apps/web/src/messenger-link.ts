import type { PublicConfig } from "./config.js";
import type { TariffCode } from "./content.js";

export type MessengerIntent = TariffCode | "client" | "expert";

export function buildMessengerLink(
  config: PublicConfig,
  intent: MessengerIntent,
): URL {
  const target = new URL(config.expertChatUrl.href);
  const start =
    intent === "client" || intent === "expert" ? intent : `expert_${intent}`;
  target.searchParams.set("start", start);
  return target;
}
