export interface LegalTextLayout {
  readonly bodyHtml: string;
  readonly contentsHtml: string;
  readonly revisionText: string | undefined;
}

export function escapeLegalHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderLegalText(text: string, title: string): LegalTextLayout {
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
  const headings: Array<{ id: string; text: string }> = [];
  let skippedTitle = false;
  let revisionText: string | undefined;
  const bodyHtml = lines.map((line) => {
    if (line === "" || line === "---") return "";
    if (!skippedTitle && line.toLocaleLowerCase("ru") === title.toLocaleLowerCase("ru")) {
      skippedTitle = true;
      return "";
    }
    // Legislative dates inside a paragraph must never become document revision metadata.
    if (revisionText === undefined && /^(?:Дата редакции\s*:|Редакция\s+(?:от\s+)?\d)/iu.test(line)) {
      revisionText = line;
    }
    const safe = escapeLegalHtml(line);
    if (/^(?:РАЗДЕЛ\s+\d+\.|\d+\.\s+[A-ZА-ЯЁ][A-ZА-ЯЁ0-9\s,]+$)/u.test(line)) {
      const id = `legal-section-${headings.length + 1}`;
      headings.push({ id, text: line });
      return `<h2 id="${id}" tabindex="-1">${safe}</h2>`;
    }
    // Preserve the source bullet marker, numbering and words rather than reconstructing the contract.
    return `<p${line.startsWith("·") ? ' class="legal-bullet"' : ""}>${safe}</p>`;
  }).join("");
  const contentsHtml = headings.length === 0 ? "" :
    `<nav class="legal-toc" aria-label="Оглавление документа"><h2>Оглавление</h2><ol>${headings.map(({ id, text: heading }) => `<li><a href="#${id}">${escapeLegalHtml(heading)}</a></li>`).join("")}</ol></nav>`;
  return { bodyHtml, contentsHtml, revisionText };
}
