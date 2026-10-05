import { legalDocuments, type LegalDocumentCode } from "./legal-content.js";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function renderDocumentBody(text: string, title: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  let skippedTitle = false;
  return lines
    .map((line) => {
      if (line === "" || line === "---") return "";
      if (
        !skippedTitle &&
        line.toLocaleLowerCase("ru") === title.toLocaleLowerCase("ru")
      ) {
        skippedTitle = true;
        return "";
      }
      const safe = escapeHtml(line);
      if (
        /^(?:РАЗДЕЛ\s+\d+\.|\d+\.\s+[A-ZА-ЯЁ][A-ZА-ЯЁ0-9\s,]+$)/u.test(line)
      ) {
        return `<h2>${safe}</h2>`;
      }
      if (line.startsWith("·")) {
        return `<p class="legal-bullet">${safe.slice(1).trim()}</p>`;
      }
      return `<p>${safe}</p>`;
    })
    .join("");
}

export function renderLegalPage(code: LegalDocumentCode): string {
  const document = legalDocuments[code];
  return `<a class="skip-link" href="#legal-content">Перейти к документу</a>
    <header class="site-header legal-header">
      <a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a>
      <a class="header-action" href="/account">Личный кабинет</a>
      <a class="header-action" href="/">← Вернуться на главную</a>
    </header>
    <main id="legal-content" class="legal-page">
      <p class="eyebrow">Юридическая информация</p>
      <h1>${document.title}</h1>
      <article class="legal-document">${renderDocumentBody(document.text, document.title)}</article>
    </main>
    <footer class="legal-footer"><p>© 2026 ии-Тоня</p><nav aria-label="Юридические документы"><a href="/oferta">Оферта</a><a href="/privacy">Конфиденциальность</a></nav></footer>`;
}
