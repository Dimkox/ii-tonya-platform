import { describe, expect, it } from "vitest";
import { legalDocuments, normalizeLegalDocument } from "./legal-content.js";

describe("public legal documents", () => {
  it("publishes complete offer and privacy documents for the current public boundary", () => {
    expect(legalDocuments.oferta.title).toBe("Договор-оферта");
    expect(legalDocuments.oferta.text).toContain(
      "РАЗДЕЛ 11. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ",
    );
    expect(legalDocuments.oferta.text).toContain("22 августа 2026 года");
    expect(legalDocuments.oferta.text).toContain(
      "Оплата оформляется только в Telegram-боте",
    );
    expect(legalDocuments.oferta.text).toContain(
      "ЮKassa, Т-Банка или иного подключённого платёжного оператора",
    );
    expect(legalDocuments.oferta.text).toContain(
      "полный номер банковской карты и CVV/CVC не получает и не хранит",
    );
    expect(legalDocuments.oferta.text).toContain(
      "Базовый тариф — 12 000 рублей за 30 календарных дней",
    );
    expect(legalDocuments.oferta.text).toContain(
      "первого заказа по Базовому тарифу составляет 15 000 рублей",
    );
    expect(legalDocuments.oferta.text).toContain(
      "за вычетом возвратов денежных средств участникам",
    );
    expect(legalDocuments.oferta.text).toContain(
      "в течение пяти рабочих дней после мероприятия",
    );
    expect(legalDocuments.oferta.text).toContain(
      "заключается Клиентом непосредственно с выбранным Экспертом",
    );
    expect(legalDocuments.privacy.title).toBe("Политика конфиденциальности");
    expect(legalDocuments.privacy.text).toContain("12. РЕКВИЗИТЫ ОПЕРАТОРА");
    expect(legalDocuments.privacy.text).toContain("ii-tonya@yandex.ru");
    expect(legalDocuments.privacy.text).toContain(
      "Сайт не устанавливает файлы Cookies",
    );
    expect(legalDocuments.privacy.text).toContain(
      "не считается согласием на обработку",
    );
    expect(legalDocuments.privacy.text).toContain("ЮKassa и Т-Банк");
    expect(legalDocuments.privacy.text).toContain(
      "полный номер банковской карты и CVV/CVC Оператору не передаются",
    );
    expect(legalDocuments.privacy.text).toContain(
      "маскированные сведения о способе оплаты",
    );
  });

  it("removes source-chat and citation artefacts without rewriting legal copy", () => {
    expect(legalDocuments.oferta.text).not.toContain("Принято! Вношу");
    expect(legalDocuments.privacy.text).not.toContain("[reference:0]");
    expect(normalizeLegalDocument("\ufeffA\r\nB")).toBe("A\nB");
  });

  it("does not publish contracts for inactive client commerce or unsupported providers", () => {
    expect(legalDocuments.oferta.text).not.toMatch(
      /Пакет сообщений|Купон|реферальн|72 час|VK|WhatsApp|Viber/iu,
    );
    expect(legalDocuments.privacy.text).not.toMatch(
      /используя Сайт.{0,80}согласи|не осуществляет трансграничную передачу/iu,
    );
  });
});
