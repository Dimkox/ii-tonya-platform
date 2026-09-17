---
title: "Expert referral code lifecycle (DEC-FIN-014 / DEC-FIN-022)"
type: "policy"
created: "2026-09-17"
status: "approved"
task: "TASK-FIN-015"
live_activation: false
---

# Lifecycle экспертского referral-кода

DEC-FIN-014 **①**: код **создаётся при регистрации**, **виден после первой успешной оплаты**. DEC-FIN-022 **①**: материалы коллегам — после той же оплаты.

## Namespace

Отдельные таблицы/ledger от клиентского `promo_XXXX`. Экспертский код нельзя применить как клиентский купон (существующий split expert vs client referral).

Формат остаётся действующим expert-referral namespace репозитория (не смешивать с `promo_`). Новый литерал имени не вводится этим документом.

## Состояния

| Поле | Правило |
|---|---|
| createdAt | insert при регистрации резидента, до оплаты |
| visibleAt | первая successful payment по residency order |
| eligibility | display/API кода и промоматериалов только если `visibleAt` задан и код не revoked |
| revocation | audited `expert_referral.code_revoke`; после revoke не показывать и не начислять новые grants |

До оплаты можно спросить «есть ли коллеги»; полные материалы, промокоды и инструкции регистрации — только после `visibleAt`.

Один резидент — один активный код. Коллизия с клиентским namespace запрещена схемой.
