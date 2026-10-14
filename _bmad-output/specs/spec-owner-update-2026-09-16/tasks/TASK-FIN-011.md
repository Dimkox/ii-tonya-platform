# TASK-FIN-011: Спроектировать Start/floor/2-for-1 порядок

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Operation order and quote invariants for monthly floor, Start and 60-day extension.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-010](TASK-FIN-010.md).
- Решения: DEC-FIN-011.
- Вопросы: Q-162, Q-196, Q-197.

## Что уже есть

Current V2 has fixed 30-day duration; no confirmed active Start/floor/2-for-1 implementation.

## Файлы

**Прочитать:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-promo-stacking-design.md](../../../../docs/superpowers/implementation-artifacts/fin-promo-stacking-design.md)

**Проверки:**

- [packages/application/src/expert-residency-service.test.ts](../../../../packages/application/src/expert-residency-service.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-010.01** — Трёхмесячный «Старт» является предоплатой размещения за 3 месяца; предложенная формула умножает месячный quote на 3 и применяет дополнительный коэффициент 0.85 в первом окне и 0.90 во втором разрешённом окне.
  - Проверка: Тесты первого, второго и позднего окна проверяют доступность и коэффициент 0.85/0.90/без скидки.

- [ ] **REQ-FIN-010.02** — После всех скидок месячная цена каждой категории не ниже 5000 ₽; при достижении floor дополнительная скидка «Старт» не применяется. Порядок floor, акции, трёхмесячной скидки и бонусного списания фиксируется.
  - Проверка: Quote ниже 5000 поднимается до 5000 и не получает дополнительную скидку Start.

- [ ] **REQ-FIN-010.03** — «2 месяца по цене 1» — отдельная акционная механика: при is_promo_active и действующей дате окончания месячная оплата продлевает subscription_end_date на 60 дней; её совместимость с Energy Start и Start решается отдельно.
  - Проверка: Тест inactive/expired promo не продлевает на 60 дней.

## Шаги

- [ ] Model floor before/after discounts exactly as chosen.
- [ ] Define whether 2-for-1 and Start are mutually exclusive.

## Критерии приёмки

- [ ] Price never drops below 5000 and inactive/expired promo cannot extend 60 days.

## Команды проверки

```bash
pnpm exec vitest run packages/application/src/expert-residency-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
