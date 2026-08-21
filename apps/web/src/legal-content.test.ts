import { describe, expect, it } from "vitest";
import { legalDocuments, normalizeLegalDocument } from "./legal-content.js";

describe("public legal documents", () => {
  it("publishes complete offer and privacy documents for the current public boundary", () => {
    expect(legalDocuments.oferta.title).toBe("Договор-оферта");
    expect(legalDocuments.oferta.text).toContain(
      "РАЗДЕЛ 11. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ",
    );
    expect(legalDocuments.oferta.text).toContain("21 августа 2026 года");
    expect(legalDocuments.oferta.text).toContain(
      "Платёжные элементы на Сайте отсутствуют",
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
