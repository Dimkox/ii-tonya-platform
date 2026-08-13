import { describe, expect, it } from "vitest";

import { parseExpertTelegramCount } from "./expert-telegram-query-repository.js";

describe("expert Telegram aggregate integrity", () => {
  it.each(["-1", "1.5", "not-a-count", "9007199254740992"])(
    "rejects malformed, negative, or overflowing PostgreSQL count %s",
    (value) => {
      expect(() => parseExpertTelegramCount(value)).toThrow(
        "expert_query_integrity_failure",
      );
    },
  );

  it("accepts the maximum safe non-negative PostgreSQL count", () => {
    expect(parseExpertTelegramCount("9007199254740991")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
