import { describe, it, expect } from "vitest";
import { PostgresExpertOnboardingMainPaymentRepository } from "./expert-onboarding-main-payment-repository.js";
import { ExpertCampaignQuoteError } from "./expert-campaign-quote-repository.js";
import { parseMainCardCommand } from "./expert-card-main-command.js";
const bill = "00000000-0000-4000-8000-000000000111";
const quote = "00000000-0000-4000-8000-000000000112";
const frame = {
  botId: "717171",
  botKey: "work-fixture",
  telegramUserId: "818181",
  chatId: "818181",
  requestKey: "717171:123",
  requestDigest: "a".repeat(64),
  revision: 3,
};
describe("server bill-bound residency renewal payment commands", () => {
  it("preserves the explicit supported term and immutable bill identity for a new quote", () => {
    expect(
      parseMainCardCommand(
        {
          ...frame,
          renewalBillId: bill,
          tariffVersionId: quote,
          termMonths: 3,
        },
        "quote",
      ),
    ).toMatchObject({ renewalBillId: bill, termMonths: 3 });
  });
  it("binds renewed explicit acceptance to its bill and exact quote", () => {
    expect(
      parseMainCardCommand(
        { ...frame, renewalBillId: bill, quoteId: quote },
        "accept",
      ),
    ).toMatchObject({ renewalBillId: bill, quoteId: quote });
  });
  it("permits only the bill identity on invoice creation, never a caller-selected invoice quote", () => {
    expect(
      parseMainCardCommand({ ...frame, renewalBillId: bill }, "checkout"),
    ).toMatchObject({ renewalBillId: bill });
    expect(() =>
      parseMainCardCommand(
        { ...frame, renewalBillId: bill, quoteId: quote },
        "checkout",
      ),
    ).toThrow("card_main_invalid_request");
  });
  it.each([undefined, null, "", "foreign", 123])(
    "fails closed on an explicitly malformed bill identity: %s",
    (renewalBillId) => {
      expect(() =>
        parseMainCardCommand({ ...frame, renewalBillId }, "checkout"),
      ).toThrow("card_main_invalid_request");
    },
  );
  it("never silently changes an unsupported period to one month", () => {
    expect(() =>
      parseMainCardCommand(
        {
          ...frame,
          renewalBillId: bill,
          tariffVersionId: quote,
          termMonths: 2,
        },
        "quote",
      ),
    ).toThrow("card_main_invalid_request");
  });
});

it("surfaces unavailable three-month renewal as explicit selection, never a storage success or fallback", async () => {
  const repository = new PostgresExpertOnboardingMainPaymentRepository(
    {
      transaction: async () => {
        throw new ExpertCampaignQuoteError("EXPERT_CAMPAIGN_TERM_UNAVAILABLE");
      },
    } as never,
    {
      messagingConsentPolicyVersion: "client-messaging-v1",
      providerMode: "test",
    },
  );
  await expect(
    repository.quoteMain({
      ...frame,
      renewalBillId: bill,
      tariffVersionId: quote,
      termMonths: 3,
    }),
  ).rejects.toThrow("card_main_term_unavailable");
});

it("binds a composite acceptance/checkout to its real explicit quote only inside a renewal bill", () => {
  expect(
    parseMainCardCommand(
      { ...frame, renewalBillId: bill, renewalAcceptedQuoteId: quote },
      "checkout",
    ),
  ).toMatchObject({ renewalBillId: bill, renewalAcceptedQuoteId: quote });
  expect(() =>
    parseMainCardCommand(
      { ...frame, renewalAcceptedQuoteId: quote },
      "checkout",
    ),
  ).toThrow("card_main_invalid_request");
  expect(() =>
    parseMainCardCommand(
      {
        ...frame,
        renewalBillId: bill,
        renewalAcceptedQuoteId: quote,
        quoteId: quote,
      },
      "accept",
    ),
  ).toThrow("card_main_invalid_request");
});
it("refuses automatic renewal acceptance without its owner-bound bill before database work", async () => {
  let transactions = 0;
  const repository = new PostgresExpertOnboardingMainPaymentRepository(
    {
      transaction: async () => {
        transactions++;
        throw new Error("unreachable");
      },
    } as never,
    {
      messagingConsentPolicyVersion: "client-messaging-v1",
      providerMode: "test",
    },
  );
  await expect(
    repository.acceptRenewalAndCreateInvoice({ ...frame, quoteId: quote }),
  ).rejects.toThrow("card_main_invalid_request");
  expect(transactions).toBe(0);
});
