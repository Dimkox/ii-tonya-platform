import { describe, expect, it } from "vitest";
import { readPublicConfig } from "./config.js";

describe("public web config", () => {
  it.each(["https://t.me/ii_tonya_bot", "tg://resolve?domain=ii_tonya_bot"])(
    "accepts an allowlisted expert chat URL: %s",
    (expertChatUrl) => {
      expect(
        readPublicConfig({ VITE_EXPERT_CHAT_URL: expertChatUrl }).expertChatUrl
          .href,
      ).toBe(new URL(expertChatUrl).href);
    },
  );

  it.each([
    "http://t.me/ii_tonya_bot",
    "https://user:pass@t.me/ii_tonya_bot",
    "https://example.com/chat",
    "javascript:alert(1)",
    "https://t.me/ii_tonya_bot#token",
    "https://t.me/ii_tonya_bot?access_token=secret",
  ])("rejects unsafe expert chat URL: %s", (expertChatUrl) => {
    expect(() =>
      readPublicConfig({ VITE_EXPERT_CHAT_URL: expertChatUrl }),
    ).toThrow("public_expert_chat_url_invalid");
  });
});
