import { expect, it, vi } from "vitest";
import {
  combineEarlyBirdNowAuthorities,
  combineEarlyBirdNowReceiptAuthorities,
} from "./expert-early-bird-now-router.js";
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
  choiceId: "choice",
};
it("falls through to standard only when owner is unavailable", async () => {
  const owner = {
    prepare: vi.fn(async () => ({ kind: "unavailable" as const })),
  };
  const standard = {
    prepare: vi.fn(async () => ({ kind: "prepared" as const })),
  };
  const combined = combineEarlyBirdNowAuthorities(owner, standard);
  expect(await combined.prepare(input)).toEqual({ kind: "prepared" });
  expect(standard.prepare).toHaveBeenCalledWith(input);
});
it("never creates a standard intent after owner prepared", async () => {
  const standard = { prepare: vi.fn() };
  const combined = combineEarlyBirdNowAuthorities(
    { prepare: async () => ({ kind: "prepared" }) },
    standard,
  );
  expect(await combined.prepare(input)).toEqual({ kind: "prepared" });
  expect(standard.prepare).not.toHaveBeenCalled();
});

it("routes receipt to standard only when owner does not own the scope", async () => {
  const owner = { captureReceipt: vi.fn(async () => false) };
  const standard = { captureReceipt: vi.fn(async () => true) };
  const router = combineEarlyBirdNowReceiptAuthorities(owner, standard);
  expect(await router.captureReceipt(input, "fixture@example.invalid")).toBe(
    true,
  );
  expect(standard.captureReceipt).toHaveBeenCalledTimes(1);
});
