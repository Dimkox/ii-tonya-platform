# TASK-PLT-002: Истечение резерва и продвижение очереди

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Истечение резерва и продвижение очереди с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-PLT-001](TASK-PLT-001.md), [TASK-DEC-PLT-001](TASK-DEC-PLT-001.md).
- Решения: DEC-PLT-001.
- Вопросы: Q-012, Q-013.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/worker/src/reservation-expiry.ts](../../../../packages/worker/src/reservation-expiry.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/worker/src/reservation-expiry.ts](../../../../packages/worker/src/reservation-expiry.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)

**Создать:**

- [packages/application/src/waitlist-service.ts](../../../../packages/application/src/waitlist-service.ts)
- [packages/application/src/waitlist-service.test.ts](../../../../packages/application/src/waitlist-service.test.ts)

**Проверки:**

- [packages/worker/src/reservation-expiry.test.ts](../../../../packages/worker/src/reservation-expiry.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-001.02** — Ежечасный job обрабатывает Reserved с reserved_until<now: Cancelled, освобождение одного места, проекция Planerka «Отменённые», уведомления клиента/эксперта. Первый ожидающий того же event_instance_id получает новый72ч резерв и удаляется из очереди; повтор job не повторяет переход, уведомление или выдачу места.
  - Проверка: Проверить все явно перечисленные в этом пункте значения, переходы и исключения; конкретные сценарии и границы приведены в связанной карточке задачи.

- [ ] **REQ-PLT-002.02** — При отсутствии мест клиент может вступить в waitlist; создаётся запись с event_instance_id, client_id, created_at и position = число текущих записей для события + 1, клиент получает сообщение, которое списывает одно сообщение из активного пакета. Клиент может отменить активную запись через чат: статус становится Cancelled, место освобождается, Planerka получает «Отменённые», клиенту сообщают, что купоны не возвращаются, а эксперту отправляют уведомление.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Добавить очередь по event_instance_id и стабильному порядку created_at/id без повторного вступления.
- [ ] Обрабатывать просроченные резервы ежечасно; отмена и освобождение места атомарны.
- [ ] Передать освободившееся место первому допустимому ожидающему и записать события уведомлений.

## Критерии приёмки

- [ ] Два worker не снимают один резерв дважды и не назначают одно место двум ожидающим.
- [ ] Проверены ровно reserved_until и ±1с по выбранному правилу, пустая очередь, повторная отмена, недоступный участник.
- [ ] Купонный результат отмены берётся из FINpolicy; демонстрационные и настоящие очереди разделены.

## Команды проверки

```bash
pnpm exec vitest run packages/worker/src/reservation-expiry.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
