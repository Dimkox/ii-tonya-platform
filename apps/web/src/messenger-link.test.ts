import { describe, expect, it } from "vitest";
import { buildMessengerLink } from "./messenger-link.js";

describe("promotional messenger link", () => {
  it.each(["base", "exclusive", "event"] as const)(
    "adds only the bounded %s purchase intent",
    (tariffCode) => {
      const target = buildMessengerLink(
        { expertChatUrl: new URL("https://t.me/ii_tonya_bot") },
        tariffCode,
      );
      expect([...target.searchParams.entries()]).toEqual([
        ["start", `expert_${tariffCode}`],
      ]);
      expect(target.origin).toBe("https://t.me");
    },
  );

  it("does not mutate the configured URL", () => {
    const configured = new URL("https://t.me/ii_tonya_bot?lang=ru");
    buildMessengerLink({ expertChatUrl: configured }, "base");
    expect(configured.search).toBe("?lang=ru");
  });
});
