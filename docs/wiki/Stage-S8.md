# S8 · Веб: лендинг, SEO, юридические страницы, Metrika

Milestone: [8](https://github.com/Dimkox/ii-tonya-platform/milestone/8) · Label: `stage:web` · Статус: **В РАБОТЕ (#42 draft, #30 draft CONFLICTING)**

## Цель этапа

Публичное лицо продукта: статический лендинг с SEO-каркасом, юридические страницы, verified-файл и счётчик Яндекс.Метрики, доставка жизненного цикла записи.

## Что вошло

- apps/web (29 файлов, ~3.8k строк): config/content/landing-view/legal-content/legal-view/messenger-link + colocated tests
- sitemap.xml, robots.txt, hero в avif/webp, verified-файл Яндекса
- Счётчик Яндекс.Метрики (id=111827123) и путь его восстановления (PR #37)
- Юридический текст оферты и политики в apps/web/src/legal/
- Статический production-роутинг и ссылка на expert promo бота

## Документация-источник (main)

- [`docs/superpowers/plans/2026-08-20-landing-checkout.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-20-landing-checkout.md)
- [`apps/web/src/landing-view.ts`](https://github.com/Dimkox/ii-tonya-platform/blob/main/apps/web/src/landing-view.ts)
- [`apps/web/src/legal-content.ts`](https://github.com/Dimkox/ii-tonya-platform/blob/main/apps/web/src/legal-content.ts)
- [`apps/web/index.html`](https://github.com/Dimkox/ii-tonya-platform/blob/main/apps/web/index.html)
- [`docs/superpowers/specs/2026-08-30-client-terms-and-test-expert-trial-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-30-client-terms-and-test-expert-trial-design.md)

## PR этапа

[#30](https://github.com/Dimkox/ii-tonya-platform/pull/30) · [#37](https://github.com/Dimkox/ii-tonya-platform/pull/37) · [#41](https://github.com/Dimkox/ii-tonya-platform/pull/41) · [#42](https://github.com/Dimkox/ii-tonya-platform/pull/42)

## Гейты и ограничения

Правовые страницы опубликованы из черновиков, но сам лендинг живёт на проде отдельно от API-релиза (статика обновлена 27 авг, API — 14 авг): частичный дрейф деплоя.

**Статус этапа:** В РАБОТЕ (#42 draft, #30 draft CONFLICTING) · **Ключ этапа:** `S8` · **Label:** `stage:web`

## Открытые вопросы этапа

[#59](https://github.com/Dimkox/ii-tonya-platform/issues/59)

## PR этапа

[#30](https://github.com/Dimkox/ii-tonya-platform/pull/30), [#37](https://github.com/Dimkox/ii-tonya-platform/pull/37), [#41](https://github.com/Dimkox/ii-tonya-platform/pull/41), [#42](https://github.com/Dimkox/ii-tonya-platform/pull/42)

## Открытые issues этапа

[#59](https://github.com/Dimkox/ii-tonya-platform/issues/59)

← [все этапы](Stages.md) · [Home](Home.md)
