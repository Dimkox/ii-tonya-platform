import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderLanding } from "./landing-view.js";
import { renderStructuredData } from "./seo.js";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const websiteStyles = readFileSync(
  new URL("./website-v11.css", import.meta.url), "utf8",
);
const html = renderLanding({
  expertChatUrl: new URL("https://t.me/ii_tonya_bot"),
});

function section(id: string): string {
  const match = html.match(
    new RegExp(`<section[^>]+id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`, "u"),
  );
  if (!match?.[1]) throw new Error(`missing_section_${id}`);
  return match[1];
}

function questions(markup: string): string[] {
  return [...markup.matchAll(/<summary>(.*?)<\/summary>/gu)].map(
    (match) => match[1] ?? "",
  );
}

describe("reconciled public website V1.1", () => {
  it("renders one requested H1 and twelve structural blocks in order", () => {
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html).toContain(
      '<h1 id="hero-title">ии-Тоня: сервис персонального сопровождения в саморазвитии</h1>',
    );
    expect(
      [...html.matchAll(/data-website-block="(S\d{2})"/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        `S${String(index + 1).padStart(2, "0")}`,
      ),
    );
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="Основная навигация"');
  });

  it("keeps all four roles directly addressable without hidden tabs", () => {
    for (const role of ["clients", "experts", "organizers", "spaces"]) {
      expect(html).toContain(
        `id="${role}" aria-labelledby="${role}-title"`,
      );
      expect(html).toContain(`id="${role}-title"`);
      expect(html).toContain(`href="#${role}"`);
    }
    expect(html).not.toMatch(/role="tabpanel"|aria-hidden="true"/u);
  });

  it("has unique IDs and resolves every in-page link", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of html.matchAll(/href="#([^"]+)"/gu)) {
      expect(ids).toContain(id);
    }
  });

  it("does not publish implementation labels, emoji or secret entry phrases", () => {
    expect(html).not.toMatch(
      /\d{2}\s*\/\s*(?:Первый экран|Футер)|Секция 01|ТЗ для дизайнера|тест эксперт|\p{Emoji_Presentation}|\uFE0F/u,
    );
    expect(html).toContain("Подбор экспертов и активностей");
    expect(html).not.toContain("Подбор живых людей");
    expect(html).toContain(
      "эксперты — тех, кому нужны их знания и практика",
    );
  });

  it("preserves the responsive, dimensioned, eager hero image", () => {
    expect(html).toContain("<picture>");
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain(
      'srcset="/tonya-hero-512.avif 512w, /tonya-hero-1024.avif 1024w"',
    );
    expect(html).toContain(
      'srcset="/tonya-hero-512.webp 512w, /tonya-hero-1024.webp 1024w"',
    );
    expect(
      html.match(/sizes="\(max-width: 900px\) 86vw, 50vw"/gu),
    ).toHaveLength(2);
    expect(html).toMatch(
      /<img src="\/tonya-hero\.png" width="1024" height="1536" alt="Иллюстрация ии-Тони — внимательной женщины-навигатора" fetchpriority="high">/u,
    );
    expect(html).not.toMatch(/<video\b|<iframe\b|loading="lazy"/u);
  });

  it("keeps mobile navigation visible without JavaScript", () => {
    // Stable: inherited navigation styles must remain available on small screens.
    expect(styles).not.toMatch(
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.site-header\s*>\s*nav\s*\{\s*display:\s*none/iu,
    );
    expect(styles).toMatch(
      /\.site-header\s*>\s*nav\s*\{[\s\S]*overflow-x:\s*auto/iu,
    );
  });

  it("preserves focus and reduced-motion styling without reveal-dependent content", () => {
    // Stable: keyboard focus and reduced motion remain stylesheet responsibilities.
    expect(styles).toMatch(/:focus-visible[\s\S]*outline:/u);
    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
    expect(html).not.toContain("data-reveal");
  });

  it("uses the existing message-card radius tokens", () => {
    // Stable: cards must not reference an undefined generic radius token.
    expect(styles).not.toContain("var(--radius)");
    expect(styles).toMatch(
      /\.message-packages\s*\{[\s\S]*border-radius:\s*var\(--radius-(?:sm|md|lg)\)/u,
    );
  });

  it("orders five nonfinancial benefits and marks them as planned", () => {
    const clients = section("clients");
    expect(
      [...clients.matchAll(/<h4>(.*?)<\/h4>/gu)].map((match) => match[1]),
    ).toEqual([
      "Сервис «одно окно»",
      "Глубокая диагностика ситуации",
      "Сопровождение на всём пути",
      "Только проверенные мастера",
      "Локально и глобально",
    ]);
    expect(clients).toContain('data-feature-status="planned"');
    expect(clients).toContain("не медицинская диагностика");
    expect(clients).toContain("если вход включён");
    for (const title of [
      "Ваши деньги работают ×2",
      "Подарки и скидки",
      "Реферальные бонусы",
    ]) {
      expect(html).not.toContain(title);
    }
  });

  it("renders organizer questions in the required order", () => {
    expect(questions(section("organizers"))).toEqual([
      "Насколько качественна наша аудитория?",
      "Как подобрать идеальное пространство или эксперта?",
      "Как обновлять информацию о мероприятиях?",
      "Безопасно ли продвигаться через ии-Тоню? Нужна ли маркировка рекламы?",
      "Смогут ли участники найти нас в соцсетях?",
    ]);
  });

  it("renders space questions in the required order with direct owner payment", () => {
    const spaces = section("spaces");
    expect(questions(spaces)).toEqual([
      "Как происходит оплата аренды?",
      "Как обновлять расписание и условия аренды?",
      "Что если бронь отменят?",
      "Насколько надёжны арендаторы?",
      "Получаем ли мы упоминания в соцсетях?",
      "Безопасно ли размещать информацию о пространстве?",
    ]);
    expect(spaces).toContain("Деньги за аренду получает владелец пространства");
    expect(spaces).toContain("Это не оплата резидентства платформы");
  });

  it("contains three visibly educational, inert demonstrations", () => {
    const demos = [
      ...html.matchAll(
        /<article[^>]*data-demo-id="(D\d+)"[^>]*>([\s\S]*?)<\/article>/gu,
      ),
    ];
    expect(demos.map((match) => match[1])).toEqual(["D01", "D02", "D03"]);
    for (const demo of demos) {
      expect(demo[2]).toContain("Учебный сценарий. Вымышленные данные.");
      expect(demo[2]).not.toMatch(/<(?:a|button|input|form|iframe|script)\b/iu);
    }
    for (const result of [
      "Запись не создана",
      "Резидентство не активировано",
      "Реальная заявка не отправлена",
    ]) {
      expect(html).toContain(result);
    }
  });

  it("uses the canonical expert bot without inventing source-specific routes", () => {
    const targets = [
      ...html.matchAll(/data-messenger-action href="([^"]+)"/gu),
    ].map((match) => new URL(match[1] ?? ""));
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target.href).toBe(
        "https://t.me/ii_tonya_expert_promo_bot?start=expert",
      );
    }
    expect(html).not.toContain("/ii_tonya_bot");
    expect(html).not.toContain("source_");
  });

  it("cannot expose an old bot or query secrets through public config", () => {
    const target = new URL("https://t.me/ii_tonya_bot");
    target.searchParams.set("token", "0");
    const overridden = renderLanding({ expertChatUrl: target });
    expect(overridden).not.toContain("/ii_tonya_bot");
    for (const [, href] of overridden.matchAll(/data-messenger-action href="([^"]+)"/gu)) {
      const rendered = new URL(href ?? "");
      expect(rendered.searchParams.has("token")).toBe(false);
      expect([...rendered.searchParams.keys()]).toEqual(["start"]);
    }
  });

  it("preserves client navigation instead of sending clients to expert sales", () => {
    const clients = section("clients");
    expect(clients).not.toMatch(/t\.me|data-messenger-action/u);
    expect(clients).toContain('href="/catalog"');
    expect(clients).toContain('href="/account"');
    expect(html).toContain('href="/expert/account"');
    expect(html).not.toContain("Попробовать бесплатно");
  });

  it("does not publish unconfirmed prices or instant activation promises", () => {
    for (const phrase of [
      "от 12 000", "от 20 000", "4 999", "10 990", "Бронь 30%",
      "через 2–3 дня после оплаты", "24/7 без вашего участия",
    ]) {
      expect(html).not.toContain(phrase);
    }
    expect(html).toContain('class="contract-boundary"');
    expect(html).toContain("не гарантирует поток клиентов");
    expect(html).toContain("требования законодательства РФ");
    expect(html).toContain("не означают автоматического подключения или оплаты");
  });

  it("preserves legal routes, brand wording and operator identity", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/oferta"');
    expect(html).toContain("326680000031840");
    expect(html).toContain("Навигатор твоего роста");
    expect(html).toContain("Развиваясь — обрети свободу!");
    expect(html).not.toContain("ссылка скоро появится");
  });

  it("has usable contacts rather than an unconnected collection form", () => {
    const contacts = section("contacts");
    expect(contacts).toContain('href="mailto:ii-tonya@yandex.ru"');
    expect(contacts).toContain('href="tel:+79204742866"');
    expect(contacts).not.toContain('href="/account"');
    expect(contacts).toContain("Не отправляйте личную историю");
    expect(html).not.toMatch(/<form\b|<input\b|24 часа|24 часов/iu);
  });

  it("contains no submission, inline tracking or executable interaction surface", () => {
    expect(html).not.toMatch(
      /<script\b|<iframe\b|<form\b|<input\b|\son(?:click|submit|load)=/iu,
    );
    expect(html).not.toMatch(/mc\.yandex|google-analytics|fonts\.googleapis/iu);
    expect(html).not.toMatch(/cardholder|checkout|bearer/iu);
  });

  it("scopes brand styling and preserves complete source-image composition", () => {
    for (const value of ["#2d1b4e", "#f5b041", "#9b72aa", "#e9e4f6"]) {
      expect(websiteStyles).toContain(value);
    }
    expect(websiteStyles).toContain("Montserrat");
    expect(websiteStyles).toContain("object-fit: contain");
    expect(websiteStyles).toContain("overflow: visible");
    expect(websiteStyles).not.toMatch(/@import|url\(/u);
    expect(html).toContain('class="website-v11"');
    expect(html).toContain('class="site-header website-header"');
  });

  it("keeps visible and structured general FAQ in sync", () => {
    const graph = JSON.parse(renderStructuredData()) as {
      readonly "@graph": ReadonlyArray<{
        readonly "@type": string;
        readonly mainEntity?: ReadonlyArray<{
          readonly name: string;
          readonly acceptedAnswer: { readonly text: string };
        }>;
      }>;
    };
    const entries = graph["@graph"].find(
      (entry) => entry["@type"] === "FAQPage",
    )?.mainEntity;
    expect(entries?.map((entry) => entry.name)).toEqual(questions(section("faq")));
    for (const entry of entries ?? []) {
      expect(section("faq")).toContain(entry.acceptedAnswer.text);
    }
    expect(html.match(/<details\b/gu)).toHaveLength(22);
  });
  it("renders all nine source directions in their original order", () => {
    expect([...section("directions").matchAll(/<strong>(.*?)<\/strong>/gu)].map((match) => match[1])).toEqual([
      "Голова и душа", "Тело", "Движение", "Дыхание и энергия", "Здоровье и тело",
      "Творчество и самовыражение", "Духовное развитие", "Группы и события", "Обучение и курсы",
    ]);
  });

});
