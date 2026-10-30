import { expect, it, vi } from "vitest";
import { createEarlyBirdReceiptAuthority } from "./expert-early-bird-receipt-authority.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 42,
  text: "",
};
const scope = { ...input, offerId: "offer", choiceId: "choice" };
it("captures contact and immediately invokes the concrete preparer on the authorized choice", async () => {
  const source = { resolveCurrent: vi.fn(async () => scope) };
  const contacts = {
    capture: vi.fn(async () => ({ id: "contact", expiresAt: "date" })),
  };
  const prepare = vi.fn(async () => ({ kind: "prepared" as const }));
  const authority = createEarlyBirdReceiptAuthority({
    source,
    contacts,
    prepare: { prepare },
  });
  expect(await authority.captureReceipt(input, "fixture@example.invalid")).toBe(
    true,
  );
  expect(contacts.capture).toHaveBeenCalledWith(
    scope,
    "fixture@example.invalid",
    "wave-receipt:1:42",
  );
  expect(prepare).toHaveBeenCalledWith(scope);
});
it("does not capture or prepare when no approved wave scope exists", async () => {
  const capture = vi.fn(),
    prepare = vi.fn();
  const authority = createEarlyBirdReceiptAuthority({
    source: { resolveCurrent: async () => null },
    contacts: { capture },
    prepare: { prepare },
  });
  expect(await authority.captureReceipt(input, "fixture@example.invalid")).toBe(
    false,
  );
  expect(capture).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
it("returns a ready combined invoice immediately after receipt capture", async () => {
  const invoice = {
    kind: "invoice" as const,
    purpose: "combined" as const,
    url: "https://yoomoney.ru/checkout",
    totalMinor: "3000",
    onboardingMinor: "1000",
    subscriptionMinor: "2000",
    clientStart: "2027-01-10T21:00:00.000Z",
  };
  const authority = createEarlyBirdReceiptAuthority({
    source: { resolveCurrent: async () => scope },
    contacts: { capture: async () => ({ id: "contact", expiresAt: "date" }) },
    prepare: { prepare: async () => invoice },
  });
  expect(
    await authority.captureReceipt(input, "fixture@example.invalid"),
  ).toEqual(invoice);
});
