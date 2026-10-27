import { readFileSync } from "node:fs";
import { it, expect, vi } from "vitest";
import {
  createExpertCardService,
  type ExpertCardRepository,
  type ExpertCardFinancial,
} from "./expert-card-service.js";
const mock: { id: string; label: string }[] = JSON.parse(
  readFileSync("tests/fixtures/residency-core/mock-hashtags.json", "utf8"),
);
const scope = {
  botId: "11",
  botKey: "work",
  telegramUserId: "33",
  chatId: "33",
};
const workflow = {
  applicationId: mock[0]!.id,
  draftId: mock[0]!.id,
  revision: 0,
  status: "collecting" as const,
  entryCount: 0,
  materialStatus: "none" as const,
  promoConfirmed: false,
};
function fixture() {
  let revision = 0;
  const selected = new Set<string>();
  const repository = {
    getWorkflow: vi.fn(async () => ({ ...workflow, revision })),
    getDraftTags: vi.fn(async () => ({
      revision,
      page: 0,
      pages: 1,
      tags: mock.map((tag) => ({ ...tag, selected: selected.has(tag.id) })),
      tags_array: mock
        .filter((tag) => selected.has(tag.id))
        .map((tag) => tag.label),
    })),
    toggleDraftTag: vi.fn(
      async (i: { tagId: string; expectedRevision: number }) => {
        if (i.expectedRevision !== revision) throw new Error("stale");
        if (selected.has(i.tagId)) selected.delete(i.tagId);
        else selected.add(i.tagId);
        revision++;
        return { ...workflow, revision, replay: false };
      },
    ),
  } as unknown as ExpertCardRepository;
  const service = createExpertCardService({
    enabled: true,
    draftTagsEnabled: true,
    paymentMode: "test",
    workBotId: "11",
    workBotKey: "work",
    workBotUsername: "synthetic_work_bot",
    repository,
    financial: {} as ExpertCardFinancial,
  });
  const input = {
    ...scope,
    updateId: "1",
    requestDigest: "a".repeat(64),
    content: { kind: "text" as const, text: "/tags" },
  };
  return { service, input, repository };
}
it("renders isolated six-row mocks and saves/reloads explicit labels without semantic inference", async () => {
  const f = fixture();
  const menu = await f.service.handleWork(f.input);
  expect(menu.status).toBe("handled");
  if (menu.status !== "handled") throw new Error("menu_missing");
  expect(menu.inlineKeyboard).toHaveLength(6);
  expect(menu.inlineKeyboard?.[0]?.[0]?.text).toBe("#тревога");
  const saved = await f.service.handleWork({
    ...f.input,
    updateId: "2",
    callbackData: menu.inlineKeyboard![0]![0]!.callback_data,
  });
  expect(saved.status).toBe("handled");
  if (saved.status === "handled") expect(saved.text).toContain("1/20");
  const reload = await f.service.handleWork({ ...f.input, updateId: "3" });
  if (reload.status === "handled")
    expect(reload.inlineKeyboard![0]![0]!.text).toBe("✓ #тревога");
  expect(mock).toHaveLength(6);
});
it("gates draft UI and rejects invalid bot/group and malformed callbacks", async () => {
  const f = fixture();
  expect(await f.service.handleWork({ ...f.input, botId: "99" })).toEqual({
    status: "rejected",
  });
  expect(await f.service.handleWork({ ...f.input, chatId: "99" })).toEqual({
    status: "rejected",
  });
  expect(
    await f.service.handleWork({ ...f.input, callbackData: "forged" }),
  ).toEqual({ status: "rejected" });
  const disabled = createExpertCardService({
    enabled: true,
    paymentMode: "test",
    workBotId: "11",
    workBotKey: "work",
    workBotUsername: "synthetic_work_bot",
    repository: f.repository,
    financial: {} as ExpertCardFinancial,
  });
  expect(await disabled.handleWork(f.input)).toMatchObject({
    status: "handled",
    text: "Выбор тегов пока недоступен.",
  });
});
