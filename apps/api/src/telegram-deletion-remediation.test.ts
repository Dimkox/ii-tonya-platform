import { expect, it, vi } from "vitest";
import { handleTelegramDeletion } from "./telegram-deletion.js";
import { createTelegramDeletionCapability } from "./telegram-deletion-composition.js";
const payload = {
  update_id: 10,
  message: {
    text: "/delete_data",
    from: { id: 42, is_bot: false },
    chat: { id: 42, type: "private" },
  },
};
it.each([
  ["completed", "проверка резервных копий подтверждена"],
  ["needs_attention", "требует внимания"],
  ["deleting", "Удаление выполняется"],
  ["awaiting_backup", "Проверка резервных копий ещё ожидается"],
] as const)("renders verified %s stage truthfully", async (stage, wording) => {
  const result = await handleTelegramDeletion(payload, {
    request: async () => ({
      kind: "accepted",
      request: {
        requestId: "request",
        requestedAt: "2026-10-23T00:00:00Z",
        stage,
        retainedFacts: null,
      },
    }),
  });
  expect(result.kind).toBe("reply");
  expect(JSON.stringify(result)).toContain(wording);
  expect(JSON.stringify(result)).not.toContain("Выполнение ещё ожидается");
});
it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10", undefined])(
  "rejects malformed update identity %j before atomic authority",
  async (update_id) => {
    const request = vi.fn();
    expect(
      await handleTelegramDeletion({ ...payload, update_id }, { request }),
    ).toEqual({ kind: "denied" });
    expect(request).not.toHaveBeenCalled();
  },
);
it("does not compose with disabled flags, absent bot binding or weak receipt key", () => {
  const deps = {
    enabled: true,
    botKey: "bot",
    botId: "999",
    receiptKey: "x".repeat(32),
    repository: { acceptTelegram: vi.fn() },
    service: { readOwned: vi.fn() },
  };
  expect(
    createTelegramDeletionCapability({ ...deps, enabled: false }),
  ).toBeUndefined();
  expect(
    createTelegramDeletionCapability({ ...deps, botKey: undefined }),
  ).toBeUndefined();
  expect(
    createTelegramDeletionCapability({ ...deps, botId: undefined }),
  ).toBeUndefined();
  expect(
    createTelegramDeletionCapability({ ...deps, botId: "not-a-bot" }),
  ).toBeUndefined();
  expect(
    createTelegramDeletionCapability({ ...deps, receiptKey: "weak" }),
  ).toBeUndefined();
});
