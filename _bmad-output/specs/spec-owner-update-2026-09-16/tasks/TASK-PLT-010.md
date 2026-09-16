# TASK-PLT-010: Отзывы, негативные обращения и приватные алерты

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Отзывы, негативные обращения и приватные алерты с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-PLT-008](TASK-PLT-008.md), [TASK-DEC-PLT-004](TASK-DEC-PLT-004.md).
- Решения: DEC-PLT-004.
- Вопросы: Q-009, Q-123.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/application/src/feedback-service.ts](../../../../packages/application/src/feedback-service.ts)
- [packages/db/src/repositories/feedback-repository.ts](../../../../packages/db/src/repositories/feedback-repository.ts)
- [packages/worker/src/telegram-send-text-dispatcher.ts](../../../../packages/worker/src/telegram-send-text-dispatcher.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/feedback-service.ts](../../../../packages/application/src/feedback-service.ts)
- [packages/db/src/repositories/feedback-repository.ts](../../../../packages/db/src/repositories/feedback-repository.ts)
- [packages/worker/src/telegram-send-text-dispatcher.ts](../../../../packages/worker/src/telegram-send-text-dispatcher.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/feedback-service.test.ts](../../../../packages/application/src/feedback-service.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-001.11** — Клиент отменяет запись через чат, использованные купоны не возвращаются; напоминания отправляются за 2 дня, за 1 день и за 1 час с адресом/ссылкой в двух последних. После визита обратная связь добровольна: позитивные отзывы могут публиковаться, негативные передаются администратору и не публикуются.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-008.02** — После посещения эксперта или мероприятия клиенту по желанию предлагается оставить отзыв; положительный отзыв сохраняется как информация, негативный передаётся администратору и не публикуется и не показывается другим клиентам; для негативного отзыва предусмотрено отдельное Telegram-уведомление администратору.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Принять добровольный отзыв с привязкой к визиту и правами субъекта.
- [ ] Негативный отзыв доставлять администратору приватно с минимумом данных; положительный публиковать только по согласованному разрешению.
- [ ] Повтор события отзыва/алерта обрабатывать идемпотентно; напоминание создаёт EXP03 по своей policy.

## Критерии приёмки

- [ ] Негативный отзыв отсутствует в публичной выдаче и ответе другому клиенту.
- [ ] Положительный без разрешения публикации не публикуется.
- [ ] Дубли webhook создают один отзыв и один алерт.

## Команды проверки

```bash
pnpm exec vitest run packages/application/src/feedback-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
