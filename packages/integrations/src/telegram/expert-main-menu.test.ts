import { describe, expect, it, vi } from "vitest";

import {
  createExpertCommandProcessor,
  parseExpertMenuAction,
} from "./expert-command-processor.js";
import { EXPERT_MAIN_MENU, EXPERT_MENU_STUB_TEXT } from "./telegram-adapter.js";

const principal = {
  userId: "00000000-0000-4000-8000-000000000100",
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};
const applied = { kind: "applied" as const, providerOperationId: "m-1" };

const build = () => {
  const views = {
    sendQuerySchedule: vi.fn(async () => applied),
    sendClientChoices: vi.fn(async () => applied),
    sendClientView: vi.fn(async () => applied),
    sendStats: vi.fn(async () => applied),
    sendUnsupported: vi.fn(async () => applied),
    answerCallbackQuery: vi.fn(async () => applied),
    sendMainMenu: vi.fn(async () => applied),
    sendMenuStub: vi.fn(async () => applied),
    sendReferralSummary: vi.fn(async () => applied),
  };
  const queries = {
    schedule: vi.fn(async () => ({
      timezone: "Europe/Moscow",
      appointments: [],
    })),
    clientChoices: vi.fn(async () => []),
    stats: vi.fn(async () => ({
      upcoming: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    })),
    clientView: vi.fn(),
  };
  const processor = createExpertCommandProcessor({
    enabled: true,
    queries: queries as never,
    views: views as never,
  });
  return { processor, views, queries };
};
const base = { principal, idempotencyKey: "k", correlationId: "c" };

describe("BOT-03.2 expert main menu", () => {
  it("has the exact navigation keyboard", () => {
    expect(EXPERT_MAIN_MENU.map((b) => b.text)).toEqual([
      "Мои брони",
      "Добавить слот",
      "Мой баланс",
      "Поддержка",
    ]);
    for (const b of EXPERT_MAIN_MENU)
      expect(parseExpertMenuAction(b.callback_data)).not.toBeNull();
    expect(parseExpertMenuAction("em1.other")).toBeNull();
  });

  it("/start sends the main menu", async () => {
    const { processor, views } = build();
    const result = await processor.processCommand({
      ...base,
      text: "/start",
      chatType: "private",
    });
    expect(result.kind).toBe("processed");
    expect(views.sendMainMenu).toHaveBeenCalledWith({
      idempotencyKey: "k",
      telegramUserId: principal.telegramUserId,
    });
  });

  it("Мои брони reads only the own schedule", async () => {
    const { processor, queries, views } = build();
    await processor.processMenuAction({ ...base, action: "bookings" });
    expect(queries.schedule).toHaveBeenCalledWith(principal);
    expect(views.sendQuerySchedule).toHaveBeenCalledTimes(1);
  });

  it("Мой баланс uses /referral and stays unsupported while financial views are off", async () => {
    const { processor, views } = build();
    const result = await processor.processMenuAction({
      ...base,
      action: "balance",
    });
    expect(result.kind).toBe("unsupported");
    expect(views.sendUnsupported).toHaveBeenCalledTimes(1);
  });

  it.each(["slot", "support"] as const)(
    "%s replies with the stub and no server mutation",
    async (action) => {
      const { processor, views, queries } = build();
      const result = await processor.processMenuAction({ ...base, action });
      expect(result.kind).toBe("processed");
      expect(views.sendMenuStub).toHaveBeenCalledTimes(1);
      expect(EXPERT_MENU_STUB_TEXT).toBe("скоро");
      expect(queries.schedule).not.toHaveBeenCalled();
    },
  );
});
