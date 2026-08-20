import type { PublicConfig } from "./config.js";
import type { TariffCode } from "./content.js";

export function buildMessengerLink(
  config: PublicConfig,
  tariffCode: TariffCode,
): URL {
  const target = new URL(config.expertChatUrl.href);
  target.searchParams.set("start", `expert_${tariffCode}`);
  return target;
}
