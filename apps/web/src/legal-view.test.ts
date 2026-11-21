import { describe, expect, it } from "vitest";
import { legalDocuments } from "./legal-content.js";
import { escapeLegalHtml } from "./legal-layout.js";
import { renderLegalPage } from "./legal-view.js";

describe("legal page", () => {
  it("renders the policy headings with navigable section anchors", () => {
    const html = renderLegalPage("privacy");
    expect(html).toContain("<h1>Политика конфиденциальности</h1>");
    expect(html).toContain('href="/"');
    expect(html).toMatch(/<h2[^>]+>14\. ИСПОЛЬЗОВАНИЕ ФАЙЛОВ COOKIES<\/h2>/u);
    expect(html).toMatch(/<h2[^>]+>17\. РЕКВИЗИТЫ ОПЕРАТОРА<\/h2>/u);
    expect(html).not.toContain("[reference:0]");
  });

  it.each(["oferta", "privacy"] as const)("preserves the actual %s document text and numbering", (code) => {
    const source = legalDocuments[code];
    const html = renderLegalPage(code);
    const body = html.match(/<article class="legal-document">([\s\S]*?)<\/article>/u)?.[1] ?? "";
    const textNodes = [...body.matchAll(/>([^<]*)</gu)].map((match) => match[1]).filter(Boolean);
    const lines = source.text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && line !== "---");
    const title = lines.findIndex((line) => line.toLocaleLowerCase("ru") === source.title.toLocaleLowerCase("ru"));
    if (title >= 0) lines.splice(title, 1);
    expect(textNodes).toEqual(lines.map(escapeLegalHtml));
  });

  it.each(["oferta", "privacy"] as const)("shares brand and landing navigation on %s without illustrations", (code) => {
    const html = renderLegalPage(code);
    expect(html.match(/<header\b/gu)).toHaveLength(1);
    expect(html.match(/<main\b/gu)).toHaveLength(1);
    expect(html.match(/<footer\b/gu)).toHaveLength(1);
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    for (const role of ["clients", "experts", "organizers", "spaces"]) expect(html).toContain(`href="/#${role}"`);
    expect(html).toContain('href="/oferta"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Навигатор твоего роста");
    expect(html).toContain('class="legal-page website-legal"');
    expect(html).toContain('aria-label="Оглавление документа"');
    expect(html).not.toMatch(/<img|<picture|<form|<input|<script/u);
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, target] of html.matchAll(/href="#([^"]+)"/gu)) expect(ids).toContain(target);
  });
});
