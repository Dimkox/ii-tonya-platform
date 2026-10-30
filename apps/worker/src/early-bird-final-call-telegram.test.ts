import { expect, it, vi } from "vitest";
import { createFinalCallTelegramTransport } from "./early-bird-final-call-telegram.js";
const input = () => ({
  chatId: "123",
  text: "Оплатите тариф до 10 января",
  replyMarkup: {
    inline_keyboard: [
      [
        {
          text: "Оплатить тариф",
          callback_data:
            "eb:00000000-0000-4000-8000-000000000001:1:subscription",
        },
      ],
    ],
  },
  signal: new AbortController().signal,
});
const payload = (chat = "123") => ({
  ok: true,
  result: {
    message_id: 42,
    from: { id: 999, is_bot: true },
    chat: { id: chat, type: "private" },
  },
});
it("uses one fixed-origin bounded request and verifies the recipient", async () => {
  const http = vi.fn<typeof fetch>(async () => Response.json(payload()));
  const transport = createFinalCallTelegramTransport({
    token: `999:${"a".repeat(30)}`,
    fetch: http,
  });
  expect(await transport.send(input())).toEqual({ messageId: "42" });
  expect(http).toHaveBeenCalledTimes(1);
  const [url, options] = http.mock.calls[0]!;
  expect(url).toBe(
    `https://api.telegram.org/bot999:${"a".repeat(30)}/sendMessage`,
  );
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(String(options?.body))).toMatchObject({
    chat_id: "123",
    protect_content: true,
  });
  const wrong = createFinalCallTelegramTransport({
    token: `999:${"a".repeat(30)}`,
    fetch: async () => Response.json(payload("456")),
  });
  await expect(wrong.send(input())).rejects.toThrow(
    "early_bird_final_call_transport_delivery_uncertain",
  );
});
it("rejects an aborted send, oversized provider response and unsafe callback without retry", async () => {
  const http = vi.fn<typeof fetch>(async () => new Response("x".repeat(16385)));
  const transport = createFinalCallTelegramTransport({
    token: `999:${"a".repeat(30)}`,
    fetch: http,
  });
  const stopped = new AbortController();
  stopped.abort();
  await expect(
    transport.send({ ...input(), signal: stopped.signal }),
  ).rejects.toThrow("request_invalid");
  expect(http).not.toHaveBeenCalled();
  const bad = input();
  bad.replyMarkup.inline_keyboard[0]![0]!.callback_data =
    "https://attacker.invalid";
  await expect(transport.send(bad)).rejects.toThrow("request_invalid");
  expect(http).not.toHaveBeenCalled();
  await expect(transport.send(input())).rejects.toThrow("delivery_uncertain");
  expect(http).toHaveBeenCalledTimes(1);
});
it("aborts a stalled network request at the transport deadline without retry", async () => {
  const http = vi.fn<typeof fetch>(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("synthetic network aborted")),
          { once: true },
        );
      }),
  );
  const transport = createFinalCallTelegramTransport({
    token: `999:${"a".repeat(30)}`,
    fetch: http,
  });
  await expect(transport.send(input())).rejects.toThrow(
    "early_bird_final_call_transport_delivery_uncertain",
  );
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]![1]?.signal?.aborted).toBe(true);
}, 12000);
