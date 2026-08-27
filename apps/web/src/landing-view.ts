import type { PublicConfig } from "./config.js";
import { landingContent } from "./content.js";
import { buildMessengerLink, type MessengerIntent } from "./messenger-link.js";

const href = (config: PublicConfig, intent: MessengerIntent): string =>
  buildMessengerLink(config, intent).href.replaceAll("&", "&amp;");

export function renderLanding(config: PublicConfig): string {
  const content = landingContent;
  const categories = content.clientCategories
    .map(
      ([icon, title, description]) =>
        `<li data-reveal><span aria-hidden="true">${icon}</span><div><strong>${title}</strong><p>${description}</p></div></li>`,
    )
    .join("");
  const clientFlow = content.clientFlow
    .map(
      ([number, title, description]) =>
        `<li data-reveal><span>${number}</span><div><strong>${title}</strong><p>${description}</p></div></li>`,
    )
    .join("");
  const faq = content.faq
    .map(
      ([question, answer], index) =>
        `<details data-reveal><summary><span>${String(index + 1).padStart(2, "0")}</span>${question}<i aria-hidden="true">+</i></summary><p>${answer}</p></details>`,
    )
    .join("");
  const tariffs = content.tariffs
    .map(
      (
        tariff,
        index,
      ) => `<article class="tariff-card${index === 1 ? " featured" : ""}" data-reveal>
        <p class="tariff-number">0${index + 1}</p><h3>${tariff.name}</h3>
        <p class="tariff-price">${tariff.price}</p><p>${tariff.description}</p><p class="tariff-delivery">${tariff.delivery}</p><p class="tariff-setup">${tariff.setup}</p>
        <a data-messenger-action href="${href(config, tariff.code)}">Уточнить условия <span aria-hidden="true">↗</span></a>
      </article>`,
    )
    .join("");

  return `<a class="skip-link" href="#main-content">Перейти к содержанию</a>
    <header class="site-header">
      <a class="brand" href="#top" aria-label="ии-Тоня — наверх"><span>ии</span>Тоня</a>
      <nav aria-label="Основная навигация"><a href="#about">О проекте</a><a href="#clients">Клиентам</a><a href="#experts">Экспертам</a><a href="#payment">Оплата</a><a href="#faq">FAQ</a><a href="#contacts">Контакты</a></nav>
      <a class="header-action" data-messenger-action href="${href(config, "client")}">Открыть диалог</a>
    </header>
    <main id="main-content">
      <section class="hero" id="top">
        <div class="hero-copy" data-reveal><p class="eyebrow">${content.hero.eyebrow}</p><h1>${content.hero.title}</h1><p class="hero-lead">${content.hero.description}</p>
          <div class="hero-actions"><a class="button primary" data-messenger-action href="${href(config, "client")}">Начать диалог <span aria-hidden="true">↗</span></a><a class="button ghost" data-messenger-action href="${href(config, "expert")}">Я эксперт</a></div>
        </div>
        <figure class="hero-portrait" data-reveal><div class="portrait-frame"><img src="/tonya-hero.png" width="1024" height="1536" alt="Иллюстрация ии-Тони — внимательной женщины-навигатора" fetchpriority="high"></div><figcaption>Тамбов и онлайн</figcaption></figure>
        <div class="principles">${content.principles.map(([icon, item], index) => `<p><span>${String(index + 1).padStart(2, "0")}</span><i aria-hidden="true">${icon}</i>${item}</p>`).join("")}</div>
      </section>

      <section class="section about" id="about"><p class="section-index">01 / О проекте</p><div class="section-heading" data-reveal><h2>Это не каталог.<br><em>Это живой диалог.</em></h2><div>${content.about.map((paragraph) => `<p>${paragraph}</p>`).join("")}</div></div>
        <div class="dialog-card" data-reveal><div class="dialog-avatar" aria-hidden="true">ии</div><div class="dialog-stack"><p class="dialog-bubble">Расскажи, что сейчас важно — можно без готового запроса.</p><p class="dialog-bubble right">Хочу найти подходящего специалиста, но не знаю, с чего начать.</p><p class="dialog-bubble">Задам несколько вопросов и покажу понятные варианты.</p></div></div>
        <div class="boundary"><b>Граница сервиса</b><p>Не заменяет врача или психолога</p><p>Не назначает лечение</p><p>Не обещает результат</p></div>
      </section>

      <section class="section client-path" id="clients"><p class="section-index">02 / Клиентам</p><div class="section-heading" data-reveal><h2>Я помогаю тем,<br><em>кто готов развиваться</em></h2><p>Какой бы ни был запрос, ии-Тоня поможет сориентироваться в направлениях и найти того, кто сможет помочь.</p></div>
        <ul class="category-grid">${categories}</ul>
        <div class="client-guide" data-reveal><div><p class="mini-label">Как это работает</p><h3>От запроса к контакту</h3><p>Сервис помогает сориентироваться и сравнить доступную информацию. Решение и договорённости с экспертом остаются за вами.</p></div><ol>${clientFlow}</ol></div>
        <p class="commerce-notice">${content.commerceNotice}</p>
        <a class="button primary section-cta" data-messenger-action href="${href(config, "client")}">Обсудить запрос <span aria-hidden="true">↗</span></a>
      </section>

      <section class="section expert-path" id="experts"><div class="expert-panel"><p class="section-index light">03 / Экспертам</p><h2 data-reveal>Вы — эксперт.<br><em>Мы поможем организовать путь клиента.</em></h2>
        <div class="expert-columns"><div data-reveal><p class="mini-label light">Вам знакомо?</p><ul class="problem-list">${content.expertProblems.map((item) => `<li><span aria-hidden="true">×</span>${item}</li>`).join("")}</ul></div><div data-reveal><p class="mini-label light">Что меняется</p><ul class="benefit-list">${content.expertBenefits.map(([icon, item]) => `<li><span aria-hidden="true">${icon}</span>${item}</li>`).join("")}</ul></div></div>
        <ol class="expert-steps">${content.expertSteps.map(([number, item]) => `<li data-reveal><span>${number}</span><p>${item}</p></li>`).join("")}</ol>
        <a class="button light-button" data-messenger-action href="${href(config, "expert")}">Обсудить размещение <span aria-hidden="true">↗</span></a></div>
      </section>

      <section class="section tariffs" id="tariffs"><p class="section-index">04 / Условия размещения</p><div class="section-heading" data-reveal><h2>Тарифы для экспертов</h2><p>Стоимость Базового тарифа и тарифа «Эксклюзив» фиксирована. Дополнительные работы согласуются отдельно до оформления заказа.</p></div><div class="tariff-grid">${tariffs}</div>
        <div class="tariff-details" data-reveal><div><p class="mini-label">До заключения договора</p><p>${content.commerceNotice}</p></div><div><p class="mini-label">До оплаты бот показывает</p><ul>${content.orderFacts.map((fact) => `<li>${fact}</li>`).join("")}</ul></div></div>
        <a class="text-link" data-messenger-action href="${href(config, "expert")}">Узнать свой тариф →</a>
      </section>

      <section class="section payment" id="payment"><p class="section-index">05 / Заказ и оплата</p><div class="section-heading" data-reveal><h2>Оплата — только в Telegram-боте</h2><div><p>${content.payment.providerNotice}</p><p>${content.payment.security}</p></div></div>
        <ol class="payment-flow">${content.payment.flow.map(([number, title, description]) => `<li data-reveal><span>${number}</span><strong>${title}</strong><p>${description}</p></li>`).join("")}</ol>
        <div class="payment-facts" data-reveal><div><p class="mini-label">Приём платежей</p><div class="provider-logos">${content.payment.providers.map(({ name, logo }) => `<img src="${logo}" width="156" height="40" alt="${name}">`).join("")}</div><p>Также может использоваться иной подключённый платёжный оператор, который будет указан в боте до оплаты.</p></div><div><p class="mini-label">Кассовый чек</p><p>${content.payment.receipt}</p></div><div><p class="mini-label">Условия отмены и возврата</p><p>${content.payment.refund}</p><a href="/oferta">Подробнее в оферте →</a></div></div>
        <p class="commerce-notice">${content.commerceNotice}</p>
        <a class="button primary section-cta" data-messenger-action href="${href(config, "expert")}">Оформить в Telegram-боте <span aria-hidden="true">↗</span></a>
      </section>

      <section class="section faq" id="faq"><p class="section-index">06 / Часто задаваемые вопросы</p><div class="section-heading" data-reveal><h2>Коротко о главном</h2><p>Нажмите на вопрос, чтобы раскрыть ответ. Если нужного ответа нет, напишите ии-Тоне.</p></div><div class="faq-list">${faq}</div></section>

      <section class="section contact" id="contacts"><p class="contact-kicker">Остались вопросы?</p><h2 data-reveal>Напишите нам —<br>ответим в течение 24 часов.</h2><p class="contact-copy">О сервисе, тарифах и сотрудничестве можно спросить в одном диалоге или напрямую у менеджера.</p><div class="contact-actions"><a class="button dark-button" data-messenger-action href="${href(config, "client")}">Открыть чат с ии-Тоней <span aria-hidden="true">↗</span></a><a class="button ghost" href="mailto:${content.operator.email}">${content.operator.email}</a><a class="button ghost" href="tel:+79204742866">${content.operator.phone}</a></div></section>
    </main>
    <footer id="legal"><div><a class="brand footer-brand" href="#top"><span>ии</span>Тоня</a><p>Информационный сервис по выбору экспертов и мероприятий</p></div><nav aria-label="Навигация в подвале"><a href="#about">О проекте</a><a href="#clients">Клиентам</a><a href="#experts">Экспертам</a><a href="#payment">Оплата</a><a href="#faq">FAQ</a></nav><nav aria-label="Юридическая информация"><a href="/privacy">Политика конфиденциальности</a><a href="/oferta">Публичная оферта</a></nav><div class="operator"><p>${content.operator.name}</p><p>ИНН ${content.operator.inn}</p><p>ОГРНИП ${content.operator.ogrnip}</p><p>${content.operator.address}</p><p>${content.operator.schedule}</p><p>${content.operator.responseTime}</p><p>© 2026 ии-Тоня</p></div></footer>`;
}
