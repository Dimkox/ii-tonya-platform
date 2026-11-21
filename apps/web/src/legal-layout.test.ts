import { describe, expect, it } from "vitest";
import { escapeLegalHtml, renderLegalText } from "./legal-layout.js";

describe("legal text layout", () => {
  it("preserves every substantive line, clause number and bullet", () => {
    const lines = ["1. ОБЩИЕ ПОЛОЖЕНИЯ", "1.1. Условия & обязанности.", "· посетителей Сайта;", "1.2. Сумма 3 000 ₽."];
    const layout = renderLegalText(["ДОГОВОР", "", "---", ...lines].join("\r\n"), "Договор");
    for (const line of lines) expect(layout.bodyHtml).toContain(escapeLegalHtml(line));
    expect(layout.bodyHtml).not.toContain("ДОГОВОР");
    expect(layout.bodyHtml).not.toContain("---");
    expect(layout.bodyHtml).toContain('<p class="legal-bullet">· посетителей Сайта;</p>');
  });

  it("escapes source text in the body and table of contents", () => {
    const layout = renderLegalText('РАЗДЕЛ 1. <script>alert("x")</script>\n<img src=x onerror="alert(1)">', "Документ");
    expect(layout.bodyHtml).not.toMatch(/<script|<img/u);
    expect(layout.contentsHtml).not.toMatch(/<script|<img/u);
    expect(layout.bodyHtml).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(layout.contentsHtml).toContain("&lt;script&gt;");
  });

  it("gives repeated headings distinct, resolvable anchors", () => {
    const layout = renderLegalText("1. УСЛОВИЯ\n1.1. Первый пункт.\n1. УСЛОВИЯ", "Документ");
    expect(layout.bodyHtml).toContain('id="legal-section-1" tabindex="-1"');
    expect(layout.bodyHtml).toContain('id="legal-section-2" tabindex="-1"');
    expect(layout.contentsHtml).toContain('href="#legal-section-1"');
    expect(layout.contentsHtml).toContain('href="#legal-section-2"');
  });

  it("does not turn a law date into a document revision", () => {
    const layout = renderLegalText("Федеральный закон от 27.07.2006 № 152-ФЗ.\n1. ОБЩИЕ ПОЛОЖЕНИЯ", "Документ");
    expect(layout.revisionText).toBeUndefined();
  });

  it.each(["Редакция от 21.11.2026", "Дата редакции: 21 ноября 2026 года"])(
    "uses only the explicitly supplied revision: %s",
    (revision) => {
      const layout = renderLegalText(`${revision}\n1. ОБЩИЕ ПОЛОЖЕНИЯ`, "Документ");
      expect(layout.revisionText).toBe(revision);
      expect(layout.bodyHtml).toContain(revision);
    },
  );

  it("omits an empty table of contents", () => {
    const layout = renderLegalText("Обычный абзац без разделов.", "Документ");
    expect(layout.contentsHtml).toBe("");
    expect(layout.bodyHtml).toBe("<p>Обычный абзац без разделов.</p>");
  });

  it("removes only the first repeated title", () => {
    const layout = renderLegalText("ДОКУМЕНТ\nТекст.\nДокумент", "Документ");
    expect(layout.bodyHtml).toBe("<p>Текст.</p><p>Документ</p>");
  });
});
