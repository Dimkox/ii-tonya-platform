---
title: "Centre partner policy (DEC-FIN-012)"
type: "policy"
created: "2026-09-17"
status: "approved"
task: "TASK-FIN-012"
live_activation: false
---

# Центр / студия / салон

DEC-FIN-012 **①**: пороги **`>=6` и `>=10`**, consumption = **strict matching band**.

## Тариф (minor = копейки)

Совпадает с `packages/domain/src/partner-pricing.ts` и snapshot `CENTER`:

| Квалифицированных экспертов | Tier | База |
|---:|---|---:|
| 0–5 | STANDARD | 15000 ₽ (`standardPriceMinor`) |
| 6–9 | REFERRED_6_9 | 12000 ₽ |
| 10+ | REFERRED_10_PLUS | 8000 ₽ |

Ровно 5 → нижняя полоса 15000, не 12000. Ровно 6 → 12000.

Квота: 10 мероприятий вместимостью до 30. Сверх квоты: резидент 10% (`1000` bps), нерезидент 15% + 4500 ₽ карточки. Надбавки: online-only +3000 ₽, город-миллионник +5000 ₽. Срок 2_592_000 с.

## Квалификация эксперта

Считается только qualified referral, уже принятый действующим движком рефералки (оплаченное/подтверждённое участие, не «просто регистрация»). Точный event grant — DEC-FIN-015 / FIN-016; здесь порог считает уже qualified count.

## Consumption

Одно событие расходует **свою** корзину capacity=30. Меньшее событие не ест большую полосу организатора (у центра полоса одна).

Boundary: 4→STANDARD, 5→STANDARD, 6→REFERRED_6_9, 9→REFERRED_6_9, 10→REFERRED_10_PLUS.
