# S4 · Платежи: YooKassa + изолированный sandbox-контур (default-off)

Milestone: [4](https://github.com/Dimkox/ii-tonya-platform/milestone/4) · Label: `stage:payments` · Статус: **ЗАВЕРШЁН как default-off; активация заблокирована**

## Цель этапа

Выбрать провайдера, реализовать default-off границу YooKassa (client, adapter, verifier, reconciliation reader, webhook capability) и отдельный sandbox-пакет, не попадающий в production-замыкание.

## Что вошло

- Решение: провайдер YooKassa (PR #13)
- packages/integrations/src/yookassa: 8 модулей + 8 тестов, ~1.8k строк
- packages/sandbox-payments + apps/sandbox-api с проверкой изоляции от прод-кода
- Recovery-граница: exact-body-recovery, receipt-contact-source
- Cross-task гейт: SBOM прод-образа обязан НЕ содержать @ii-tonya/sandbox-payments

## Документация-источник (main)

- [`docs/superpowers/plans/2026-08-14-yookassa-provider.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-14-yookassa-provider.md)
- [`docs/superpowers/specs/2026-08-14-yookassa-provider-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-14-yookassa-provider-design.md)
- [`docs/runbooks/yookassa-provider.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/yookassa-provider.md)
- [`docs/superpowers/plans/2026-08-13-sandbox-payment-provider.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-13-sandbox-payment-provider.md)
- [`docs/superpowers/specs/2026-08-13-sandbox-payment-provider-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-13-sandbox-payment-provider-design.md)
- [`docs/runbooks/sandbox-payment-provider.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/sandbox-payment-provider.md)
- [`docs/superpowers/sprint-change-proposal-2026-08-13-yookassa.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/sprint-change-proposal-2026-08-13-yookassa.md)

## PR этапа

[#11](https://github.com/Dimkox/ii-tonya-platform/pull/11) · [#13](https://github.com/Dimkox/ii-tonya-platform/pull/13) · [#17](https://github.com/Dimkox/ii-tonya-platform/pull/17) · [#32](https://github.com/Dimkox/ii-tonya-platform/pull/32) · [#34](https://github.com/Dimkox/ii-tonya-platform/pull/34) · [#35](https://github.com/Dimkox/ii-tonya-platform/pull/35)

## Гейты и ограничения

YooKassa status: BLOCKED. Все кредеды — пустые placeholder, YOOKASSA_ENABLED=false. SBX-TST-009 (smoke на собранном контейнере) не исполнен: «blocked: no image».

**Статус этапа:** ЗАВЕРШЁН как default-off; активация заблокирована · **Ключ этапа:** `S4` · **Label:** `stage:payments`

## Открытые вопросы этапа

[#55](https://github.com/Dimkox/ii-tonya-platform/issues/55)

## PR этапа

[#11](https://github.com/Dimkox/ii-tonya-platform/pull/11), [#13](https://github.com/Dimkox/ii-tonya-platform/pull/13), [#17](https://github.com/Dimkox/ii-tonya-platform/pull/17), [#32](https://github.com/Dimkox/ii-tonya-platform/pull/32), [#34](https://github.com/Dimkox/ii-tonya-platform/pull/34), [#35](https://github.com/Dimkox/ii-tonya-platform/pull/35)

## Открытые issues этапа

[#55](https://github.com/Dimkox/ii-tonya-platform/issues/55)

← [все этапы](Stages.md) · [Home](Home.md)
