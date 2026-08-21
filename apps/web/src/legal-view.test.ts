import { describe, expect, it } from "vitest";
import { renderLegalPage } from "./legal-view.js";

describe("legal page", () => {
  it("renders a readable document with navigation back to the landing", () => {
    const html = renderLegalPage("privacy");
    expect(html).toContain("<h1>Политика конфиденциальности</h1>");
    expect(html).toContain('href="/"');
    expect(html).toContain(
      "<h2>11. COOKIES, ИЗМЕНЕНИЯ И ДОСТУПНОСТЬ ПОЛИТИКИ</h2>",
    );
    expect(html).toContain("<h2>12. РЕКВИЗИТЫ ОПЕРАТОРА</h2>");
    expect(html).not.toContain("[reference:0]");
  });
});
