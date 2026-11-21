import type { PublicConfig } from "./config.js";
import { landingContent } from "./content.js";
import { renderWebsiteHeader, renderWebsiteFooter } from "./website-chrome.js";
import { websiteContent, type WebsiteFaq } from "./website-content.js";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Keep the existing expert entry point until source-specific bot routes are verified.
const expertInquiry = "https://t.me/ii_tonya_expert_promo_bot?start=expert";

function renderFaq(items: WebsiteFaq): string {
  return items
    .map(
      ([question, answer]) =>
        `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`,
    )
    .join("");
}

function renderDemos(): string {
  return websiteContent.demos
    .map(
      (demo) => `<article class="message-packages" data-demo-id="${demo.id}" aria-labelledby="demo-${demo.id}-title">
        <h4 id="demo-${demo.id}-title">${escapeHtml(demo.title)}</h4>
        <p><strong>Учебный сценарий. Вымышленные данные.</strong></p>
        <div class="dialog-stack">${demo.messages
          .map(
            ([speaker, text]) =>
              `<p class="dialog-bubble"><strong>${escapeHtml(speaker)}:</strong> ${escapeHtml(text)}</p>`,
          )
          .join("")}</div>
        <p>${escapeHtml(demo.result)}</p>
      </article>`,
    )
    .join("");
}

// The public promotional destination is product-owned, not an environment override.
export function renderLanding(_config: PublicConfig): string {
  const copy = websiteContent;
  const { operator } = landingContent;
  const categories = copy.directions
    .map(
      ([title, description]) =>
        `<li><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div></li>`,
    )
    .join("");
  const mailto = `mailto:${escapeHtml(operator.email)}`;
  const phone = operator.phone.replace(/[^+\d]/gu, "");

  return `<a class="skip-link" href="#main-content">Перейти к содержанию</a>
    ${renderWebsiteHeader()}
    <main id="main-content" class="website-v11" tabindex="-1">
      <section class="hero" id="top" aria-labelledby="hero-title" data-website-block="S01">
        <div class="hero-copy"><h1 id="hero-title">${copy.title}</h1>
          <p class="hero-lead">Найдите подходящее направление развития, изучите услуги и выберите следующий шаг.</p>
          <p class="hero-subtitle">${copy.slogan}</p>
          <ul class="hero-proof" aria-label="Разделы сервиса"><li>Открытый каталог</li><li>Личный кабинет</li><li>Экспертный Telegram-бот</li></ul>
          <div class="hero-actions"><a class="button primary" href="/catalog">Открыть каталог услуг</a><a class="button ghost" href="#roles">Выбрать роль и условия участия</a></div>
          <p>Просмотр каталога не создаёт запись. Доступность персонального диалога, записи и других возможностей уточняйте перед использованием.</p>
        </div>
        <figure class="hero-portrait"><div class="portrait-frame"><picture><source type="image/avif" srcset="/tonya-hero-512.avif 512w, /tonya-hero-1024.avif 1024w" sizes="(max-width: 900px) 86vw, 50vw"><source type="image/webp" srcset="/tonya-hero-512.webp 512w, /tonya-hero-1024.webp 1024w" sizes="(max-width: 900px) 86vw, 50vw"><img src="/tonya-hero.png" width="1024" height="1536" alt="Иллюстрация ии-Тони — внимательной женщины-навигатора" fetchpriority="high"></picture></div><figcaption>В вашем городе и онлайн — по доступным предложениям</figcaption></figure>
      </section>

      <section class="section about" id="about" aria-labelledby="about-title" data-website-block="S02">
        <div class="section-heading"><h2 id="about-title">О проекте</h2><div><p>ии-Тоня — виртуальный навигатор по миру саморазвития. Здесь можно познакомиться с направлениями и опубликованными предложениями, а вопросы подключения обсудить с командой.</p><p>Цель сервиса — сделать выбор понятнее. Вопросы проверки профиля и нестандартные организационные ситуации требуют участия команды.</p></div></div>
        <div class="boundary"><b>Граница сервиса</b><p>Не заменяет врача или психолога</p><p>Не назначает лечение</p><p>Не обещает результат услуги</p></div>
        <div id="demo" aria-labelledby="demo-title"><h3 id="demo-title">Как может выглядеть работа ии-Тони</h3><p>Ниже три учебных сценария, а не работающий чат. Они не создают бронь, платёж, заявку или сообщение реальному человеку.</p>${renderDemos()}<a class="button ghost" data-messenger-action href="${expertInquiry}">Обсудить подключение эксперта в Telegram</a><p>Этот переход открывает экспертный бот отдельно от учебных примеров.</p></div>
      </section>

      <section class="section" id="how-it-works" aria-labelledby="how-title" data-website-block="S03">
        <h2 id="how-title">Как устроен путь пользователя</h2><p>Сценарий развития сервиса. Уточните, какие этапы доступны сейчас; описание не означает, что все перечисленные операции уже включены.</p>
        <ol class="expert-steps">${copy.steps.map(([title, text], index) => `<li><span>${index + 1}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></li>`).join("")}</ol>
      </section>

      <section class="section" id="directions" aria-labelledby="directions-title" data-website-block="S04">
        <h2 id="directions-title">Направления развития</h2><p>Наличие направления не гарантирует наличие конкретной услуги или эффективность метода. Смотрите актуальные предложения в каталоге.</p><ul class="category-grid">${categories}</ul><a class="text-link" href="/catalog">Перейти в каталог услуг</a>
      </section>

      <section class="section" id="roles" aria-labelledby="roles-title" data-website-block="S05">
        <h2 id="roles-title">Найдите свой путь в ии-Тоне</h2><p>${copy.roleIntroduction}</p>
        <ul class="category-grid">${copy.roles.map(([id, title, description]) => `<li><div><h3><a href="#${id}">${escapeHtml(title)}</a></h3><p>${escapeHtml(description)}</p></div></li>`).join("")}</ul><p>Выбор раздела — только навигация. Он не меняет ваши права доступа и не означает согласия на обработку данных или рассылку.</p>
      </section>

      <section class="section client-path" id="clients" aria-labelledby="clients-title" data-website-block="S06">
        <div class="section-heading"><h2 id="clients-title">Клиентам</h2><p>Начните с опубликованных услуг. Для просмотра каталога не нужно описывать личную ситуацию.</p></div>
        <h3>Планируемые возможности сопровождения</h3><p>Ниже — направления развития сервиса, а не обещание уже включённых функций. Фактическую доступность и условия уточняйте у команды.</p>
        <ul class="category-grid" data-feature-status="planned">${copy.clientBenefits.map(([title, text]) => `<li><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p></div></li>`).join("")}</ul>
        <p>Не отправляйте личную историю, сведения о здоровье, документы или данные других людей через публичный сайт.</p>
        <div class="hero-actions"><a class="button primary" href="/catalog">Посмотреть услуги</a><a class="button ghost" href="/account">Личный кабинет</a></div><p>Кабинет доступен после авторизации, если вход включён. Просмотр услуг не означает подтверждённую запись или оплату.</p>
      </section>

      <section class="section expert-path" id="experts" aria-labelledby="experts-title" data-website-block="S07">
        <div class="expert-panel"><h2 id="experts-title">Ваше призвание — практика. Обсудим, как ии-Тоня может помочь с обращениями и записью.</h2>
          <p>Расскажите о специализации, услугах, формате и доступном времени. Сначала согласуются условия и порядок проверки; переход в бот не активирует размещение.</p>
          <ul class="benefit-list"><li>Понятное описание услуг.</li><li>Меньше повторяющихся организационных вопросов при подключении соответствующих возможностей.</li><li>Согласованные условия и порядок обновления расписания.</li></ul>
          <h3>Порядок подключения</h3><ol>${copy.expertSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
          <aside class="contract-boundary" aria-label="Границы условий"><p>Размещение не гарантирует поток клиентов, их платёжеспособность или заполненный зал. Доступные операции и участие менеджера уточняются до подключения.</p><p>Эксперт обязан соблюдать требования законодательства РФ, в том числе в части маркировки рекламы. Оформление конкретного материала обсуждается с менеджером.</p></aside>
          <div id="tariffs" aria-labelledby="tariffs-title"><h3 id="tariffs-title">Условия участия</h3><p>Стоимость, состав услуг, проверка и порядок активации определяются действующими условиями. Здесь не публикуется неподтверждённый прайс.</p></div>
          <div class="hero-actions"><a class="button light-button" data-messenger-action href="${expertInquiry}">Уточнить условия участия</a><a class="button light-button" href="#demo">Посмотреть, как работает ии-Тоня</a></div><p>Демонстрация и знакомство с условиями не означают автоматического подключения или оплаты.</p>
        </div>
      </section>

      <section class="section" id="organizers" aria-labelledby="organizers-title" data-website-block="S08">
        <h2 id="organizers-title">Организаторам</h2><p>Обсудите тему события, аудиторию, площадку и участие экспертов. Состав услуг, порядок обновления сведений, получатель оплаты и коммерческие условия согласуются до размещения. Заполненный зал и автоматическая продажа билетов не гарантируются.</p>
        <div class="faq-list">${renderFaq(copy.organizerFaq)}</div><a class="button primary" href="#contacts">Обсудить мероприятие с командой</a>
      </section>

      <section class="section" id="spaces" aria-labelledby="spaces-title" data-website-block="S09">
        <h2 id="spaces-title">Пространствам</h2><p>Уточните условия размещения, оперативного обновления занятости и подтверждения брони. Резерв, подтверждённая бронь и полученная оплата — разные состояния.</p>
        <div class="faq-list">${renderFaq(copy.spaceFaq)}</div><a class="button primary" href="#contacts">Обсудить размещение пространства</a>
      </section>

      <section class="section faq" id="faq" aria-labelledby="faq-title" data-website-block="S10">
        <div class="section-heading"><h2 id="faq-title">Ответы на вопросы</h2><p>Откройте вопрос, чтобы прочитать ответ. Справочная информация не заменяет действующие условия конкретной услуги.</p></div><div class="faq-list">${renderFaq(copy.generalFaq)}</div>
      </section>

      <section class="section contact" id="contacts" aria-labelledby="contacts-title" data-website-block="S11">
        <h2 id="contacts-title">Связаться с командой</h2><p class="contact-copy">По вопросам сервиса, тарифов и сотрудничества используйте e-mail или телефон. Срок ответа уточняется у команды. Не отправляйте личную историю, сведения о здоровье, документы или данные других людей.</p>
        <div class="contact-actions"><a class="button dark-button" href="${mailto}">Написать по e-mail</a><a class="button ghost" href="${mailto}">${escapeHtml(operator.email)}</a><a class="button ghost" href="tel:${escapeHtml(phone)}">${escapeHtml(operator.phone)}</a></div>
      </section>
    </main>
    ${renderWebsiteFooter()}`;
}
