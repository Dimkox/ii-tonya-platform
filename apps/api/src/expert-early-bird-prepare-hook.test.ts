import { expect, it, vi } from "vitest";
import { afterEarlyBirdChoice } from "./expert-early-bird-prepare-hook.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "",
  offerId: "offer",
  revision: 1,
  choice: "now" as const,
};
it("stays pending without a composed preparation authority", async () => {
  expect(await afterEarlyBirdChoice(input, "choice", false)).toEqual({
    kind: "pending",
  });
});
it("keeps onboarding form first and never prepares a later choice", async () => {
  const prepare = vi.fn();
  expect(
    await afterEarlyBirdChoice(input, "choice", true, { prepare }),
  ).toEqual({ kind: "form" });
  expect(
    await afterEarlyBirdChoice({ ...input, choice: "later" }, "choice", false, {
      prepare,
    }),
  ).toEqual({ kind: "pending" });
  expect(prepare).not.toHaveBeenCalled();
});
it("passes verified choice scope to the prepared authority and does not claim an invoice", async () => {
  const prepare = vi.fn(async () => ({ kind: "prepared" as const }));
  expect(
    await afterEarlyBirdChoice(input, "choice", false, { prepare }),
  ).toEqual({ kind: "pending" });
  expect(prepare).toHaveBeenCalledWith({ ...input, choiceId: "choice" });
  expect(
    await afterEarlyBirdChoice(input, "choice", false, { prepare }),
  ).toEqual({ kind: "pending" });
  expect(prepare).toHaveBeenCalledTimes(2);
});
it("propagates preparation errors to the existing service error handler", async () => {
  const prepare = vi.fn(async () => {
    throw new Error("private");
  });
  await expect(
    afterEarlyBirdChoice(input, "choice", false, { prepare }),
  ).rejects.toThrow("private");
});
it("returns a prepared provider invoice to the existing validated rendering path", async () => {
  const invoice = {
    kind: "invoice" as const,
    purpose: "combined" as const,
    url: "https://yoomoney.ru/checkout",
    totalMinor: "3000",
    onboardingMinor: "1000",
    subscriptionMinor: "2000",
    clientStart: "2027-01-10T21:00:00.000Z",
  };
  expect(
    await afterEarlyBirdChoice(input, "choice", false, {
      prepare: async () => invoice,
    }),
  ).toEqual(invoice);
});
it("invokes the deferred preparer only for the later choice after form completion", async () => {
  const prepare = vi.fn(async () => ({ kind: "prepared" as const }));
  expect(
    await afterEarlyBirdChoice(
      { ...input, choice: "later" },
      "choice",
      false,
      undefined,
      { prepare },
    ),
  ).toEqual({ kind: "pending" });
  expect(prepare).toHaveBeenCalledWith({
    ...input,
    choice: "later",
    choiceId: "choice",
  });
});
