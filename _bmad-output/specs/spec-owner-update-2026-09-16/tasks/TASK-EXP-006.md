# TASK-EXP-006: Telegram-команды эксперта для броней

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Проверенные callbacks и /schedule, /client, /stats.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-PLT-003](TASK-PLT-003.md), [TASK-PLT-008](TASK-PLT-008.md), [TASK-FIN-021](TASK-FIN-021.md), [TASK-PLT-002](TASK-PLT-002.md), [TASK-DEC-PLT-004](TASK-DEC-PLT-004.md).
- Решения: DEC-PLT-004.
- Вопросы: Q-029, Q-030, Q-034, Q-040, Q-044, Q-046, Q-050, Q-051, Q-052, Q-068.

## Что уже есть

Telegram processor и expert query service существуют; owner-scoped callbacks и уведомление обеих сторон при 72h expiry не подтверждены.

## Файлы

**Прочитать:**

- [packages/integrations/src/telegram/expert-command-processor.ts](../../../../packages/integrations/src/telegram/expert-command-processor.ts)
- [packages/application/src/expert-telegram-query-service.ts](../../../../packages/application/src/expert-telegram-query-service.ts)
- [packages/worker/src/reservation-expiry.ts](../../../../packages/worker/src/reservation-expiry.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/integrations/src/telegram/expert-command-processor.ts](../../../../packages/integrations/src/telegram/expert-command-processor.ts)
- [packages/application/src/expert-telegram-query-service.ts](../../../../packages/application/src/expert-telegram-query-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/integrations/src/telegram/expert-command-processor.test.ts](../../../../packages/integrations/src/telegram/expert-command-processor.test.ts)
- [tests/integration/expert-telegram-queries.test.ts](../../../../tests/integration/expert-telegram-queries.test.ts)
- [packages/worker/src/reservation-expiry.test.ts](../../../../packages/worker/src/reservation-expiry.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-006.01** — Бот эксперта управляет бронями, расписанием и фактологичными данными, без общения эксперта с клиентом; кнопки ✅/❌/🔄/📅/👤/📊 соответствуют подтверждению, отмене, переносу, расписанию, клиенту, месячной статистике.
  - Проверка: Каждая кнопка открывает только закреплённую функцию.

- [ ] **REQ-EXP-006.02** — Reserved содержит клиента, услугу, дату/время, формат, цену, купоны X ₽, доплату Y ₽, 72ч; ✅→Booked+ссылка/адрес, ❌→Cancelled+освобождение, 🔄→новый 72ч Reserved.
  - Проверка: Перенос отменяет старый и создаёт новый reserved.

- [ ] **REQ-EXP-006.03** — /schedule показывает только собственные Reserved/Booked от today, день/неделю, клиента/формат/статус; /client — запрос, пакет, X/Y, Z купонов, регистрацию; /stats — всего, подтверждено, отменено, доход за месяц; expiry 72ч уведомляет обе стороны. Финансовые поляX/Y/Z и запрос доступны только при разрешении матрицыPD; источник полного доступа не отменяет минимизацию. Отмена уже подтверждённого визита, no-show и проблемы направляются администратору, если соответствующая функция бота недоступна; эксперт обновляет и закрывает выходные слоты в Planerka.
  - Проверка: Cross-expert reservation не отображается.
  - Проверка: Expired Reserved не остаётся активным.

## Шаги

- [ ] Связать ✅, ❌, 🔄 с reservation ID и identity эксперта до чтения или изменения.
- [ ] Показывать в Reserved клиента, услугу, дату/время, формат, цену, X купонов, Y доплату, 72ч; строго применить переходы.
- [ ] Ограничить /schedule собственными Reserved/Booked от today; /client — данными клиента/пакета; /stats — месячной агрегированной статистикой.
- [ ] Потреблять результаты переходов/expiry из PLT003/PLT002; не создавать второй обработчик срока и второй ledger брони.

## Критерии приёмки

- [ ] Callback чужого эксперта отклоняется до изменения записи.
- [ ] ✅ делает Booked со ссылкой/адресом, ❌ Cancelled с освобождением, 🔄 отменяет старую и создаёт новую 72ч Reserved.
- [ ] /schedule не содержит записей другого эксперта.
- [ ] Повтор expiry не оставляет active Reserved и не дублирует уведомление каждой стороне.

## Команды проверки

```bash
pnpm vitest run packages/integrations/src/telegram/expert-command-processor.test.ts tests/integration/expert-telegram-queries.test.ts packages/worker/src/reservation-expiry.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
