# S5 · Экспертные вертикали: ER-TG-001…004, ER-AI-001…003

Milestone: [5](https://github.com/Dimkox/ii-tonya-platform/milestone/5) · Label: `stage:expert-verticals` · Статус: **ЗАВЕРШЁН как default-off**

## Цель этапа

Довести ядро S2 до интерфейсов: read-only финансовые просмотры и мутации рефералов в Telegram, discovery тарифов, ingress для AI-провайдера с durable receipts — всё default-off.

## Что вошло

- ER-TG-001 read-only экспертные финансовые просмотры; ER-TG-002 мутации рефералов
- ER-TG-003 provider-neutral Telegram residency checkout; ER-TG-004 discovery тарифов
- ER-AI-001 default-off AI ingress; ER-AI-002 транспорты; ER-AI-003 durable request receipts
- Prompt-safety граница и redaction ошибок callback-исполнения
- Retry-safe выполнение expert callback с привязкой receipt и output

## Документация-источник (main)

- [`docs/superpowers/plans/2026-08-14-expert-telegram-residency-checkout.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-14-expert-telegram-residency-checkout.md)
- [`docs/superpowers/specs/2026-08-14-expert-telegram-residency-checkout-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-14-expert-telegram-residency-checkout-design.md)
- [`docs/superpowers/plans/2026-08-14-er-ai-002-transport.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-14-er-ai-002-transport.md)
- [`docs/superpowers/plans/2026-08-14-er-ai-003-receipts.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-14-er-ai-003-receipts.md)
- [`docs/superpowers/specs/2026-08-14-expert-ai-ingress-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-14-expert-ai-ingress-design.md)
- [`docs/superpowers/specs/2026-08-13-expert-telegram-queries-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-13-expert-telegram-queries-design.md)
- [`docs/spec/expert-telegram-queries-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-telegram-queries-traceability.md)
- [`docs/spec/expert-telegram-referral-mutations.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-telegram-referral-mutations.md)
- [`docs/spec/expert-telegram-residency-checkout.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-telegram-residency-checkout.md)
- [`docs/spec/expert-residency-tariff-discovery.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-residency-tariff-discovery.md)

## PR этапа

[#12](https://github.com/Dimkox/ii-tonya-platform/pull/12) · [#18](https://github.com/Dimkox/ii-tonya-platform/pull/18) · [#19](https://github.com/Dimkox/ii-tonya-platform/pull/19) · [#20](https://github.com/Dimkox/ii-tonya-platform/pull/20) · [#21](https://github.com/Dimkox/ii-tonya-platform/pull/21) · [#22](https://github.com/Dimkox/ii-tonya-platform/pull/22) · [#23](https://github.com/Dimkox/ii-tonya-platform/pull/23) · [#24](https://github.com/Dimkox/ii-tonya-platform/pull/24) · [#33](https://github.com/Dimkox/ii-tonya-platform/pull/33)

## Гейты и ограничения

TELEGRAM_ENABLED = z.literal("false") — включить нельзя схемой, а tests/e2e/api-boundary.test.ts проверяет это по тексту исходника. Нет project-owned бота, токена, webhook и chat mapping.

**Статус этапа:** ЗАВЕРШЁН как default-off · **Ключ этапа:** `S5` · **Label:** `stage:expert-verticals`

## Открытые вопросы этапа

[#56](https://github.com/Dimkox/ii-tonya-platform/issues/56)

## PR этапа

[#12](https://github.com/Dimkox/ii-tonya-platform/pull/12), [#18](https://github.com/Dimkox/ii-tonya-platform/pull/18), [#19](https://github.com/Dimkox/ii-tonya-platform/pull/19), [#20](https://github.com/Dimkox/ii-tonya-platform/pull/20), [#21](https://github.com/Dimkox/ii-tonya-platform/pull/21), [#22](https://github.com/Dimkox/ii-tonya-platform/pull/22), [#23](https://github.com/Dimkox/ii-tonya-platform/pull/23), [#24](https://github.com/Dimkox/ii-tonya-platform/pull/24), [#33](https://github.com/Dimkox/ii-tonya-platform/pull/33)

## Открытые issues этапа

[#56](https://github.com/Dimkox/ii-tonya-platform/issues/56)

← [все этапы](Stages.md) · [Home](Home.md)
