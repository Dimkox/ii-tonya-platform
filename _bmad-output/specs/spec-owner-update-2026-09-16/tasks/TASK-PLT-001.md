# TASK-PLT-001: Резервирование, лимит мест и границы24/72ч

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Резервирование, лимит мест и границы24/72ч с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-021](TASK-FIN-021.md), [TASK-PLT-008](TASK-PLT-008.md), [TASK-DEC-PLT-001](TASK-DEC-PLT-001.md).
- Решения: DEC-PLT-001.
- Вопросы: Q-010, Q-024, Q-027, Q-064, Q-065, Q-066, Q-072, Q-122.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/domain/src/reservation.ts](../../../../packages/domain/src/reservation.ts)
- [packages/application/src/client-booking-service.ts](../../../../packages/application/src/client-booking-service.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [apps/api/src/routes/client-booking.ts](../../../../apps/api/src/routes/client-booking.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/domain/src/reservation.ts](../../../../packages/domain/src/reservation.ts)
- [packages/application/src/client-booking-service.ts](../../../../packages/application/src/client-booking-service.ts)
- [packages/db/src/repositories/booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [apps/api/src/routes/client-booking.ts](../../../../apps/api/src/routes/client-booking.ts)

**Создать:**

Нет.

**Проверки:**

- [tests/integration/booking-concurrency.test.ts](../../../../tests/integration/booking-concurrency.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-001.01** — Уточнить дату/время, формат и очную локацию; показывать слоты не ранее now+24ч. Выбор создаёт Reserved до now+72ч, увеличивает занятые места на1; без подтверждения срок истекает, место освобождается и доступно альтернативе/первому в очереди. На точной границе и для события раньше истечения резерва применять DEC-PLT-001.
  - Проверка: Проверить все явно перечисленные в этом пункте значения, переходы и исключения; конкретные сценарии и границы приведены в связанной карточке задачи.

- [ ] **REQ-PLT-001.03** — Выбор слота через Selarti проверяет клиента, активный пакет, данные Events, отсутствие активного Reserved/Booked дубля и наличие мест (кроме ∞); при успехе создаёт Reserved с now+72h, увеличивает current_seats, ставит Planerka «Требует подтверждения», сообщает клиенту о 72 часах и обычно 24 часах на ответ эксперта, при has_audiocast=yes может вложить 30-секундный аудиосовет, затем списывает одно сообщение.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-001.06** — Events хранит event_id, title, author, type, total_seats, current_seats, has_audiocast; Reservations хранит reservation_id, event_instance_id, client_id, status, reserved_until, created_at и использует статусы Reserved, Booked, Cancelled.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-001.08** — По запросу клиента записаться к названному эксперту система должна показать слоты именно этого эксперта, без предложения других, и поддерживать запись и напоминания 24/7.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-001.12** — Проверить цепочку Planerka/Sheets Reserved на 72 часа → Booked или Cancelled и автоснятие резерва с освобождением мест Events; эксперт при регистрации сообщает процент оплаты купонами 20–50%.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Закрепить принятое правило DEC-PLT-001 в domain policy; финансовые проверки получать из FIN21.
- [ ] Проверить клиента/согласие, конкретного эксперта, вместимость и активный дубль до создания.
- [ ] В одной транзакции создать резерв и занять место; обновления Planerka и уведомления публиковать через outbox.

## Критерии приёмки

- [ ] Параллельные запросы последнего места дают ровно один резерв; повтор request id возвращает тот же результат.
- [ ] Проверены now+24ч−1с, ровно24ч, +1с, начало события до срока72ч и неограниченная вместимость.
- [ ] Запрос конкретного эксперта не подменяется другим, отменённый/чужой слот недоступен.

## Команды проверки

```bash
pnpm exec vitest run tests/integration/booking-concurrency.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
