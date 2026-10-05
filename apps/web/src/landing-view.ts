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
        <p class="tariff-price">${tariff.price}</p><p>${tariff.description}</p><p class="tariff-setup">${tariff.setup}</p>
        <a data-messenger-action href="${href(config, tariff.code)}">Уточнить условия <span aria-hidden="true">↗</span></a>
      </article>`,
    )
    .join("");

  return `<a class="skip-link" href="#main-content">Перейти к содержанию</a>
    <header class="site-header">
      <a class="brand" href="#top" aria-label="ии-Тоня — наверх"><span>ии-</span>Тоня</a>
      <nav aria-label="Основная навигация"><a href="#about">О проекте</a><a href="#clients">Клиентам</a><a href="/catalog">Каталог услуг</a><a href="#experts">Экспертам</a><a href="#tariffs">Тарифы</a><a href="#faq">FAQ</a><a href="#contacts">Контакты</a></nav>
      <a class="header-action" href="/account">Личный кабинет</a>
      <a class="header-action" href="/catalog">Открыть каталог</a>
    </header>
    <main id="main-content" tabindex="-1">
      <section class="hero" id="top">
        <div class="hero-copy" data-reveal><p class="section-index">01 / Первый экран</p><h1>${content.hero.title}</h1><p class="hero-lead">${content.hero.description}</p><p class="hero-subtitle">${content.hero.subtitle}</p>
          <div class="hero-actions"><a class="button primary" href="/account">Открыть личный кабинет <span aria-hidden="true">↗</span></a><a class="button ghost" data-messenger-action href="${href(config, "expert")}">Попробовать как эксперт</a><a class="button ghost" href="/catalog">Каталог услуг</a></div>
        </div>
        <figure class="hero-portrait" data-reveal><div class="portrait-frame"><picture><source type="image/avif" srcset="/tonya-hero-512.avif 512w, /tonya-hero-1024.avif 1024w" sizes="(max-width: 900px) 86vw, 50vw"><source type="image/webp" srcset="/tonya-hero-512.webp 512w, /tonya-hero-1024.webp 1024w" sizes="(max-width: 900px) 86vw, 50vw"><img src="/tonya-hero.png" width="1024" height="1536" alt="Иллюстрация ии-Тони — внимательной женщины-навигатора" fetchpriority="high"></picture></div><figcaption>Тамбов и онлайн</figcaption></figure>
        <div class="principles">${content.principles.map(([icon, item], index) => `<p><span>${String(index + 1).padStart(2, "0")}</span><i aria-hidden="true">${icon}</i>${item}</p>`).join("")}</div>
      </section>

      <section class="section about" id="about"><p class="section-index">02 / О проекте</p><div class="section-heading" data-reveal><h2>Каталог услуг.<br><em>Понятная навигация.</em></h2><div>${content.about.map((paragraph) => `<p>${paragraph}</p>`).join("")}<p><strong>${content.aboutProposition}</strong></p></div></div>
        <div class="dialog-card" data-reveal><div class="dialog-avatar" aria-hidden="true">ии</div><div class="dialog-stack"><p class="dialog-bubble">Каталог услуг открыт без регистрации.</p><p class="dialog-bubble right">Где посмотреть согласия и свои данные?</p><p class="dialog-bubble">После авторизации в личном кабинете, если вход включён. Состояние согласий доступно при включённом разделе согласий. Не присылай личную историю или сведения о здоровье в бот.</p></div></div>
        <div class="boundary"><b>Граница сервиса</b><p>Не заменяет врача или психолога</p><p>Не назначает лечение</p><p>Не обещает результат</p></div>
      </section>

      <section class="section client-path" id="clients"><p class="section-index">03 / Клиентам</p><div class="section-heading" data-reveal><h2>Я помогаю тем,<br><em>кто готов развиваться</em></h2><p>Какой бы ни был твой запрос — я помогу найти того, кто сможет помочь.</p></div>
        <ul class="category-grid">${categories}</ul>
        <div class="message-packages"><h3>Планируемые пакеты сообщений</h3><p>Покупка пакетов пока недоступна. Ниже — условия для будущего запуска; сейчас для просмотра каталога пакет не нужен.</p><ul>${content.messagePackages.map(([name, details]) => `<li><strong>«${name}»</strong> — ${details}</li>`).join("")}</ul><p>Условия будущего диалога: каждое сообщение в диалоге — 1 сообщение из пакета. Никаких скрытых платежей.</p><p>${content.couponOffer}</p><p>${content.clientCta}</p></div>
        <a class="button primary section-cta" href="/account">Открыть личный кабинет <span aria-hidden="true">↗</span></a>
      </section>

      <section class="section expert-path" id="experts"><div class="expert-panel"><p class="section-index light">04 / Экспертам</p><h2 data-reveal>Вы — эксперт.<br><em>Мы поможем вам найти клиентов.</em></h2>
        <div class="expert-columns"><div data-reveal><p class="mini-label light">Вам знакомо?</p><ul class="problem-list">${content.expertProblems.map((item) => `<li><span aria-hidden="true">×</span>${item}</li>`).join("")}</ul></div><div data-reveal><p class="mini-label light">А теперь представьте</p><ul class="promise-list">${content.expertPromise.map((item) => `<li><span aria-hidden="true">✓</span>${item}</li>`).join("")}</ul></div></div>
        <p class="mini-label light">Преимущества для экспертов</p><ul class="benefit-list benefit-grid">${content.expertBenefits.map(([icon, item]) => `<li><span aria-hidden="true">${icon}</span>${item}</li>`).join("")}</ul>
        <ol class="expert-steps">${content.expertSteps.map(([number, item]) => `<li data-reveal><span>${number}</span><p>${item}</p></li>`).join("")}</ol>
        <aside class="contract-boundary" aria-label="Границы условий"><p>Срок и полнота набора целевой аудитории на мероприятие не гарантируются и зависят от клиентских запросов в конкретный период времени.</p><p>Эксперт обязан соблюдать требования законодательства РФ, в том числе в части маркировки рекламы.</p><p>Если Эксперт подтверждает запись, Клиент получает уведомление с подтверждением.</p></aside>
        <p>${content.expertCta}</p><a class="button light-button" data-messenger-action href="${href(config, "expert")}">Попробовать как эксперт <span aria-hidden="true">↗</span></a></div>
      </section>

      <section class="section tariffs" id="tariffs"><p class="section-index">05 / Условия размещения</p><div class="section-heading" data-reveal><h2>Тарифы для экспертов</h2><p>Узнайте свой персональный тариф: стоимость зависит от ниши, города и формата работы.</p></div><div class="tariff-grid">${tariffs}</div>
        <div class="tariff-details" data-reveal><div><p class="mini-label">Порядок оплаты групповых мероприятий</p><ol>${content.eventPayment.map((item) => `<li>${item}</li>`).join("")}</ol></div><div><p class="mini-label">Гибкий подход к стоимости</p><ul>${content.tariffFactors.map((factor) => `<li>${factor}</li>`).join("")}</ul><p>Напишите ии-Тоне с промокодом «тест эксперт» — рассчитаем персональный тариф.</p></div></div>
        <a class="text-link" data-messenger-action href="${href(config, "expert")}">Узнать свой тариф →</a>
      </section>

      <section class="section faq" id="faq"><p class="section-index">06 / Часто задаваемые вопросы</p><div class="section-heading" data-reveal><h2>Коротко о главном</h2><p>Нажмите на вопрос, чтобы раскрыть ответ. По вопросам работы сервиса используйте контакты ниже, не отправляя личную историю или сведения о здоровье.</p></div><div class="faq-list">${faq}</div></section>

      <section class="section contact" id="contacts"><p class="section-index">07 / Контакты</p><p class="contact-kicker">Остались вопросы?</p><h2 data-reveal>Напишите нам —<br>ответим в течение 24 часов.</h2><p class="contact-copy">О работе сервиса, тарифах и сотрудничестве можно спросить напрямую у менеджера по e-mail или телефону ниже. Персональный диалог в клиентском боте пока недоступен.</p><div class="contact-actions"><a class="button dark-button" href="mailto:${content.operator.email}">Написать по e-mail <span aria-hidden="true">↗</span></a><form class="contact-form-stub" aria-disabled="true"><p>${content.contact.formNotice}</p><label for="contact-stub">Телефон / Telegram / WhatsApp</label><input id="contact-stub" type="text" disabled aria-disabled="true" placeholder="Недоступно в тестовой версии"><button type="button" disabled>Отправить</button></form><a class="button ghost" href="mailto:${content.operator.email}">${content.operator.email}</a><a class="button ghost" href="tel:+79204742866">${content.operator.phone}</a></div></section>
    </main>
    <footer id="legal"><div><p class="section-index light">08 / Футер</p><a class="brand footer-brand" href="#top"><span>ии-</span>Тоня</a><p>ии-Тоня: сервис персонального сопровождения в саморазвитии</p><ul class="social-labels" aria-label="Социальные сети">${content.socialLabels.map((label) => `<li>${label} — ссылка скоро появится</li>`).join("")}</ul></div><nav aria-label="Навигация в подвале"><a href="#about">О проекте</a><a href="#experts">Экспертам</a><a href="#clients">Клиентам</a><a href="#faq">FAQ</a><a href="#contacts">Контакты</a></nav><nav aria-label="Юридическая информация"><a href="/privacy">Политика конфиденциальности</a><a href="/oferta">Публичная оферта</a></nav><div class="operator"><p>${content.operator.name}</p><p>ИНН ${content.operator.inn}</p><p>ОГРНИП ${content.operator.ogrnip}</p><p>${content.operator.address}</p><p>${content.operator.schedule}</p><p>${content.operator.responseTime}</p><p>© 2026 ии-Тоня. Все права защищены.</p></div></footer>`;
}
