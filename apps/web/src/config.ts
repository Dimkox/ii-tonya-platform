export interface PublicConfig {
  readonly expertChatUrl: URL;
}

const forbiddenKey = /(?:token|secret|password|auth|key)/iu;
const defaultExpertChatUrl = "https://t.me/ii_tonya_expert_promo_bot";

export function readPublicConfig(input: {
  readonly VITE_EXPERT_CHAT_URL?: string;
}): PublicConfig {
  let url: URL;
  try {
    url = new URL(input.VITE_EXPERT_CHAT_URL ?? defaultExpertChatUrl);
  } catch {
    throw new Error("public_expert_chat_url_invalid");
  }
  const telegramHttps = url.protocol === "https:" && url.hostname === "t.me";
  const telegramDeepLink =
    url.protocol === "tg:" &&
    url.hostname === "resolve" &&
    url.searchParams.has("domain");
  if (
    (!telegramHttps && !telegramDeepLink) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    [...url.searchParams.keys()].some((key) => forbiddenKey.test(key))
  ) {
    throw new Error("public_expert_chat_url_invalid");
  }
  return { expertChatUrl: url };
}
