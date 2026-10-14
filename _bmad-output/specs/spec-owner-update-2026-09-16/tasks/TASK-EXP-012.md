# TASK-EXP-012: Проекция политики доплаты за мероприятия

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Read-only policy contract: резидент 10%, нерезидент 15% + 4 500 ₽.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: integration; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-EXP-010](TASK-EXP-010.md), [TASK-FIN-023](TASK-FIN-023.md), [TASK-FIN-012](TASK-FIN-012.md), [TASK-FIN-014](TASK-FIN-014.md).
- Решения: DEC-FIN-012, DEC-FIN-020.
- Вопросы: Q-164, Q-189.

## Что уже есть

Policy snapshots и landing content существуют; UI не должен сам рассчитывать доплату за мероприятия.

## Файлы

**Прочитать:**

- [packages/db/src/schema/commercial-policy.ts](../../../../packages/db/src/schema/commercial-policy.ts)
- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/expert-residency-service.test.ts](../../../../packages/application/src/expert-residency-service.test.ts)
- [apps/web/src/content.test.ts](../../../../apps/web/src/content.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-012.01** — Сверх лимита: резидент 10% выручки; нерезидент 15% выручки + 4 500 ₽ за карточку; UI читает approved policy contract, не строит финансовый движок.
  - Проверка: Без policy UI pending.

## Шаги

- [ ] Определить approved policy snapshot с версией и датой действия.
- [ ] Передавать UI только утверждённые resident/nonresident значения, без финансового движка.
- [ ] При отсутствии, неактивности или неизвестной версии показывать pending.
- [ ] Проверить, что render не создаёт операцию и не заменяет источник истины расчётов.

## Критерии приёмки

- [ ] Approved policy выводит 10% выручки для резидента.
- [ ] Approved policy выводит 15% выручки + 4 500 ₽ за карточку для нерезидента.
- [ ] Неизвестная/отсутствующая policy не выводит числа и показывает pending.
- [ ] Рендер не создаёт финансовую операцию.

## Команды проверки

```bash
pnpm vitest run packages/application/src/expert-residency-service.test.ts apps/web/src/content.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
