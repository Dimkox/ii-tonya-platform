import { expect, it, vi } from "vitest";
import { createResidentReviewNotificationTransport } from "./resident-review-notification-transport.js";
const options = { token: `717171:${"A".repeat(35)}`, botKey: "synthetic" };
const input = {
  botId: "717171",
  botKey: "synthetic",
  chatId: "123",
  text: "Здравствуйте! 1. Опыт? <plain>",
  signal: new AbortController().signal,
};
it("sends exact plain text once to the fixed endpoint and checks the private receipt", async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: "123",
      text: input.text,
      protect_content: true,
    });
    expect(init?.redirect).toBe("error");
    return Response.json({
      ok: true,
      result: {
        message_id: 321,
        from: { id: 717171, is_bot: true },
        chat: { id: 123, type: "private" },
      },
    });
  });
  const transport = createResidentReviewNotificationTransport({
    ...options,
    fetch: fetcher,
  });
  expect(await transport.send(input)).toEqual({
    botId: "717171",
    chatId: "123",
    messageId: "321",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.telegram.org/bot${options.token}/sendMessage`,
  );
});
it("rejects wrong original custody and oversized text without any send", async () => {
  const fetcher = vi.fn();
  const transport = createResidentReviewNotificationTransport({
    ...options,
    fetch: fetcher,
  });
  for (const change of [
    { botId: "999" },
    { botKey: "other" },
    { chatId: "-123" },
    { text: "я".repeat(4097) },
  ])
    await expect(transport.send({ ...input, ...change })).rejects.toThrow(
      "resident_review_transport_request_invalid",
    );
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps foreign/oversized receipts uncertain and never retries", async () => {
  for (const response of [
    Response.json({
      ok: true,
      result: {
        message_id: 1,
        from: { id: 717171, is_bot: true },
        chat: { id: 999, type: "private" },
      },
    }),
    new Response(" ".repeat(16385)),
  ]) {
    const fetcher = vi.fn(async () => response);
    await expect(
      createResidentReviewNotificationTransport({
        ...options,
        fetch: fetcher,
      }).send(input),
    ).rejects.toThrow("resident_review_transport_delivery_uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
