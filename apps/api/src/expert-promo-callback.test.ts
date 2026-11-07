import { expect, it, vi } from "vitest";
import { createPromoCallbackAcknowledgement } from "./expert-promo-callback.js";

const token = `123456:${"synthetic_".repeat(4)}`;

it("acknowledges a promo callback without putting the bot token in the error", async () => {
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
  const acknowledge = createPromoCallbackAcknowledgement({
    botToken: token,
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
