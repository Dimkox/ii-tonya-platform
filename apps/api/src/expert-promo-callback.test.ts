import { expect, it, vi } from "vitest";
import { createPromoCallbackAcknowledgement } from "./expert-promo-callback.js";

// Non-production fixture. The literal stays intact; it is not a live bot token.
const SYNTHETIC_FIXTURE_VALUE_1 =
  "123456:synthetic_synthetic_synthetic_synthetic_";

it("acknowledges a promo callback without putting the bot token in the error", async () => {
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response("{}", { status: 200 });
    },
  );
  const acknowledge = createPromoCallbackAcknowledgement({
    botToken: SYNTHETIC_FIXTURE_VALUE_1,
    fetchImpl,
  });
  await acknowledge({ callbackQueryId: "query-1" });
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(String(url)).toContain("/answerCallbackQuery");
  expect(String(url)).not.toContain("callback_query_id");
  expect(init).toMatchObject({ method: "POST" });
  expect(JSON.parse(String(init?.body))).toEqual({
    callback_query_id: "query-1",
  });
  fetchImpl.mockResolvedValueOnce(new Response("no", { status: 502 }));
  await expect(acknowledge({ callbackQueryId: "query-2" })).rejects.toThrow(
    "promo_callback_ack_failed",
  );
});
