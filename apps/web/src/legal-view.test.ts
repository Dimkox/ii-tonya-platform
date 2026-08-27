import { describe, expect, it } from "vitest";
import { renderLegalPage } from "./legal-view.js";

describe("legal page", () => {
  it("renders a readable document with navigation back to the landing", () => {
    const html = renderLegalPage("privacy");
    expect(html).toContain("<h1>Политика конфиденциальности</h1>");
    expect(html).toContain('href="/"');
    expect(html).toContain("<h2>14. ИСПОЛЬЗОВАНИЕ ФАЙЛОВ COOKIES</h2>");
    expect(html).toContain("<h2>17. РЕКВИЗИТЫ ОПЕРАТОРА</h2>");
    expect(html).not.toContain("[reference:0]");
  });
});
