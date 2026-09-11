# S6 · Клиентский MVP: catalog · principal · booking · outbox · operator case

Milestone: [6](https://github.com/Dimkox/ii-tonya-platform/milestone/6) · Label: `stage:mvp-client` · Статус: **ЗАВЕРШЁН**

## Цель этапа

Собрать клиентский контур MVP: каталог, сессионный principal, защищённая запись, фильтрованная доставка outbox, inbox операторских кейсов.

## Что вошло

- PR #27 durable client catalog; PR #28 client session principal; PR #29 protected client booking
- PR #26 compose filtered worker outbox delivery; PR #25 durable operator case inbox
- Контракты: client-catalog / client-session-principal / client-booking + amendments
- ARCHITECTURE-SPINE по каждому из четырёх MVP-слайсов
- AC-025 «exact MVP chain» как именованный гейт в CI и DB Gate

## Документация-источник (main)

- [`docs/contracts/client-catalog.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-catalog.md)
- [`docs/contracts/client-session-principal.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-session-principal.md)
- [`docs/contracts/client-booking.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-booking.md)
- [`docs/contracts/client-booking-principal-prerequisite.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-booking-principal-prerequisite.md)
- [`docs/contracts/client-catalog-session-amendment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-catalog-session-amendment.md)
- [`docs/contracts/client-catalog-booking-amendment.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/contracts/client-catalog-booking-amendment.md)
- [`docs/runbooks/client-booking-activation.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/client-booking-activation.md)
- [`docs/runbooks/worker-outbox-delivery.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/worker-outbox-delivery.md)
- [`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md)
- [`docs/superpowers/architecture/architecture-mvp-client-booking-001/ARCHITECTURE-SPINE.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/architecture/architecture-mvp-client-booking-001/ARCHITECTURE-SPINE.md)

## PR этапа

[#25](https://github.com/Dimkox/ii-tonya-platform/pull/25) · [#26](https://github.com/Dimkox/ii-tonya-platform/pull/26) · [#27](https://github.com/Dimkox/ii-tonya-platform/pull/27) · [#28](https://github.com/Dimkox/ii-tonya-platform/pull/28) · [#29](https://github.com/Dimkox/ii-tonya-platform/pull/29)

## Гейты и ограничения

AC-025 прогоняет библиотечные сервисы против реального Postgres, НЕ через buildApp() — поэтому статус клиентских сервисов в composition root этим тестом не проверяется (см. issue «composition root»).

**Статус этапа:** ЗАВЕРШЁН · **Ключ этапа:** `S6` · **Label:** `stage:mvp-client`

## Открытые вопросы этапа

[#46](https://github.com/Dimkox/ii-tonya-platform/issues/46)

## PR этапа

[#25](https://github.com/Dimkox/ii-tonya-platform/pull/25), [#26](https://github.com/Dimkox/ii-tonya-platform/pull/26), [#27](https://github.com/Dimkox/ii-tonya-platform/pull/27), [#28](https://github.com/Dimkox/ii-tonya-platform/pull/28), [#29](https://github.com/Dimkox/ii-tonya-platform/pull/29), [#65](https://github.com/Dimkox/ii-tonya-platform/pull/65)

## Открытые issues этапа

—

← [все этапы](Stages.md) · [Home](Home.md)
