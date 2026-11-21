import { landingContent } from "./content.js";
import { websiteContent } from "./website-content.js";

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function renderRoleLinks(prefix: string): string {
  return websiteContent.roles.map(([id, title]) =>
    `<a href="${prefix}#${id}">${escapeHtml(title)}</a>`).join("");
}

// Legal routes return to the landing section rather than an absent local anchor.
export function renderWebsiteHeader(linksToLanding = false): string {
  const prefix = linksToLanding ? "/" : "";
  const copy = websiteContent;
  const roleLinks = renderRoleLinks(prefix);
  return `<header class="site-header website-header">
      <div><a class="brand" href="${prefix}#top" aria-label="ии-Тоня — наверх"><span>ии-</span>Тоня</a><p>${copy.tagline}</p></div>
      <nav aria-label="Основная навигация"><a href="${prefix}#about">О проекте</a>${roleLinks}<a href="${prefix}#faq">FAQ</a><a href="${prefix}#contacts">Контакты</a></nav>
      <a class="header-action" href="/account">Личный кабинет</a>
      <a class="header-action" href="/expert/account">Кабинет эксперта</a>
      <a class="header-action" href="/catalog">Каталог услуг</a>
    </header>`;
}

export function renderWebsiteFooter(linksToLanding = false): string {
  const prefix = linksToLanding ? "/" : "";
  const copy = websiteContent;
  const { operator } = landingContent;
  const roleLinks = renderRoleLinks(prefix);
  return `<footer id="legal" class="website-footer"${linksToLanding ? "" : ' data-website-block="S12"'}>
      <div><a class="brand footer-brand" href="${prefix}#top"><span>ии-</span>Тоня</a><p>${copy.tagline}</p><p>${copy.slogan}</p></div>
      <nav aria-label="Навигация в подвале"><a href="${prefix}#about">О проекте</a>${roleLinks}<a href="${prefix}#faq">FAQ</a><a href="${prefix}#contacts">Контакты</a></nav>
      <nav aria-label="Юридическая информация"><a href="/privacy">Политика конфиденциальности</a><a href="/oferta">Публичная оферта</a></nav>
      <div class="operator"><p>${escapeHtml(operator.name)}</p><p>ИНН ${escapeHtml(operator.inn)}</p><p>ОГРНИП ${escapeHtml(operator.ogrnip)}</p><p>${escapeHtml(operator.address)}</p><p>© 2026 ии-Тоня. Все права защищены.</p></div>
    </footer>`;
}
