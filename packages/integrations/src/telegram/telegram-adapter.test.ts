import { describe, expect, it, vi } from "vitest";

import {
  renderExpertReferralSummary,
  renderExpertResidencyQuote,
  renderTelegramExpertClient,
  renderTelegramExpertStats,
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

  it("renders only the minimized client view fields", () => {
    const rendered = renderTelegramExpertClient({
      idempotencyKey: "client-view-1",
      telegramUserId: "123456789",
      clientDisplayName: "Client",
      startsAt: "2026-08-14T09:00:00.000Z",
      serviceName: "Consultation",
      preparationNote: "Bring notes",
    });
    expect(rendered).toContain("Клиент: Client");
    expect(rendered).toContain("Заметка для подготовки: Bring notes");
    expect(rendered).not.toMatch(/phone|email|balance|payment/iu);
  });

  it("renders safe server aggregate counts without client-level facts", () => {
    expect(
      renderTelegramExpertStats({
        idempotencyKey: "stats-1",
        telegramUserId: "123456789",
        upcoming: 2,
        completed: 3,
        cancelled: 1,
        noShow: 0,
      }),
    ).toBe(
      "Предстоящие: 2\nЗавершённые за 30 дней: 3\nОтменённые за 30 дней: 1\nНеявки за 30 дней: 0",
    );
  });

  it("builds non-identifying cv1 buttons within Telegram's callback limit", async () => {
    const { adapter, requests } = buildAdapter();
    await adapter.sendClientChoices({
      idempotencyKey: "client-list-1",
      telegramUserId: "123456789",
      choices: [
        {
          startsAt: "2026-08-14T09:00:00.000Z",
          serviceName: "Consultation",
          callbackData: "cv1.safe-token",
        },
      ],
    });

    const button = requests[0]?.body.reply_markup?.inline_keyboard[0]?.[0];
    expect(button).toEqual({
      text: "Запись 1 · 2026-08-14T09:00:00.000Z",
      callback_data: "cv1.safe-token",
    });
    expect(button?.text).not.toContain("Client");
  });
});
