import { describe, expect, it, vi } from "vitest";
import { handleTelegramDeletion } from "./telegram-deletion.js";
const update = (message = {}) => ({
  update_id: 7,
  message: {
    text: "/delete_data",
    from: { id: 42, is_bot: false },
    chat: { id: 42, type: "private" },
    ...message,
  },
});
const view = {
  requestId: "request",
  requestedAt: "2026-10-23T00:00:00Z",
  stage: "awaiting_execution" as const,
  retainedFacts: null,
};
function fixture() {
  return {
    request: vi.fn<
      NonNullable<Parameters<typeof handleTelegramDeletion>[1]>["request"]
    >(async () => ({ kind: "accepted", request: view })),
  };
}
describe("Telegram deletion boundary", () => {
  it("passes the stable Telegram update identity to atomic acceptance on retry", async () => {
    const deps = fixture();
    const first = await handleTelegramDeletion(update(), deps);
    expect(first).toMatchObject({
      kind: "reply",
      reply: { method: "sendMessage", chat_id: "42" },
    });
    expect(JSON.stringify(first)).toContain("Запрос на удаление принят");
    expect(await handleTelegramDeletion(update(), deps)).toEqual(first);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(deps.request.mock.calls[0]?.[0]).toEqual({
      telegramUserId: "42",
      chatId: "42",
      updateId: "7",
    });
  });
  it.each([
    { chat: { id: 42, type: "group" } },
    { chat: { id: 99, type: "private" } },
    { from: { id: 42, is_bot: true } },
    { forward_origin: {} },
    { forward_from: {} },
    { sender_chat: {} },
  ])("rejects forged message %j", async (message) => {
    const deps = fixture();
    expect(await handleTelegramDeletion(update(message), deps)).toEqual({
      kind: "denied",
    });
    expect(deps.request).not.toHaveBeenCalled();
  });
  it("fails closed when capability or authenticated identity is absent", async () => {
    expect(await handleTelegramDeletion(update())).toEqual({
      kind: "unavailable",
    });
    const deps = fixture();
    deps.request.mockResolvedValueOnce({ kind: "unavailable" });
    expect(await handleTelegramDeletion(update(), deps)).toEqual({
      kind: "unavailable",
    });
    expect(deps.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    "/delete_data other",
    "/delete_data@bot",
    " /delete_data",
    "/delete_data\n",
  ])("requires exact command %j", async (text) => {
    expect(await handleTelegramDeletion(update({ text }))).toEqual({
      kind: "unhandled",
    });
  });
  it("contains atomic-boundary failures without disclosing arbitrary errors", async () => {
    const deps = fixture();
    deps.request.mockRejectedValueOnce(new Error("SECRET"));
    expect(await handleTelegramDeletion(update(), deps)).toEqual({
      kind: "unavailable",
    });
  });
});
