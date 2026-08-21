import { describe, expect, it } from "vitest";
import { renderLanding } from "./landing-view.js";

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
    expect(html.match(/<details\b/gu)?.length).toBeGreaterThanOrEqual(10);
    expect(html).toContain('src="/tonya-hero.png"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/oferta"');
    expect(html).toContain("326680000031840");
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

  it("contains no form, authentication, payment, or tracking surface", () => {
    expect(html).not.toMatch(
      /<form\b|<input\b|authorization|bearer|checkout|yookassa|payment|analytics|pixel/iu,
    );
    expect(html).not.toMatch(/on(?:click|submit|load)=/iu);
    expect(html).not.toMatch(/mc\.yandex|google-analytics|fonts\.googleapis/iu);
    expect(html).not.toMatch(
      /тест клиент|тест эксперт|пакет(?:ы|а)? сообщений|купон/iu,
    );
    expect(html).toContain("Платёжных элементов на этой странице нет");
  });
});
