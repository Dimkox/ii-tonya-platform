import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createBookingNotificationTransport } from "./booking-notification-transport.js";
const body = '{"chat_id":"201","text":"Запись подтверждена."}';
const grant = () => ({
  attemptId: "11111111-1111-4111-8111-111111111111",
  deliveryId: "22222222-2222-4222-8222-222222222222",
  botKey: "client",
  chatId: "201",
  deadline: new Date(Date.now() + 15000).toISOString(),
  wireVersion: 1 as const,
  body,
  bodySha256: createHash("sha256").update(body).digest("hex"),
});
const fixture = () => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 77,
            from: { id: 123, is_bot: true },
            chat: { id: 201, type: "private" },
          },
        }),
        { status: 200 },
      ),
  );
  return {
    fetcher,
    transport: createBookingNotificationTransport({
      botKey: "client",
      token: `123:${"a".repeat(35)}`,
      fetch: fetcher,
    }),
  };
};
it("passes the exact admitted UTF-8 body to fetch once", async () => {
  const f = fixture();
  expect((await f.transport.sendPrepared(grant())).kind).toBe("applied");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.fetcher.mock.calls[0]?.[1]).toMatchObject({ body });
});
it.each([
  "digest",
  "chat",
  "bot",
  "version",
  "extra",
  "whitespace",
  "malformed",
])("rejects altered %s before HTTP", async (change) => {
  const f = fixture();
  const g = grant();
  if (change === "digest") g.bodySha256 = "0".repeat(64);
  if (change === "chat") g.chatId = "202";
  if (change === "bot") g.botKey = "other";
  if (change === "version") Object.assign(g, { wireVersion: 2 });
  if (change === "extra")
    g.body = '{"chat_id":"201","text":"x","parse_mode":"HTML"}';
  if (change === "whitespace") g.body = " " + g.body;
  if (change === "malformed") g.body = '{"chat_id":';
  if (change === "extra" || change === "whitespace" || change === "malformed")
    g.bodySha256 = createHash("sha256").update(g.body).digest("hex");
  expect(await f.transport.sendPrepared(g)).toEqual({
    kind: "failed",
    reasonCode: "request_invalid",
    pauseBot: false,
  });
  expect(f.fetcher).not.toHaveBeenCalled();
});
