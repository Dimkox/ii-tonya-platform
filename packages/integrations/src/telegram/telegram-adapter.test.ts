import { describe, expect, it, vi } from "vitest";

import {
  renderExpertReferralSummary,
  renderExpertResidencyQuote,
  renderTelegramExpertClient,
  renderTelegramExpertSchedule,
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
    const body = requests[0]?.body;
    expect(body && "chat_id" in body ? body.chat_id : undefined).toBe(
      "123456789",
    );
    expect(body && "chat_id" in body ? body.text : undefined).toContain(
      "Debt: 0 RUB minor units",
    );
    expect(requests[0]?.context).toEqual({
      idempotencyKey: "summary-0002",
      disableRequestLogging: true,
    });
  });

  it("renders one opaque xr1 checkout button only when supplied", async () => {
    const { adapter, requests } = buildAdapter();
    const callbackData =
      "xr1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await adapter.sendResidencyQuote({
      idempotencyKey: "quote-0002",
      telegramUserId: "123456789",
      tariffVersionId: "00000000-0000-4000-8000-000000000101",
      displayName: "30 days",
      priceMinor: "199999",
      creditMinor: "12345",
      cashMinor: "187654",
      currency: "RUB",
      durationSeconds: 2_592_000,
      checkoutCallbackData: callbackData,
    });

    expect(requests[0]?.body).toMatchObject({
      reply_markup: {
        inline_keyboard: [[{ text: "Оплатить", callback_data: callbackData }]],
      },
    });
    expect(Buffer.byteLength(callbackData, "utf8")).toBeLessThanOrEqual(64);
  });

  it("sends a bounded HTTPS checkout link with request logging disabled", async () => {
    const { adapter, requests } = buildAdapter();

    await expect(
      adapter.sendResidencyCheckoutLink({
        idempotencyKey: `telegram:${"b".repeat(64)}:checkout:delivery`,
        telegramUserId: "123456789",
        checkoutUrl: "https://pay.example/checkout",
      }),
    ).resolves.toEqual({ kind: "applied", providerOperationId: "42" });

    expect(requests[0]?.body).toMatchObject({
      chat_id: "123456789",
      text: "Оплата резидентства: https://pay.example/checkout",
    });
    expect(requests[0]?.context).toMatchObject({ disableRequestLogging: true });
    await expect(
      adapter.sendResidencyCheckoutLink({
        idempotencyKey: "bad-link",
        telegramUserId: "123456789",
        checkoutUrl: "http://pay.example/checkout",
      }),
    ).rejects.toThrow("invalid_expert_view");
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
      timezone: "Europe/Moscow",
      clientDisplayName: "Client",
      startsAt: "2026-08-14T09:00:00.000Z",
      serviceName: "Consultation",
      preparationNote: "Bring notes",
    });
    expect(rendered).toContain("Клиент: Client");
    expect(rendered).toContain("Время: 14.08.2026 12:00 (Europe/Moscow)");
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
      timezone: "Europe/Moscow",
      choices: [
        {
          startsAt: "2026-08-14T09:00:00.000Z",
          serviceName: "Consultation",
          callbackData: "cv1.safe-token",
        },
      ],
    });

    const body = requests[0]?.body;
    const button =
      body && "chat_id" in body
        ? body.reply_markup?.inline_keyboard[0]?.[0]
        : undefined;
    expect(button).toEqual({
      text: "Запись 1 · 14.08.2026 12:00",
      callback_data: "cv1.safe-token",
    });
    expect(button?.text).not.toContain("Client");
  });

  it("renders booked-only meeting URLs in expert timezone and visibly truncates a long schedule", () => {
    const appointments = Array.from({ length: 60 }, (_, index) => ({
      startsAt: `2026-08-${String(14 + (index % 7)).padStart(2, "0")}T09:00:00.000Z`,
      status: index === 0 ? ("booked" as const) : ("reserved" as const),
      clientDisplayName: `Client ${index + 1}`,
      ...(index === 0
        ? { expertNote: `Line one\n\t${"note ".repeat(900)}` }
        : {}),
      meetingUrl: `https://meeting.invalid/${index + 1}`,
    }));

    const rendered = renderTelegramExpertSchedule({
      idempotencyKey: "schedule-long",
      telegramUserId: "123456789",
      timezone: "Europe/Moscow",
      appointments,
    });

    expect(rendered).toContain("14.08.2026 12:00 (Europe/Moscow)");
    expect(rendered).toContain("Встреча: https://meeting.invalid/1");
    expect(rendered).not.toContain("https://meeting.invalid/2");
    expect(rendered).toMatch(/Показано \d+ из 60/u);
    expect(rendered).not.toMatch(/Line one\s{2,}/u);
    expect(rendered.length).toBeLessThanOrEqual(4096);
    expect(Buffer.from(rendered, "utf8").toString("utf8")).toBe(rendered);
  });

  it("normalizes and visibly truncates an oversized preparation note within Telegram bounds", () => {
    const rendered = renderTelegramExpertClient({
      idempotencyKey: "client-long-note",
      telegramUserId: "123456789",
      timezone: "Europe/Moscow",
      clientDisplayName: "Client",
      startsAt: "2026-08-14T09:00:00.000Z",
      serviceName: "Consultation",
      preparationNote: `First\n\t${"detail ".repeat(1_000)}`,
    });

    expect(rendered).toContain("First detail");
    expect(rendered).toContain("[заметка сокращена]");
    expect(rendered.length).toBeLessThanOrEqual(4096);
  });

  it("answers callback queries through a bounded logging-disabled transport call", async () => {
    const { adapter, requests } = buildAdapter();
    await expect(
      adapter.answerCallbackQuery({
        idempotencyKey: "answer-1",
        callbackQueryId: "callback-1",
        status: "unavailable",
      }),
    ).resolves.toEqual({
      kind: "applied",
      providerOperationId: "callback-1",
    });
    expect(requests[0]).toMatchObject({
      body: {
        callback_query_id: "callback-1",
        text: "Запрос недоступен. Откройте /client ещё раз.",
      },
      context: { disableRequestLogging: true },
    });
  });
});
