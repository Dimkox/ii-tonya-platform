import { expect, it } from "vitest";
import {
  createResidentVerificationService,
  type ResidentFormSnapshot,
} from "./resident-verification-service.js";
const id = "11111111-1111-4111-8111-111111111111";
const input = {
  botId: "717171",
  botKey: "fixture",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/verification",
};
it("uses short no-status callbacks at the largest database revision", async () => {
  const s: ResidentFormSnapshot = {
    id,
    formVersion: 2,
    revision: 2147483647,
    currentField: "tax",
    draft: {},
    status: "PENDING_DOCS",
    progress: "FORM_FILLING",
    replay: false,
  };
  const service = createResidentVerificationService({
    enabled: true,
    repository: {
      async mutate() {
        return s;
      },
    },
  });
  const view = await service.handle(input);
  expect(view?.text).toContain("не является причиной отказа");
  if (view?.status !== "handled") throw Error("expected_handled");
  const buttons = (
    view!.replyMarkup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    }
  ).inline_keyboard.flat();
  expect(
    buttons
      .find((b) => b.text.includes("без статуса"))
      ?.callback_data.endsWith(":t:n"),
  ).toBe(true);
  expect(buttons.every((b) => Buffer.byteLength(b.callback_data) <= 64)).toBe(
    true,
  );
});
it("renders the actual owner request deadline and request-bound answer commands", async () => {
  const requestId = "22222222-2222-4222-8222-222222222222";
  const s: ResidentFormSnapshot = {
    id,
    formVersion: 2,
    revision: 3,
    draft: {},
    status: "INFO_REQUESTED",
    progress: "MANAGER_REVIEW",
    replay: false,
    activeRequestId: requestId,
    informationRequest: {
      id: requestId,
      questions: ["Опыт?"],
      deadline: "2026-10-28T10:00:00Z",
      remainingSeconds: 60,
    },
  };
  const calls: unknown[] = [];
  const service = createResidentVerificationService({
    enabled: true,
    repository: {
      async mutate(v) {
        calls.push(v);
        return s;
      },
    },
  });
  const view = await service.handle(input);
  expect(view!.text).toContain("28.10.2026");
  expect(view!.text).toContain("Осталось 1 мин.");
  await service.handle({
    ...input,
    updateId: 2,
    text: `/answer ${requestId} 1 Пять лет`,
  });
  expect(calls.at(-1)).toMatchObject({
    action: "followup",
    requestId,
    questionNumber: 1,
    answer: "Пять лет",
  });
});
it("keeps every role, primary, category, amenity and document edit callback within 64 UTF-8 bytes", async () => {
  const { residentRoles, residentDocumentFields, residentV2TextFields } =
    await import("@ii-tonya/domain");
  for (const currentField of [
    "roles",
    "primaryRole",
    "category",
    "amenities",
    ...residentDocumentFields,
    ...residentV2TextFields,
  ] as const) {
    const snapshot: ResidentFormSnapshot = {
      id,
      formVersion: 2,
      revision: 2147483647,
      currentField,
      draft: { roles: [...residentRoles] },
      status: "PENDING_DOCS",
      progress: "FORM_FILLING",
      replay: false,
    };
    const service = createResidentVerificationService({
      enabled: true,
      repository: {
        async mutate() {
          return snapshot;
        },
      },
    });
    const view = await service.handle(input);
    if (view?.status !== "handled") throw Error("expected_handled");
    const buttons =
      (
        view?.replyMarkup as { inline_keyboard?: { callback_data: string }[][] }
      )?.inline_keyboard?.flat() ?? [];
    for (const b of buttons)
      expect(
        Buffer.byteLength(b.callback_data),
        `${currentField}: ${b.callback_data}`,
      ).toBeLessThanOrEqual(64);
  }
});
it("lets an education project skip its optional licence cursor", async () => {
  const calls: unknown[] = [];
  const snapshot: ResidentFormSnapshot = {
    id,
    formVersion: 2,
    revision: 5,
    currentField: "licence",
    draft: { roles: ["EDU_PROJECT"] },
    status: "PENDING_DOCS",
    progress: "FORM_FILLING",
    replay: false,
  };
  const service = createResidentVerificationService({
    enabled: true,
    repository: {
      async mutate(v) {
        calls.push(v);
        return snapshot;
      },
    },
  });
  await service.handle({ ...input, text: "", callbackData: `rv:${id}:5:back` });
  expect(calls).toEqual(
    expect.arrayContaining([expect.objectContaining({ action: "question" })]),
  );
});
