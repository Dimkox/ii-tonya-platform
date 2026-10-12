import { expect, it, vi } from "vitest";
import { createBookingCallbackAck } from "./booking-callback-ack.js";

it("sends only callback ID to the fixed Telegram endpoint with caller cancellation", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 200 }));
  const ack = createBookingCallbackAck("123:synthetic_token", fetcher);
  const signal = new AbortController().signal;
  await ack({ callbackQueryId: "query-7", signal });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "https://api.telegram.org/bot123:synthetic_token/answerCallbackQuery",
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: "query-7" }),
    },
  );
});

it.each(["", "123:x/redirect", "123:x?secret", "123:x\n"])(
  "rejects unsafe token without HTTP",
  (token) => {
    const fetcher = vi.fn();
    expect(() => createBookingCallbackAck(token, fetcher)).toThrow(
      "booking_callback_ack_configuration_invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("does not retry or expose network errors", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("secret-network-detail");
  });
  const ack = createBookingCallbackAck("123:synthetic_token", fetcher);
  await expect(
    ack({ callbackQueryId: "query", signal: new AbortController().signal }),
  ).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels the unused response stream", async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn(
    async () => new Response(new ReadableStream({ cancel })),
  );
  await createBookingCallbackAck(
    "123:synthetic_token",
    fetcher,
  )({ callbackQueryId: "query", signal: new AbortController().signal });
  expect(cancel).toHaveBeenCalledTimes(1);
});
