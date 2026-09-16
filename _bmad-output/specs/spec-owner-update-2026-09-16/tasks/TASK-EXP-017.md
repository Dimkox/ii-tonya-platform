# TASK-EXP-017: Рендер акции пространств из policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Date-gated renderer 20%/10%/без акции без самостоятельного расчёта.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: content; исполнитель: product-owner; приоритет: P2.
- Depends on: [TASK-EXP-015](TASK-EXP-015.md), [TASK-FIN-022](TASK-FIN-022.md), [TASK-FIN-023](TASK-FIN-023.md), [TASK-FIN-010](TASK-FIN-010.md), [TASK-FIN-019](TASK-FIN-019.md), [TASK-DEC-FIN-017](TASK-DEC-FIN-017.md).
- Решения: DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017.
- Вопросы: Q-195.

## Что уже есть

В landing content нет approved policy projection акции пространств.

## Файлы

**Прочитать:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)
- [packages/db/src/schema/commercial-policy.ts](../../../../packages/db/src/schema/commercial-policy.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)

**Создать:**

Нет.

**Проверки:**

- [apps/web/src/content.test.ts](../../../../apps/web/src/content.test.ts)
- [apps/web/src/landing-view.test.ts](../../../../apps/web/src/landing-view.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-017.01** — Space promotion: первые 3 дня 20%, дни 4–6 10%, после 6 нет; source только approved policy.
  - Проверка: Day3=20, day4=10, day7=none.

## Шаги

- [ ] Получать старт кампании, approved status и процент из policy snapshot.
- [ ] Показывать 20% первые 3 календарных дня и 10% дни 4–6.
- [ ] Скрывать промо с дня 7 и при inactive/unknown policy.
- [ ] Покрыть граничные даты и timezone кампании утверждённым контрактом.

## Критерии приёмки

- [ ] На дне 3 показано 20%.
- [ ] На дне 4 показано 10%.
- [ ] На дне 7 промо отсутствует.
- [ ] Без approved policy renderer не подставляет 20% или 10%.

## Команды проверки

```bash
pnpm vitest run apps/web/src/content.test.ts apps/web/src/landing-view.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
