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

Арифметика полос совпадает с `packages/domain/src/partner-pricing.ts`. Сами цены полос взяты из **тест-фикстуры** `packages/db/src/repositories/partner-commerce-repository.test.ts:24` (`1500000/1200000/800000` minor = 15000/12000/8000 ₽): строки `partner_tariff_policy_versions` со статусом `approved` в миграциях и скриптах нет — проверено 2026-09-21, то есть таблица ниже описывает формулу, а не действующий тариф → `DEC-FIN-030` (утвердить абсолютные цены) и `TASK-FIN-032` (опубликовать approved-строки):

| Квалифицированных экспертов | Tier | База |
|---:|---|---:|
| 0–5 | STANDARD | 15000 ₽ (`standardPriceMinor`) |
| 6–9 | REFERRED_6_9 | 12000 ₽ |
| 10+ | REFERRED_10_PLUS | 8000 ₽ |

Ровно 5 → нижняя полоса 15000, не 12000. Ровно 6 → 12000.

Квота: 10 мероприятий вместимостью до 30. Сверх квоты: резидент 10% (`1000` bps), нерезидент 15% + 4500 ₽ карточки. Надбавки: online-only +3000 ₽, город-миллионник +5000 ₽. Срок 2_592_000 с.

## Квалификация эксперта

Считается только qualified referral, уже принятый действующим движком рефералки (оплаченное/подтверждённое участие, не «просто регистрация»). Точный event grant — DEC-FIN-015 / FIN-016; здесь порог считает уже qualified count. **Порог не исполняется в production-пути:** единственная цепочка котировки жёстко передаёт `qualifiedExpertCount: 0` (`packages/db/src/repositories/partner-commerce-repository.ts:101` — проверено 2026-09-21), поэтому каждая сохраняемая shadow-котировка попадает в `STANDARD` независимо от числа рефералов; Границы полосы закреплены тестами 2026-09-21 (`partner-pricing.test.ts` покрывает 0..11 и 99 на CENTER и ORGANIZER), но проводки нет: источника `qualifiedExpertCount` в схеме не существует — у `commercial_participants` только `id, user_id, participant_kind, onboarding_state, created_at`, а `expert_referrals` связывает эксперта с экспертом (`expert-residency.ts:285`) → см. открытый `DEC-FIN-031` (модель аффилиации) и `TASK-FIN-029` (проводка после него).

## Consumption

Одно событие расходует **свою** корзину capacity=30. Меньшее событие не ест большую полосу организатора (у центра полоса одна).

Boundary: 4→STANDARD, 5→STANDARD, 6→REFERRED_6_9, 9→REFERRED_6_9, 10→REFERRED_10_PLUS.
