import { legalDocuments, type LegalDocumentCode } from "./legal-content.js";
import { escapeLegalHtml, renderLegalText } from "./legal-layout.js";
import { renderWebsiteHeader, renderWebsiteFooter } from "./website-chrome.js";

export function renderLegalPage(code: LegalDocumentCode): string {
  const document = legalDocuments[code];
  const layout = renderLegalText(document.text, document.title);
  const revision = layout.revisionText ?? "Дата редакции не указана в исходном документе.";
  return `<a class="skip-link" href="#legal-content">Перейти к документу</a>
    ${renderWebsiteHeader(true)}
    <main id="legal-content" class="legal-page website-legal" tabindex="-1">
      <p class="eyebrow">Юридическая информация</p>
      <h1>${escapeLegalHtml(document.title)}</h1>
      <p class="legal-revision">${escapeLegalHtml(revision)}</p>
      <p class="legal-tools"><a href="/">Вернуться на главную</a><span>Для печати используйте команду «Печать» в браузере.</span></p>
      ${layout.contentsHtml}
      <article class="legal-document">${layout.bodyHtml}</article>
    </main>
    ${renderWebsiteFooter(true)}`;
}
