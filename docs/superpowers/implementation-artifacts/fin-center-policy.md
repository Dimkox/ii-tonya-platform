---
title: "Centre partner policy (DEC-FIN-012)"
type: "policy"
created: "2026-09-17"
status: "pending_review"
task: "TASK-FIN-012"
live_activation: false
---

# Центр / студия / салон

DEC-FIN-012 **①**: пороги **`>=6` и `>=10`**, consumption = **strict matching band**.

## Тариф (minor = копейки)

Арифметика полос совпадает с `packages/domain/src/partner-pricing.ts`. Сами цены полос взяты из **тест-фикстуры** `packages/db/src/repositories/partner-commerce-repository.test.ts:24` (`1500000/1200000/800000` minor = 15000/12000/8000 ₽): строки `partner_tariff_policy_versions` со статусом `approved` в миграциях и скриптах нет — проверено 2026-09-21, то есть таблица ниже описывает формулу, а не действующий тариф → `TASK-FIN-029`:

| Квалифицированных экспертов | Tier | База |
|---:|---|---:|
| 0–5 | STANDARD | 15000 ₽ (`standardPriceMinor`) |
| 6–9 | REFERRED_6_9 | 12000 ₽ |
| 10+ | REFERRED_10_PLUS | 8000 ₽ |

Ровно 5 → нижняя полоса 15000, не 12000. Ровно 6 → 12000.

Квота: 10 мероприятий вместимостью до 30. Сверх квоты: резидент 10% (`1000` bps), нерезидент 15% + 4500 ₽ карточки. Надбавки: online-only +3000 ₽, город-миллионник +5000 ₽. Срок 2_592_000 с.

## Квалификация эксперта

Считается только qualified referral, уже принятый действующим движком рефералки (оплаченное/подтверждённое участие, не «просто регистрация»). Точный event grant — DEC-FIN-015 / FIN-016; здесь порог считает уже qualified count. **Порог не исполняется в production-пути:** единственная цепочка котировки жёстко передаёт `qualifiedExpertCount: 0` (`packages/db/src/repositories/partner-commerce-repository.ts:101` — проверено 2026-09-21), поэтому каждая сохраняемая shadow-котировка попадает в `STANDARD` независимо от числа рефералов; boundary-тестов на 4/5/9 нет (`partner-pricing.test.ts` покрывает 0/6/10) → `TASK-FIN-029`.

## Consumption

Одно событие расходует **свою** корзину capacity=30. Меньшее событие не ест большую полосу организатора (у центра полоса одна).

Boundary: 4→STANDARD, 5→STANDARD, 6→REFERRED_6_9, 9→REFERRED_6_9, 10→REFERRED_10_PLUS.
