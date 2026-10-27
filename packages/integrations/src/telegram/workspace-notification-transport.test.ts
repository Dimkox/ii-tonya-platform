import { it, expect, vi } from "vitest";
import { createWorkspaceNotificationTransport } from "./workspace-notification-transport.js";
const options = {
  token: `12345:${"synthetic_fixture_".repeat(2)}`,
  botKey: "promo",
  workBotUsername: "synthetic_work_bot",
};
const request = {
  botId: "12345",
  botKey: "promo",
  chatId: "222",
  text: `Доступ открыт! Перейдите в рабочий кабинет: https://t.me/synthetic_work_bot?start=card_${"x".repeat(43)}`,
  signal: new AbortController().signal,
};
it("sends a protected owner-bound URL once and validates the actual receipt", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 123,
            from: { id: 12345, is_bot: true },
            chat: { id: 222, type: "private" },
          },
        }),
      ),
  );
  const transport = createWorkspaceNotificationTransport({
    ...options,
    fetch: fetcher,
  });
  expect(await transport.send(request)).toEqual({
    botId: "12345",
    chatId: "222",
    messageId: "123",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(transport.send({ ...request, botId: "999" })).rejects.toThrow(
    "workspace_transport_request_invalid",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects ambiguous, oversized and foreign receipts without leaking token or provider errors", async () => {
  for (const response of [
    new Response("PRIVATE_SENTINEL", { status: 503 }),
    new Response("x".repeat(20000)),
    new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 1,
          from: { id: 12345, is_bot: true },
          chat: { id: 999, type: "private" },
        },
      }),
    ),
  ]) {
    const fetcher = vi.fn(async () => response);
    const transport = createWorkspaceNotificationTransport({
      ...options,
      fetch: fetcher,
    });
    await expect(transport.send(request)).rejects.toThrow(
      "workspace_transport_delivery_uncertain",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
