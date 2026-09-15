# TASK-PLT-003: Подтверждение, отмена и перенос из Telegram

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Подтверждение, отмена и перенос из Telegram с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-PLT-001](TASK-PLT-001.md), [TASK-PLT-004](TASK-PLT-004.md), [TASK-PLT-008](TASK-PLT-008.md).
- Решения: нет.
- Вопросы: Q-011, Q-031, Q-033, Q-045, Q-048, Q-049, Q-067.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [apps/api/src/routes/telegram-webhook.ts](../../../../apps/api/src/routes/telegram-webhook.ts)
- [packages/integrations/src/telegram/telegram-adapter.ts](../../../../packages/integrations/src/telegram/telegram-adapter.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [apps/api/src/routes/telegram-webhook.ts](../../../../apps/api/src/routes/telegram-webhook.ts)
- [packages/integrations/src/telegram/telegram-adapter.ts](../../../../packages/integrations/src/telegram/telegram-adapter.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)

**Создать:**

Нет.

**Проверки:**

- [apps/api/src/routes/telegram-webhook.test.ts](../../../../apps/api/src/routes/telegram-webhook.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-002.01** — Подтверждённые Telegram-действия confirm/cancel/reschedule используют reservation_id, event_instance_id, client_id. Confirm: Booked и Planerka «Предстоящие», ссылка/адрес и аудиозадание при наличии; cancel: Cancelled, освобождение места, альтернатива/очередь; reschedule: отмена старого и новый72ч резерв с корректным учётом вместимости. Обе стороны получают результат; повтор/устаревший callback не меняет состояние повторно.
  - Проверка: Проверить все явно перечисленные в этом пункте значения, переходы и исключения; конкретные сценарии и границы приведены в связанной карточке задачи.

- [ ] **REQ-PLT-003.03** — Пример задаёт callback_data confirm/cancel/reschedule/schedule/client/stats и CSV Experts с полями id, имя, специализация, формат, цена, telegram_id, has_audiocast, timezone; примеры экспертов иллюстрируют онлайн, очный и гибридный формат.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-013.02** — Экспертский бот общается только с экспертом, не даёт клиентам советы, меняет данные только через подтверждённые кнопки, не раскрывает данные других клиентов или другого эксперта и отвечает кратко по существу.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-013.04** — Экспертский Telegram-бот создаётся через BotFather, получает токен и webhook Make; поддерживает три inline-кнопки и команды /schedule, /client {имя}, /stats. Make обрабатывает действия, а часовой job снимает истёкшие резервы и уведомляет эксперта; команды получают данные Sheets и возвращают расписание или клиентскую информацию.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Связать telegram principal с expert_id и разрешёнными reservation_id.
- [ ] Исполнить переходы в PostgreSQL; callback_data — идентификатор команды, не доверенный источник цены или прав.
- [ ] Перенос резервирует новый допустимый слот и освобождает старый согласованно; ошибка не оставляет две занятые записи.

## Критерии приёмки

- [ ] Чужой expert_id, подделанный и просроченный callback отклоняются без утечки.
- [ ] Повтор confirm/cancel/reschedule не повторяет переход/уведомление.
- [ ] Booked/Cancelled отражены в Planerka, пользователи получают верный адрес/ссылку после commit.

## Команды проверки

```bash
pnpm exec vitest run apps/api/src/routes/telegram-webhook.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
