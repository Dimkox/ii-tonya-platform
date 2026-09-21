# TASK-FIN-018: Расширить versioned bonus cap по категориям

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Category/policy cap mapping and cash-credit conservation contract.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-007](TASK-FIN-007.md), [TASK-FIN-012](TASK-FIN-012.md), [TASK-FIN-013](TASK-FIN-013.md), [TASK-DEC-FIN-017](TASK-DEC-FIN-017.md).
- Решения: DEC-FIN-017.
- Вопросы: Q-053, Q-054, Q-130, Q-131, Q-154, Q-201, Q-202.

## Что уже есть

V2 already fixes 3000 bps; generic quote default 5000 bps; SPACE cap 1000 bps is not confirmed in type.

## Файлы

**Прочитать:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)
- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-bonus-cap-versioning.md](../../../../docs/superpowers/implementation-artifacts/fin-bonus-cap-versioning.md)

**Проверки:**

- [packages/domain/src/expert-referral.test.ts](../../../../packages/domain/src/expert-referral.test.ts)
- [packages/domain/src/expert-referral.property.test.ts](../../../../packages/domain/src/expert-referral.property.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-016.02** — Варианты source/code cap:20% ранней версии,30% для эксперта/центра/организатора поздней и действующей V2,50% общего legacy quote; для пространства источник задаёт10%. DEC-FIN-017 выбирает применимость версии/категории и базу до/после скидок; лишь выбранный cap активируется. В30%-варианте остальные70% оплачиваются деньгами.
  - Проверка: Quote использует выбранный versioned cap: для30%варианта3000bps, для10%пространства1000bps; остальные варианты и исторические счета не переписываются.
  - Проверка: cash+credit=price; нет согласия/письменного запроса — нет bonus debit.

## Шаги

- [ ] Choose DEC-FIN-017.
- [ ] Specify base price before/after discounts and SPACE interface boundary.

## Критерии приёмки

- [ ] All quotes satisfy cash+credit=price and category cap BPS.
- [ ] Автоматическое списание требует сохранённого согласия или письменного запроса; курс1=1₽ применяется только к разрешённому резидентству.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
