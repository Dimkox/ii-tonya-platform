import { expect, it, vi } from "vitest";
import { createManagerNotificationTransport } from "./manager-notification-transport.js";
const input = {
  chatId: "123",
  text: "Новая заявка на проверку",
  protectContent: true as const,
  replyMarkup: {
    inline_keyboard: [
      [
        { text: "Одобрить", callback_data: `mt1.${"a".repeat(59)}` },
        { text: "Отклонить", callback_data: `mt1.${"b".repeat(59)}` },
      ],
    ],
  },
};
it("does no I/O while disabled", async () => {
  const fetch = vi.fn();
  await expect(
    createManagerNotificationTransport({
      enabled: false,
      token: "",
      fetch,
    }).sendMessage(input),
  ).rejects.toThrow("disabled");
  expect(fetch).not.toHaveBeenCalled();
});
it("sends a single fixed-origin protected message and validates receipt ownership", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 7,
          from: { id: 42, is_bot: true },
          chat: { id: 123, type: "private" },
        },
      }),
    ),
  );
  expect(
    await createManagerNotificationTransport({
      enabled: true,
      token: `42:${"a".repeat(24)}`,
      fetch,
    }).sendMessage(input),
  ).toEqual({ messageId: "7" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(
    `https://api.telegram.org/bot42:${"a".repeat(24)}/sendMessage`,
    expect.objectContaining({ redirect: "error", method: "POST" }),
  );
});
it("rejects wrong-chat receipt and never retries ambiguous failure", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 7,
          from: { id: 42, is_bot: true },
          chat: { id: 456, type: "private" },
        },
      }),
    ),
  );
  await expect(
    createManagerNotificationTransport({
      enabled: true,
      token: `42:${"a".repeat(24)}`,
      fetch,
    }).sendMessage(input),
  ).rejects.toThrow("uncertain");
  expect(fetch).toHaveBeenCalledOnce();
});
