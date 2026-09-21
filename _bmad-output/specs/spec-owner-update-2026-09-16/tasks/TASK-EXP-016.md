# TASK-EXP-016: Ledger слотов пространств

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Транзакционный package/used/remaining ledger с hand-authored SQL migration.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-010](TASK-EXP-010.md), [TASK-FIN-023](TASK-FIN-023.md), [TASK-PLT-001](TASK-PLT-001.md), [TASK-FIN-012](TASK-FIN-012.md), [TASK-FIN-014](TASK-FIN-014.md).
- Решения: DEC-FIN-012, DEC-FIN-020.
- Вопросы: Q-158, Q-160, Q-164, Q-173, Q-192.

## Что уже есть

Reservation/booking поддерживают брони и 72h hold; отдельный space-slot ledger не подтверждён.

## Файлы

**Прочитать:**

- [packages/domain/src/reservation.ts](../../../../packages/domain/src/reservation.ts)
- [packages/application/src/booking-service.ts](../../../../packages/application/src/booking-service.ts)
- [packages/db/src/schema/booking.ts](../../../../packages/db/src/schema/booking.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [packages/db/migrations/meta/_journal.json](../../../../packages/db/migrations/meta/_journal.json)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/domain/src/reservation.ts](../../../../packages/domain/src/reservation.ts)
- [packages/application/src/booking-service.ts](../../../../packages/application/src/booking-service.ts)
- [packages/db/src/schema/booking.ts](../../../../packages/db/src/schema/booking.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [packages/db/migrations/meta/_journal.json](../../../../packages/db/migrations/meta/_journal.json)

**Создать:**

- [packages/db/migrations/0039_space_slots.sql](../../../../packages/db/migrations/0039_space_slots.sql)

**Проверки:**

- [packages/domain/src/reservation.test.ts](../../../../packages/domain/src/reservation.test.ts)
- [tests/integration/booking-concurrency.test.ts](../../../../tests/integration/booking-concurrency.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-016.01** — Хранить package, used/remaining slots, start/end=start+30; остатки сгорают, period end сбрасывает счётчики/flags; Planerka Reserved 72ч→Booked/Cancelled. Ежедневно проверять одноразовые уведомления при80%и100%использования, а также за3дня до конца; не повторять их в одном периоде.
  - Проверка: После end remaining=0.

- [ ] **REQ-EXP-016.02** — Атомарно уменьшать remaining только при >0; пакеты: 500/5000, 1000/8000, 3000/10000, 5000/12000, 8000/15000, >10000 custom; срок 30, onboarding 3000.
  - Проверка: При remaining=1 параллельно успешна одна бронь.

## Шаги

- [ ] После DEC-EXP-003 зафиксировать package, used, remaining, start, end=start+30, reset remaining/flags на period end.
- [ ] Добавить hand-authored SQL migration и contiguous journal entry, не запуская drizzle-kit generate.
- [ ] Уменьшать remaining только атомарно при >0, возвращать слот при Cancelled/expiry.
- [ ] Спроецировать Planerka Reserved 72ч→Booked/Cancelled без authority Planerka над ledger.
- [ ] Ввести заданные пакеты/стоимости и onboarding 3 000 только по approved policy.

## Критерии приёмки

- [ ] При remaining=1 две параллельные попытки дают ровно один успех.
- [ ] remaining=0 не уходит в минус и не создаёт active booking.
- [ ] После end remaining=0 и flags сброшены.
- [ ] Expired Reserved освобождает слот ровно один раз.
- [ ] Migration имеет SQL и matching contiguous journal entry; drizzle-kit generate не используется.
- [ ] Проверены79/80/81%и99/100%,3дня±1с: каждое уведомление отправляется максимум один раз за период; новый период имеет новые флаги без потери истории.

## Команды проверки

```bash
pnpm vitest run packages/domain/src/reservation.test.ts tests/integration/booking-concurrency.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
