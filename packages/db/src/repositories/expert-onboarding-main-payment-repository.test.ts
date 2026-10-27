import { describe, expect, it, vi } from "vitest";
import {
  parseMainCardCommand,
  PostgresExpertOnboardingMainPaymentRepository,
} from "./expert-onboarding-main-payment-repository.js";
const id = "00000000-0000-4000-8000-000000000001";
const scope = {
  botId: "123",
  botKey: "work-fixture",
  telegramUserId: "456",
  chatId: "456",
  requestKey: "123:10",
  requestDigest: "a".repeat(64),
};
describe("onboarding main command authority", () => {
  it("copies an explicit owner quote acceptance without financial fields", () => {
    const input = { ...scope, quoteId: id, revision: 1 };
    const parsed = parseMainCardCommand(input, "accept");
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    input.quoteId = "changed";
    expect(parsed.quoteId).toBe(id);
  });
  it("requires an explicit1/3 month quote choice", () => {
    expect(
      parseMainCardCommand(
        { ...scope, tariffVersionId: id, termMonths: 3, revision: 1 },
        "quote",
      ),
    ).toMatchObject({ termMonths: 3 });
  });
  it.each([0, 2, 12, 1.5])("rejects unsupported term%s", (termMonths) => {
    expect(() =>
      parseMainCardCommand(
        { ...scope, tariffVersionId: id, termMonths, revision: 1 },
        "quote",
      ),
    ).toThrow("card_main_invalid_request");
  });
  it.each([
    "amountMinor",
    "priceMinor",
    "active",
    "verified",
    "inviterExpertId",
    "settled",
    "providerObjectId",
  ])("rejects caller authority%s", (key) => {
    expect(() =>
      parseMainCardCommand(
        { ...scope, quoteId: id, revision: 1, [key]: "forged" },
        "accept",
      ),
    ).toThrow("card_main_invalid_request");
  });
  it("refuses nonprivate identities and ambiguous event keys", () => {
    expect(() =>
      parseMainCardCommand(
        { ...scope, chatId: "999", revision: 1 },
        "checkout",
      ),
    ).toThrow("card_main_invalid_request");
    expect(() =>
      parseMainCardCommand(
        { ...scope, botId: "invalid", revision: 1 },
        "checkout",
      ),
    ).toThrow("card_main_invalid_request");
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "requires bounded currentcard revision%s",
    (revision) => {
      expect(() =>
        parseMainCardCommand({ ...scope, quoteId: id, revision }, "accept"),
      ).toThrow("card_main_invalid_request");
    },
  );
});

describe("main checkout authority input", () => {
  it.each(["foreign", "00000000-0000-4000-8000-000000000001;select1", null])(
    "rejects invalid stored order identity before opening a transaction: %s",
    async (orderId) => {
      const transaction = vi.fn();
      const repository = new PostgresExpertOnboardingMainPaymentRepository(
        { transaction } as never,
        {
          providerMode: "test",
          messagingConsentPolicyVersion: "client-messaging-v1",
        },
      );
      await expect(
        repository.checkoutBindingForOwner(
          { ...scope, revision: 1 },
          orderId as string,
        ),
      ).rejects.toThrow("card_main_invalid_request");
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each(["", "with whitespace", "a".repeat(65), "../payments/foreign"])(
    "refuses invalid provider identity before looking up authority: %s",
    async (paymentId) => {
      const transaction = vi.fn();
      const repository = new PostgresExpertOnboardingMainPaymentRepository(
        { transaction } as never,
        {
          providerMode: "test",
          messagingConsentPolicyVersion: "client-messaging-v1",
        },
      );
      await expect(
        repository.verifyMainCheckoutForOwner(
          { ...scope, revision: 1 },
          id,
          paymentId,
        ),
      ).resolves.toBe(false);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
