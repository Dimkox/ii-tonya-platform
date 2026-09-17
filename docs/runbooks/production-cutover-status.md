---
title: "Production cutover status"
date: "2026-09-17"
release_status: "NO-GO"
---

# Автоматический прогон до продакшена — стоп-линия

Владелец: «все автоматом делай до продакшена». Ниже — что закрыто в репозитории
и что **нельзя** включить без людей/секретов/хоста.

## Сделано в этой поставке (software)

- DEC-FIN-009, DEC-EXP-005, DEC-EXP-006 приняты консервативно (no-change / текущий код).
- 39/39 реестровых DEC закрыты.
- Контракты когорт и партнёров:
  `fin-client-access-policy.md`,
  `fin-client-package-policy.md` (цены TBD),
  `fin-expert-pricing-policy.md`,
  `fin-center-policy.md`,
  `fin-organizer-policy.md`,
  `fin-group-event-settlement.md`,
  `fin-expert-code-lifecycle.md`.
- PLT-008 substrate + expert_handoff read-path уже на `main` (#97).
- Все `*_ENABLED` остаются `false`. Платежи не включаются.

## Не исполняется автоматически (go-live)

Из `docs/runbooks/go-live-evidence.md`, статус **NO-GO**:

| Gate | Почему агент не закрывает |
|---|---|
| Подпись native bundle | нет права на production signing key |
| Migration preflight / restore drill на проде | нет делегированного destructive DB |
| YooKassa test-shop / fiscal / registry | BLOCKED; пустые креды должны остаться пустыми |
| Provider staging (Planerka/Selarti) | default-off, нет RF-доказательства региона |
| Clinical safety directory + outage drill | DEC-EXP-006 = не выдумывать клинический ритм |
| Retention/legal approval | **CONDITIONAL PASS** 2026-09-17: `docs/legal/owner-update-legal-review.md`; уведомление РКН всё ещё человек |
| Manual production environment approval | человек |
| Смена `/opt/ii-tonya-platform/current` | интерактивный root SSH, не unattended |

Текущий native runtime `233f3cf7…` — operational, но не воспроизводимый релиз
текущего SHA. Новый SHA на прод **не выкладывается** этим прогоном.

## Жёсткий блокер продукта

Абсолютные цены клиентских пакетов отсутствуют в источнике. Пока owner не задаст
`price_minor` для Старт/Базовый/Глубокий/Максимальный, TASK-FIN-021 и
`PAYMENTS_ENABLED=true` запрещены.

## Следующий автоматический код (после merge этой ветки)

Не live: закрытие review FIN-001/007/012–015; затем design FIN-005/008/016/018/020
по принятым DEC; код FIN-021 только после цен.
