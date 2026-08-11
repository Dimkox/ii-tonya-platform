import { describe, expect, it, vi } from "vitest";

import {
  renderExpertReferralSummary,
  renderExpertResidencyQuote,
  TelegramAdapter,
  type TelegramTransportRequest,
} from "./telegram-adapter.js";

const buildAdapter = () => {
  const requests: TelegramTransportRequest[] = [];
  const adapter = new TelegramAdapter({
    baseUrl: new URL("https://api.telegram.org/"),
    botToken: "123456:TEST_TOKEN",
    maxBodyBytes: 64 * 1024,
    logger: { error: vi.fn() },
    transport: {
      async request(request) {
        requests.push(request);
        return { status: 200, body: { ok: true, result: { message_id: 42 } } };
      },
    },
  });
  return { adapter, requests };
};

describe("expert Telegram views", () => {
  it("renders referral summary from server facts without calculating amounts", () => {
    expect(
      renderExpertReferralSummary({
        idempotencyKey: "summary-0001",
        telegramUserId: "123456789",
        availableMinor: "100001",
        reservedMinor: "33333",
        debtMinor: "777",
        nearestExpiry: "2027-08-03T00:00:00.000Z",
        maskedCodeStatus: "issued ••••ABCD",
      }),
    ).toContain("Referral credit: 100001 RUB minor units");
  });

  it("renders the exact server quote fields without deriving the split", () => {
    const rendered = renderExpertResidencyQuote({
      idempotencyKey: "quote-0001",
      telegramUserId: "123456789",
      tariffVersionId: "00000000-0000-4000-8000-000000000101",
      displayName: "30 days",
      priceMinor: "199999",
      creditMinor: "12345",
      cashMinor: "187654",
      currency: "RUB",
      durationSeconds: 2_592_000,
    });
    expect(rendered).toContain("Price: 199999 RUB minor units");
    expect(rendered).toContain("Referral credit: 12345 RUB minor units");
    expect(rendered).toContain("Cash due: 187654 RUB minor units");
  });

  it("sends a rendered expert summary with request logging disabled", async () => {
    const { adapter, requests } = buildAdapter();
    await expect(
      adapter.sendReferralSummary({
        idempotencyKey: "summary-0002",
        telegramUserId: "123456789",
        availableMinor: "100000",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: null,
      }),
    ).resolves.toEqual({ kind: "applied", providerOperationId: "42" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.chat_id).toBe("123456789");
    expect(requests[0]?.body.text).toContain("Debt: 0 RUB minor units");
    expect(requests[0]?.context).toEqual({
      idempotencyKey: "summary-0002",
      disableRequestLogging: true,
    });
  });

  it("rejects malformed server money instead of normalizing it", () => {
    expect(() =>
      renderExpertReferralSummary({
        idempotencyKey: "summary-0003",
        telegramUserId: "123456789",
        availableMinor: "1.5",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: null,
      }),
    ).toThrow("invalid_expert_view");
  });
});
