import { expect, it, vi } from "vitest";
import { createLaunchKitTelegramTransport } from "./early-bird-launch-kit-telegram.js";
import { LAUNCH_KIT_BANNER } from "./early-bird-launch-kit-content.js";
const token = `999:${"a".repeat(30)}`;
const receipt = (id: number, chat = 123) =>
  Response.json({
    ok: true,
    result: {
      message_id: id,
      from: { id: 999, is_bot: true },
      chat: { id: chat, type: "private" },
    },
  });
it("sends forwardable text and the original SVG through two fixed-origin requests", async () => {
  let i = 0;
  const http = vi.fn<typeof fetch>(async () => receipt(++i));
  const transport = createLaunchKitTelegramTransport({ token, fetch: http });
  expect(
    await transport.send({
      chatId: "123",
      signal: new AbortController().signal,
    }),
  ).toEqual({ messageIds: ["1", "2"] });
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls[0]![0]).toBe(
    `https://api.telegram.org/bot${token}/sendMessage`,
  );
  expect(JSON.parse(String(http.mock.calls[0]![1]!.body))).toMatchObject({
    chat_id: "123",
    protect_content: false,
  });
  expect(http.mock.calls[1]![0]).toBe(
    `https://api.telegram.org/bot${token}/sendDocument`,
  );
  const form = http.mock.calls[1]![1]!.body as FormData;
  expect(form.get("protect_content")).toBe("false");
  expect(await (form.get("document") as Blob).text()).toBe(LAUNCH_KIT_BANNER);
});
it("does not retry a partially delivered kit and rejects another recipient", async () => {
  let i = 0;
  const http = vi.fn<typeof fetch>(async () => {
    if (++i === 1) return receipt(1);
    throw new Error("syntheticunknown");
  });
  await expect(
    createLaunchKitTelegramTransport({ token, fetch: http }).send({
      chatId: "123",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("delivery_uncertain");
  expect(http).toHaveBeenCalledTimes(2);
  const wrong = vi.fn<typeof fetch>(async () => receipt(1, 456));
  await expect(
    createLaunchKitTelegramTransport({ token, fetch: wrong }).send({
      chatId: "123",
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("delivery_uncertain");
  expect(wrong).toHaveBeenCalledTimes(1);
});
it("an aborted job sends no message", async () => {
  const http = vi.fn<typeof fetch>();
  const stop = new AbortController();
  stop.abort();
  await expect(
    createLaunchKitTelegramTransport({ token, fetch: http }).send({
      chatId: "123",
      signal: stop.signal,
    }),
  ).rejects.toThrow("delivery_uncertain");
  expect(http).not.toHaveBeenCalled();
});
