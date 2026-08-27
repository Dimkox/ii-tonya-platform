import type { PublicConfig } from "./config.js";
import { landingContent } from "./content.js";
import { buildMessengerLink, type MessengerIntent } from "./messenger-link.js";

const href = (config: PublicConfig, intent: MessengerIntent): string =>
  buildMessengerLink(config, intent).href.replaceAll("&", "&amp;");

export function renderLanding(config: PublicConfig): string {
  const content = landingContent;
  const faq = content.faq
    .map(
      ([question, answer], index) =>
        `<details><summary><span>${String(index + 1).padStart(2, "0")}</span>${question}</summary><p>${answer}</p></details>`,
    )
    .join("");
  const tariffs = content.tariffs
    .map(
      (
        tariff,
        index,
      ) => `<article class="tariff-card${index === 1 ? " featured" : ""}">
        <p class="tariff-number">0${index + 1}</p><h3>${tariff.name}</h3>
        <p class="tariff-price">${tariff.price}</p><p>${tariff.description}</p>
        <a data-messenger-action href="${href(config, tariff.code)}">Уточнить условия <span aria-hidden="true">↗</span></a>
      </article>`,
    )
    .join("");
  return `
    <a class="skip-link" href="#main-content">Перейти к содержанию</a>
    <header class="site-header"><a class="brand" href="#top"><span>ии</span>Тоня</a>
      <nav aria-label="Основная навигация"><a href="#about">О сервисе</a><a href="#clients">Клиентам</a><a href="#experts">Экспертам</a><a href="#tariffs">Тарифы</a></nav>
      <a class="header-action" data-messenger-action href="${href(config, "client")}">Открыть диалог</a>
    </header>
    <main id="main-content">
      <section class="hero" id="top"><div class="hero-copy"><p class="eyebrow">${content.hero.eyebrow}</p><h1>${content.hero.title}</h1><p class="hero-lead">${content.hero.description}</p>
        <div class="hero-actions"><a class="button primary" data-messenger-action href="${href(config, "client")}">Подобрать эксперта <span>↗</span></a><a class="button ghost" data-messenger-action href="${href(config, "expert")}">Я эксперт</a></div></div>
        <div class="hero-orbit" aria-hidden="true"><div class="portrait-mark"><span>ии</span><strong>Т</strong></div><p class="orbit-note top">Тамбов<br>и онлайн</p><p class="orbit-note bottom">Спокойно.<br>По делу.</p></div>
        <div class="principles">${content.principles.map((item, index) => `<p><span>0${index + 1}</span>${item}</p>`).join("")}</div>
      </section>
      <section class="section about" id="about"><p class="section-index">01 / О сервисе</p><div class="section-heading"><h2>Не каталог из сотен анкет.<br><em>Один понятный диалог.</em></h2><p>ии-Тоня — информационный помощник. Она помогает сравнить направления, формат, стоимость и доступные слоты. Решение всегда остаётся за человеком.</p></div><div class="boundary"><b>Граница сервиса</b><p>Не ставит диагнозы</p><p>Не назначает лечение</p><p>Не обещает результат</p></div></section>
      <section class="section client-path" id="clients"><p class="section-index">02 / Клиентам</p><div class="section-heading"><h2>От запроса<br>до записи</h2><p>Без анкет на десять экранов. Вопросы появляются по одному и только когда нужны для выбора.</p></div><ol class="steps">${content.clientSteps.map(([number, text]) => `<li><span>${number}</span><p>${text}</p></li>`).join("")}</ol><a class="text-link" data-messenger-action href="${href(config, "client")}">Начать диалог →</a></section>
      <section class="section expert-path" id="experts"><div class="expert-panel"><p class="section-index light">03 / Экспертам</p><h2>Практика — ваша.<br><em>Организация — наша.</em></h2><ul>${content.expertBenefits.map((item) => `<li>${item}</li>`).join("")}</ul><a class="button light-button" data-messenger-action href="${href(config, "expert")}">Узнать об участии ↗</a></div><div class="expert-aside" aria-hidden="true"><span>для</span><strong>экспертов</strong><i>●</i></div></section>
      <section class="section tariffs" id="tariffs"><p class="section-index">04 / Информационный каталог</p><div class="section-heading"><h2>Форматы размещения</h2><p>Тарифы показаны для ориентира. Действующие условия и точная стоимость подтверждаются в диалоге до оформления.</p></div><div class="tariff-grid">${tariffs}</div><p class="catalog-note">Разовый организационный платёж и условия мероприятий применяются только после подтверждения в сервисе.</p></section>
      <section class="section faq" id="faq"><p class="section-index">05 / Вопросы</p><div class="section-heading"><h2>Коротко о главном</h2><p>Если ответа нет, ии-Тоня уточнит информацию в диалоге.</p></div><div class="faq-list">${faq}</div></section>
      <section class="section contact" id="contacts"><p class="contact-kicker">Готовы начать?</p><h2>Один диалог.<br>Следующий шаг — ваш.</h2><a class="button dark-button" data-messenger-action href="${href(config, "client")}">Написать ии-Тоне ↗</a></section>
    </main>
    <footer id="legal"><a class="brand footer-brand" href="#top"><span>ии</span>Тоня</a><p>Информационный сервис по выбору экспертов и записи.</p><p>Юридическая информация предоставляется в диалоге.</p><p>© 2026 ии-Тоня</p></footer>`;
}
