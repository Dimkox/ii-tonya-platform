import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderLanding } from "./landing-view.js";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const html = renderLanding({
  expertChatUrl: new URL("https://t.me/ii_tonya_bot"),
});

describe("promotional landing view", () => {
  it("renders the complete semantic information catalogue", () => {
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="Основная навигация"');
    for (const id of [
      "about",
      "clients",
      "experts",
      "tariffs",
      "faq",
      "contacts",
      "legal",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html.match(/<details\b/gu)).toHaveLength(20);
    expect(html).toContain("<picture>");
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('srcset="/tonya-hero-512.avif 512w, /tonya-hero-1024.avif 1024w"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('srcset="/tonya-hero-512.webp 512w, /tonya-hero-1024.webp 1024w"');
    expect(html.match(/sizes="\(max-width: 900px\) 86vw, 50vw"/gu)).toHaveLength(2);
    expect(html).toMatch(/<img src="\/tonya-hero\.png" width="1024" height="1536" alt="Иллюстрация ии-Тони — внимательной женщины-навигатора" fetchpriority="high">/u);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/oferta"');
    expect(html).toContain("326680000031840");
  });

  it("keeps mobile section navigation visible without JavaScript", () => {
    expect(html).toMatch(/<nav aria-label="Основная навигация">[\s\S]*href="#contacts"/u);
    expect(styles).not.toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.site-header\s*>\s*nav\s*\{\s*display:\s*none/iu);
    expect(styles).toMatch(/\.site-header\s*>\s*nav\s*\{[\s\S]*overflow-x:\s*auto/iu);
  });

  it("renders all eight conceptual blocks in order with aligned labels", () => {
    const markers = [
      ['id="top"', "01 / Первый экран"], ['id="about"', "02 / О проекте"],
      ['id="clients"', "03 / Клиентам"], ['id="experts"', "04 / Экспертам"],
      ['id="tariffs"', "05 / Условия размещения"], ['id="faq"', "06 / Часто задаваемые вопросы"],
      ['id="contacts"', "07 / Контакты"], ['id="legal"', "08 / Футер"],
    ] as const;
    let previous = -1;
    for (const [id, label] of markers) {
      const position = html.indexOf(id);
      expect(position).toBeGreaterThan(previous);
      expect(html.slice(position, position + 500)).toContain(label);
      previous = position;
    }
  });

  it("renders the offer-backed expert contract boundaries", () => {
    expect(html).toContain('class="contract-boundary"');
    expect(html).toContain("не гарантируются и зависят от клиентских запросов");
    expect(html).toContain("требования законодательства РФ, в том числе в части маркировки рекламы");
    expect(html).toContain("Если Эксперт подтверждает запись, Клиент получает уведомление с подтверждением");
  });

  it("uses only defined radius tokens for message packages", () => {
    expect(styles).not.toContain("var(--radius)");
    expect(styles).toMatch(/\.message-packages\s*\{[\s\S]*border-radius:\s*var\(--radius-(?:sm|md|lg)\)/u);
  });

  it("keeps every action inside the messenger boundary", () => {
    const actionLinks = [
      ...html.matchAll(/data-messenger-action href="([^"]+)"/gu),
    ];
    expect(actionLinks.length).toBeGreaterThanOrEqual(7);
    for (const [, href] of actionLinks) {
      const target = new URL(href!);
      expect(target.origin).toBe("https://t.me");
      expect([...target.searchParams.keys()]).toEqual(["start"]);
    }
  });

  it("publishes the requested landing offer and safe form stub", () => {
    expect(html).toContain("Я помогу тебе найти того, кто поможет на твоём пути развития");
    expect(html).toContain("Попробовать бесплатно");
    expect(html.match(/Твой персональный навигатор по миру саморазвития/gu)).toHaveLength(1);
    expect(html).toContain("Какой бы ни был твой запрос — я помогу найти того, кто сможет помочь.");
    expect(html).toContain("психологи, коучи, терапевты");
    expect(html).toContain("тест клиент");
    expect(html).toContain("тест эксперт");
    expect(html).toContain("срок их действия составит 45 дней");
    expect(html).toContain("начисление и использование купонов в V2 отключены");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("не отправляет данные");
    expect(html).toContain("А теперь представьте");
    expect(html).toContain("Адресные рекомендации по запросу клиента");
    expect(html).not.toContain("Без маркировки рекламы");
    expect(html).toContain("Бронь 30% от предполагаемой выручки");
    expect(html).toContain("Формата работы (очно / онлайн / смешанный)");
    expect(html).toContain("Telegram");
    expect(html).toContain("VK");
    expect(html).toContain("Instagram");
    expect(html).toContain("WhatsApp");
  });

  it("contains no network submission, authentication, card entry, or tracking surface", () => {
    expect(html).not.toMatch(
      /action=|method=|authorization|bearer|checkout|cardholder|analytics|pixel/iu,
    );
    expect(html).not.toMatch(/on(?:click|submit|load)=/iu);
    expect(html).toMatch(/<form\b(?![^>]*(?:action|method)=)/iu);
    expect(html).toMatch(/<input[^>]+disabled/iu);
    expect(html).toMatch(/<button[^>]+disabled/iu);
    expect(html).not.toMatch(/mc\.yandex|google-analytics|fonts\.googleapis/iu);
    expect(html).not.toMatch(
      /<input[^>]*(?:card|cvv)/iu,
    );
    expect(html).toContain("тест клиент");
  });
});
