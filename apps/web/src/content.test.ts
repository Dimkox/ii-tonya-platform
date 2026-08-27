import { describe, expect, it } from "vitest";
import { landingContent } from "./content.js";

describe("landing content", () => {
  it("keeps the approved identity and complete public structure", () => {
    expect(landingContent.brand).toBe("ии-Тоня");
    expect(landingContent.hero.title).toBe("Привет, я ии-Тоня 👋");
    expect(landingContent.clientCategories).toHaveLength(7);
    expect(landingContent.clientFlow).toHaveLength(3);
    expect(landingContent.tariffs.map(({ code }) => code)).toEqual([
      "base",
      "exclusive",
      "event",
    ]);
    expect(landingContent.faq.length).toBeGreaterThanOrEqual(10);
    expect(landingContent.operator.ogrnip).toBe("326680000031840");
  });

  it("contains no coercive, guaranteed, or placeholder claims", () => {
    const copy = JSON.stringify(landingContent);
    expect(copy).not.toMatch(
      /успей|гарантируем|гарантия (?:результата|обращений)|гарантированный|без маркировки рекламы|\[\.\.\.\]/iu,
    );
    expect(copy).not.toMatch(/ОГРНИП\s*\[|лучший|лечит/iu);
    expect(copy).not.toMatch(
      /пакет(?:ы|а)? сообщений|купон|реферальн|резервирует слот|напоминания придут|доступен 24\/7/iu,
    );
  });

  it("describes the bot-only payment boundary without collecting card data", () => {
    expect(landingContent.payment.channel).toBe("Только в Telegram-боте");
    expect(landingContent.payment.providers).toEqual([
      { name: "ЮKassa", logo: "/payments/yookassa.svg" },
      { name: "Т-Банк", logo: "/payments/tbank.svg" },
    ]);
    expect(landingContent.payment.providerNotice).toContain(
      "иной подключённый платёжный оператор",
    );
    expect(landingContent.payment.flow).toHaveLength(4);
    expect(landingContent.payment.security).toContain(
      "не получает и не хранит полный номер банковской карты и CVV/CVC",
    );
    expect(landingContent.payment.receipt).toContain(
      "электронный кассовый чек",
    );
    expect(landingContent.payment.refund).toContain("ii-tonya@yandex.ru");
  });

  it("publishes unambiguous fixed prices, event formula, and delivery terms", () => {
    expect(landingContent.tariffs.map(({ price }) => price)).toEqual([
      "12 000 ₽ / 30 календарных дней",
      "20 000 ₽ / 30 календарных дней",
      "10% / 15% от фактической выручки",
    ]);
    expect(landingContent.tariffs[0].delivery).toContain("1–3 рабочих дня");
    expect(landingContent.tariffs[1].delivery).toContain("30 календарных дней");
    expect(landingContent.tariffs[0].description).toContain(
      "одной карточки эксперта",
    );
    expect(landingContent.tariffs[0].setup).toContain(
      "Первый заказ — 15 000 ₽",
    );
    expect(landingContent.tariffs[1].setup).toContain(
      "Первый заказ — 23 000 ₽",
    );
    expect(landingContent.tariffs[2].description).toContain(
      "за вычетом возвратов участникам",
    );
    expect(landingContent.tariffs[2].delivery).toContain(
      "в течение 5 рабочих дней после мероприятия",
    );
    expect(landingContent.operator.schedule).toContain("круглосуточно");
    expect(landingContent.operator.schedule).toContain("без выходных");
  });
});
