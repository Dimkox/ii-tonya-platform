# TASK-EXP-011: Пауза резидента и проекции entitlements

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Fail-closed approved-policy projection паузы, лимитов и обязанностей резидента.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-010](TASK-EXP-010.md), [TASK-PLT-009](TASK-PLT-009.md), [TASK-FIN-022](TASK-FIN-022.md), [TASK-FIN-012](TASK-FIN-012.md), [TASK-FIN-014](TASK-FIN-014.md), [TASK-DEC-PLT-004](TASK-DEC-PLT-004.md).
- Решения: DEC-FIN-012, DEC-FIN-020, DEC-PLT-004.
- Вопросы: Q-128, Q-164, Q-183, Q-184, Q-193, Q-207.

## Что уже есть

Есть versioned entitlements; правила паузы до/свыше 3 месяцев и полные Base/Exclusive проекции ждут DEC-EXP-003.

## Файлы

**Прочитать:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/repositories/expert-residency-repository.ts](../../../../packages/db/src/repositories/expert-residency-repository.ts)
- [packages/application/src/expert-telegram-query-service.ts](../../../../packages/application/src/expert-telegram-query-service.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/application/src/expert-telegram-query-service.ts](../../../../packages/application/src/expert-telegram-query-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/expert-residency-service.test.ts](../../../../packages/application/src/expert-residency-service.test.ts)
- [tests/integration/expert-telegram-queries.test.ts](../../../../tests/integration/expert-telegram-queries.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-011.01** — До 3 месяцев карточка архивируется/сохраняется без нового fee; свыше 3 — удаление, новая проверка и 3 000 ₽.
  - Проверка: Ровно3месяца и3месяца+1день дают утверждённые разные ветви; календарный отсчёт/точка начала фиксируются до реализации.
  - Проверка: Архив/удаление карточки отделены от хранения персональных данных и обязательных договорных записей.

- [ ] **REQ-EXP-011.02** — Base: unlimited индивидуальные услуги, одна группа до 20/месяц; Exclusive: base плюс выделение и высокобюджетные клиенты.
  - Проверка: Base group limit=1, capacity=20.

- [ ] **REQ-EXP-011.03** — Эксперт обновляет услуги/цены/слоты, отвечает за 72ч, качество/споры; исполнитель проверяет и исключает при ложных данных/нарушении/жалобах, уведомляет об изменениях 10 рабочих дней; нет гарантий клиентов/дохода.
  - Проверка: Copy не обещает доход.

## Шаги

- [ ] После DEC-EXP-003 определить отсчёт паузы: до 3 месяцев архив/сохранение, свыше 3 месяцев удаление, новая проверка и 3 000 ₽.
- [ ] Спроецировать Base: unlimited индивидуальные услуги и 1 группа до 20/месяц; Exclusive: Base плюс выделение и высокобюджетные клиенты.
- [ ] Зафиксировать обязанности обновлять услуги/цены/слоты, отвечать за 72ч, качество/споры.
- [ ] Сформировать manager path для ложных данных/нарушений/жалоб и уведомление об изменениях за 10 рабочих дней без обещаний клиентов/дохода.

## Критерии приёмки

- [ ] 2 месяца архивируют/сохраняют без нового fee, 4 требуют удаления, новой проверки и 3 000 ₽.
- [ ] Base допускает одну группу в месяц ёмкостью не выше 20.
- [ ] Без approved policy entitlement не активируется.
- [ ] Текст не гарантирует клиентов или доход.
- [ ] Срок уведомления — 10 рабочих дней.

## Команды проверки

```bash
pnpm vitest run packages/application/src/expert-residency-service.test.ts tests/integration/expert-telegram-queries.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
