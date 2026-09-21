---
title: "Expert personal pricing policy (DEC-FIN-007 / DEC-FIN-009)"
type: "policy"
created: "2026-09-17"
status: "pending_review"
task: "TASK-FIN-007"
live_activation: false
---

# Персональный тариф эксперта

DEC-FIN-007 **①**: активная policy = **`expert_residency_v2`**. Новая формула 12k/20k, V3 weekly и диапазоны 8–15k **superseded**, не исполняются.

## Исполнимая формула (V2, уже в CHECK `0032`)

| `tariff_key` | Имя | `price_minor` | Срок | `credit_cap_bps` | Группы |
|---|---|---:|---|---:|---|
| START | Старт | 390000 (3900 ₽) | 30×24ч | 3000 | 0 |
| BASE | База | 590000 (5900 ₽) | 30×24ч | 3000 | 1 |
| PRO | Про | 999000 (9990 ₽) | 30×24ч | 3000 | 3 (`group_event_limit`, CHECK `expert_tariff_v2_combination` — `packages/db/src/schema/expert-residency.ts:385`: START 0, BASE 1, PRO 3 — проверено 2026-09-21) |

Исторические `legacy_residency_v1` snapshots не переписываются.

## Эксклюзив (DEC-FIN-009 ②)

Порог услуги 15000 ₽ — **рекомендация контента**, не API/DB filter. 14999 и 15000 проходят одинаково. Строгий eligibility не вводить в FIN-022.

## Rollback

Не создавать новые `expert_residency_v2` tariff_key вне START/BASE/PRO. Retire только через audited `tariff_retire`. Live residency billing остаётся default-off.

### Порядок скидок (кросс-ссылка, 2026-09-21)

Этот документ фиксирует только базовую формулу тарифа V2 (no-change по DEC-FIN-007 ①). Активные
механики начисления приняты отдельно и применяются **поверх** базы в порядке DEC-FIN-011 ①:
floor 5000 → Start-проценты (Energy Start + 3-месячный Start 15%/10%) → акций нет. Читая только
таблицу выше, нельзя считать итоговую цену: для базы 12000 ₽ порядок даёт иной результат, чем голая
строка START/BASE/PRO.
