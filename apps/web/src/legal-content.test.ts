import { describe, expect, it } from "vitest";
import { legalDocuments, normalizeLegalDocument } from "./legal-content.js";

describe("public legal documents", () => {
  it("publishes complete offer and privacy documents for the current public boundary", () => {
    expect(legalDocuments.oferta.text.startsWith("ДОГОВОР-ОФЕРТА\n")).toBe(
      true,
    );
    for (let section = 1; section <= 13; section += 1) {
      expect(legalDocuments.oferta.text).toContain(`РАЗДЕЛ ${section}.`);
    }
    expect(legalDocuments.oferta.text).toContain("5.6.8.");
    expect(legalDocuments.oferta.text).toContain("РАЗДЕЛ 13");
    expect(legalDocuments.privacy.title).toBe("Политика конфиденциальности");
    expect(
      legalDocuments.privacy.text.startsWith("ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ\n"),
    ).toBe(true);
    for (let section = 1; section <= 17; section += 1) {
      expect(legalDocuments.privacy.text).toMatch(
        new RegExp(`(?:^|\\n)${section}\\. [А-ЯЁ]`, "u"),
      );
    }
    expect(legalDocuments.privacy.text).toContain("17. РЕКВИЗИТЫ ОПЕРАТОРА");
    expect(legalDocuments.privacy.text).toContain("ii-tonya@yandex.ru");
    expect(legalDocuments.privacy.text).toContain(
      "не осуществляет трансграничную передачу",
    );
    expect(legalDocuments.privacy.text).toContain("21 августа 2026 года");
    expect(legalDocuments.oferta.text).toContain(
      "Настоящая Оферта вступает в силу с 21 августа 2026 года и действует до её отзыва Исполнителем.",
    );
    expect(legalDocuments.privacy.text).toContain(
      "Настоящая Политика вступает в силу с 21 августа 2026 года и действует до её отзыва или замены новой редакцией.",
    );
    for (const requisite of [
      "ИНН: 683102264735",
      "ОГРНИП: 326680000031840",
      "БИК банка: 044525974",
    ]) {
      expect(legalDocuments.oferta.text).toContain(requisite);
      expect(legalDocuments.privacy.text).toContain(requisite);
    }
  });

  it("removes source-chat and citation artefacts without rewriting legal copy", () => {
    expect(legalDocuments.oferta.text).not.toContain("Принято! Вношу");
    expect(legalDocuments.oferta.text).not.toContain("[reference:0]");
    expect(legalDocuments.oferta.text).not.toContain("Принято!");
    expect(legalDocuments.privacy.text).not.toContain("[reference:0]");
    expect(legalDocuments.privacy.text).not.toContain("Принято!");
    expect(normalizeLegalDocument("\ufeffA\r\nB")).toBe("A\nB");
  });

  it("publishes the supplied package, coupon, referral, and messenger terms", () => {
    expect(legalDocuments.oferta.text).toMatch(
      /Пакет сообщений|Купон|реферальн|72 час|VK|WhatsApp|Viber/iu,
    );
  });

  it("states package and coupon terms without claiming default-off coupon issuance is active", () => {
    const oferta = legalDocuments.oferta.text;
    expect(oferta).toContain("30 календарных дней");
    expect(oferta).toContain("100 сообщений и не имеет срока действия");
    expect(oferta).toContain("новые Купоны действуют 45 календарных дней");
    expect(oferta).not.toContain(
      "При оплате Пакета сообщений Клиенту начисляются Купоны",
    );
    expect(oferta).not.toContain("Новый Клиент получает 500 купонов");
  });

  it("does not contradict offered paid packages in the public FAQ", async () => {
    const { landingContent } = await import("./content.js");
    const faq = landingContent.faq.map((entry) => entry.join(" ")).join(" ");
    expect(faq).not.toContain("новые платные пакеты в V2 не продаются");
    expect(faq).toContain("30 дней");
    expect(faq).toContain("100 сообщений без срока");
    expect(faq).toContain("Купоны");
    expect(faq).toContain("отключены");
  });
});
