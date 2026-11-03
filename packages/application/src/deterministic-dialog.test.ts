import { describe, expect, it, vi } from "vitest";
import { createConversationService } from "./conversation-service.js";
import { conversationFixture } from "./conversation-service.testkit.js";
import {
  MENU_DIALOG_TEXT,
  createKeywordSafetyGuard,
  createMenuIntentEngine,
  createMenuTypedSafety,
  proposeMenuIntent,
} from "./deterministic-dialog.js";
import type { IntentInput } from "./ports.js";

const intentInput = (
  text: string,
  scope: Partial<IntentInput["authorization"]> = {},
): IntentInput => ({
  text,
  locale: "ru-RU",
  userId: "user-1",
  correlationId: "c-1",
  dataSubjectUserId: "user-1",
  authorization: {
    allowedExpertIds: [],
    allowedServiceCodes: ["consultation"],
    ...scope,
  } as IntentInput["authorization"],
});

describe("deterministic client dialog", () => {
  it.each([
    ["/start", { kind: "answer", text: MENU_DIALOG_TEXT.menu }],
    ["Привет", { kind: "answer", text: MENU_DIALOG_TEXT.menu }],
    ["Каталог", { kind: "show_catalog" }],
    [
      "услуга consultation",
      { kind: "show_catalog", serviceCode: "consultation" },
    ],
    ["хочу записаться", { kind: "answer", text: MENU_DIALOG_TEXT.booking }],
    ["удалить мои данные", { kind: "answer", text: MENU_DIALOG_TEXT.privacy }],
    [
      "позовите оператора",
      { kind: "human_handoff", reasonCode: "client_requested_human" },
    ],
    ["что-то непонятное", { kind: "answer", text: MENU_DIALOG_TEXT.fallback }],
  ])("maps %s to a fixed menu intent", (text, expected) => {
    expect(proposeMenuIntent(intentInput(text))).toEqual(expected);
  });

  it("starts booking only for a single authorized expert", () => {
    expect(
      proposeMenuIntent(intentInput("запись", { allowedExpertIds: ["e-1"] })),
    ).toEqual({ kind: "start_booking", expertId: "e-1" });
    expect(
      proposeMenuIntent(
        intentInput("запись", { allowedExpertIds: ["e-1", "e-2"] }),
      ).kind,
    ).toBe("answer");
  });

  it.each([
    ["Не хочу жить", "self_harm"],
    ["меня избивает муж", "abuse"],
    ["какая дозировка таблеток", "medical"],
    ["SOS", "urgent"],
    ["запишите меня", null],
  ])("keyword guard flags %s as %s", (text, risk) => {
    expect(createKeywordSafetyGuard().detect(text)).toBe(risk);
  });

  it("keeps the LLM hook off unless explicitly enabled", async () => {
    const llm = {
      intent: {
        propose: vi.fn(async () => ({ kind: "show_catalog" as const })),
      },
      safety: { classify: vi.fn(async () => "self_harm" as const) },
    };
    await expect(
      createMenuIntentEngine({ llm }).propose(intentInput("привет")),
    ).resolves.toEqual({ kind: "answer", text: MENU_DIALOG_TEXT.menu });
    await expect(createMenuTypedSafety({ llm }).classify("x")).resolves.toBe(
      "ordinary",
    );
    expect(llm.intent.propose).not.toHaveBeenCalled();
    await expect(
      createMenuIntentEngine({ llm, llmEnabled: true }).propose(
        intentInput("привет"),
      ),
    ).resolves.toEqual({ kind: "show_catalog" });
  });

  it("every menu text passes the client copy guard end to end", async () => {
    for (const text of ["/start", "данные", "непонятно"]) {
      const deps = conversationFixture({ balance: 1, safety: "ordinary" });
      const service = createConversationService({
        ...deps,
        deterministicSafety: createKeywordSafetyGuard(),
        typedSafety: createMenuTypedSafety(),
        intentEngine: createMenuIntentEngine(),
      });
      await expect(
        service.handleInbound({ ...deps.inbound, text }),
      ).resolves.toMatchObject({ kind: "answer_queued" });
    }
  });

  it("routes crisis keywords to a human handoff, not the menu", async () => {
    const deps = conversationFixture({ balance: 1, safety: "ordinary" });
    const propose = vi.fn();
    const service = createConversationService({
      ...deps,
      deterministicSafety: createKeywordSafetyGuard(),
      typedSafety: createMenuTypedSafety(),
      intentEngine: { propose },
    });
    const result = await service.handleInbound({
      ...deps.inbound,
      text: "я не хочу жить",
    });
    expect(result.kind).toBe("human_handoff");
    expect(propose).not.toHaveBeenCalled();
  });
});
