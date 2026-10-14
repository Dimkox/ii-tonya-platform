---
title: "Organizer partner policy (DEC-FIN-012)"
type: "policy"
created: "2026-09-17"
status: "pending_review"
task: "TASK-FIN-013"
live_activation: false
---

# Организатор

Те же пороги DEC-FIN-012: **`>=6` / `>=10`**, strict matching band.

## Тариф

| Квалифицированных экспертов | Tier | База (из **тест-фикстуры** `ORGANIZER`; прод-сида `partner_tariff_policy_versions` в дереве нет — проверено 2026-09-21 — см. `DEC-FIN-030` и `TASK-FIN-032`) |
|---:|---|---|
| 0–5 | STANDARD | `standardPriceMinor` (источник 20000 ₽) |
| 6–9 | REFERRED_6_9 | `referredSixPriceMinor` (15000 ₽) |
| 10+ | REFERRED_10_PLUS | `referredTenPriceMinor` (10000 ₽) |

Включения: **5×50**, **3×100**, **1×500**. Сверх лимита: 10% резидент / 15%+4500 нерезидент. Те же надбавки online/city, что у центра.

## Consumption

Событие ёмкости C расходует **ровно одну** корзину, где `capacity` совпадает с C. Корзина большей ёмкости **не** тратится на меньшее событие. Нет подходящей корзины с count>0 → комиссия сверхквоты, не «перекинуть» с 500 на 50.

Boundary 5/6/10 — как у центра.
