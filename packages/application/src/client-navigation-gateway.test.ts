import { expect, it, vi } from "vitest";
import { ClientNavigationGateway } from "./client-navigation-gateway.js";

const refusal =
  "Персональный диалог здесь пока недоступен. Не присылай личную историю, сведения о здоровье, документы или данные других людей. Каталог и личный кабинет доступны по ссылкам ниже.";
const update = (message: Record<string, unknown> = {}) => ({
  update_id: 7,
  message: {
    chat: { id: 123, type: "private" },
    from: { id: 123, is_bot: false },
    text: "/start",
    ...message,
  },
});
const setup = (result: unknown = "recorded") => {
  const record = vi.fn(async () => result as "recorded" | "duplicate");
  const gateway = new ClientNavigationGateway({
    botId: "123456",
    origin: "https://client.example",
    replay: { record, hasReceipt: vi.fn() },
  });
  return { gateway, record };
};
it.each(["/start", "/help", "/catalog", "/privacy", "/account"])(
  "returns only fixed navigation for exact %s without identity or consent ports",
  async (text) => {
    const f = setup();
    const result = await f.gateway.handle(update({ text }));
    expect(result.status).toBe("reply");
    if (result.status !== "reply") throw new Error("expected reply");
    expect(result.reply).toMatchObject({
      method: "sendMessage",
      chat_id: 123,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Каталог", url: "https://client.example/catalog" }],
          [
            {
              text: "Личный кабинет",
              web_app: { url: "https://client.example/account" },
            },
          ],
          [
            {
              text: "Политика конфиденциальности",
              url: "https://client.example/privacy",
            },
          ],
        ],
      },
    });
    expect(result.reply.text).not.toBe(refusal);
    expect(result.reply.text).toContain(
      "Не присылай личную историю, сведения о здоровье, документы или данные других людей.",
    );
    expect(result.reply).not.toHaveProperty("parse_mode");
    expect(f.record).toHaveBeenCalledExactlyOnceWith({
      botId: "123456",
      updateId: 7,
    });
  },
);
it.each([
  { text: "SYNTHETIC_PERSONAL_CANARY" },
  { text: "/start payload" },
  { text: " /start" },
  { text: "/START" },
  { text: "/start@bot" },
  { text: "/help\n" },
  { text: undefined, caption: "SYNTHETIC_PERSONAL_CANARY" },
  { text: undefined, voice: { file_id: "SYNTHETIC_PERSONAL_CANARY" } },
  { text: undefined, document: { file_id: "SYNTHETIC_PERSONAL_CANARY" } },
])("refuses other private content without echo: %j", async (message) => {
  const f = setup();
  const result = await f.gateway.handle(update(message));
  expect(result.status).toBe("reply");
  if (result.status !== "reply") throw new Error("expected reply");
  expect(result.reply.text).toBe(refusal);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PERSONAL_CANARY");
  expect(f.record.mock.calls).toEqual([[{ botId: "123456", updateId: 7 }]]);
});
it.each([
  { forward_origin: { type: "user" } },
  { forward_from: { id: 999 } },
  { forward_sender_name: "private" },
  { forward_date: 123 },
  { sender_chat: { id: 999 } },
  { edit_date: 123 },
  { via_bot: { id: 999 } },
  { from: { id: 124, is_bot: false } },
  { from: { id: 123, is_bot: true } },
  { from: { id: "123", is_bot: false } },
  { from: { id: 123 } },
  { chat: { id: 123, type: "group" } },
  { chat: { id: -123, type: "private" } },
  { chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" } },
])(
  "receipts but never replies to non-direct/unsafe origins: %j",
  async (message) => {
    const f = setup();
    expect(await f.gateway.handle(update(message))).toEqual({
      status: "ignored",
    });
    expect(f.record).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "edited_message",
  "channel_post",
  "callback_query",
  "inline_query",
  "unknown",
])("receipts unsupported %s without reading it", async (key) => {
  const f = setup();
  const raw = {
    update_id: 7,
    get [key]() {
      throw new Error("content read");
    },
  };
  expect(await f.gateway.handle(raw)).toEqual({ status: "ignored" });
  expect(f.record).toHaveBeenCalledTimes(1);
});
it("does not inspect even message on duplicate changed body", async () => {
  const f = setup("duplicate");
  expect(
    await f.gateway.handle({
      update_id: 7,
      get message() {
        throw new Error("content read");
      },
    }),
  ).toEqual({ status: "duplicate" });
});
it.each([
  null,
  [],
  {},
  { update_id: "7" },
  { update_id: -1 },
  { update_id: 1.5 },
  { update_id: Infinity },
  { update_id: Number.MAX_SAFE_INTEGER + 1 },
])("rejects unsafe update IDs before persistence: %j", async (raw) => {
  const f = setup();
  expect(await f.gateway.handle(raw)).toEqual({ status: "invalid" });
  expect(f.record).not.toHaveBeenCalled();
});
it.each([0, Number.MAX_SAFE_INTEGER])(
  "receipts valid boundary update %s",
  async (update_id) => {
    const f = setup();
    expect((await f.gateway.handle({ ...update(), update_id })).status).toBe(
      "reply",
    );
    expect(f.record).toHaveBeenCalledWith({
      botId: "123456",
      updateId: update_id,
    });
  },
);
it.each([undefined, null, "unknown"])(
  "fails closed on unknown storage result %s",
  async (value) => {
    const f = setup();
    f.record.mockResolvedValue(value as "recorded");
    expect(await f.gateway.handle(update())).toEqual({ status: "unavailable" });
  },
);
it("sanitizes storage failure before reading personal content", async () => {
  const f = setup();
  f.record.mockRejectedValue(new Error("SYNTHETIC_PERSONAL_CANARY"));
  expect(
    await f.gateway.handle({
      update_id: 7,
      get message() {
        throw new Error("content read");
      },
    }),
  ).toEqual({ status: "unavailable" });
});
