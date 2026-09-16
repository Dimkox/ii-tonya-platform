# TASK-PLT-005: Selarti, Make и Sheets как интеграции backend

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Selarti, Make и Sheets как интеграции backend с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: integration; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-FIN-021](TASK-FIN-021.md), [TASK-PLT-008](TASK-PLT-008.md), [TASK-PLT-013](TASK-PLT-013.md), [TASK-DEC-PLT-003](TASK-DEC-PLT-003.md), [TASK-DEC-PLT-004](TASK-DEC-PLT-004.md).
- Решения: DEC-PLT-003, DEC-PLT-004.
- Вопросы: Q-025, Q-026, Q-032, Q-035, Q-036, Q-037, Q-038, Q-041, Q-047, Q-161.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/integrations/src/selarti/selarti-port.ts](../../../../packages/integrations/src/selarti/selarti-port.ts)
- [apps/api/src/routes/selarti-response.ts](../../../../apps/api/src/routes/selarti-response.ts)
- [packages/integrations/src/projections/projection-port.ts](../../../../packages/integrations/src/projections/projection-port.ts)
- [packages/integrations/src/projections/make-projection-sink.ts](../../../../packages/integrations/src/projections/make-projection-sink.ts)
- [packages/db/src/repositories/outbox-repository.ts](../../../../packages/db/src/repositories/outbox-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/integrations/src/selarti/selarti-port.ts](../../../../packages/integrations/src/selarti/selarti-port.ts)
- [apps/api/src/routes/selarti-response.ts](../../../../apps/api/src/routes/selarti-response.ts)
- [packages/integrations/src/projections/projection-port.ts](../../../../packages/integrations/src/projections/projection-port.ts)
- [packages/integrations/src/projections/make-projection-sink.ts](../../../../packages/integrations/src/projections/make-projection-sink.ts)
- [packages/db/src/repositories/outbox-repository.ts](../../../../packages/db/src/repositories/outbox-repository.ts)

**Создать:**

- [docs/operations/owner-update-integration-mapping.md](../../../../docs/operations/owner-update-integration-mapping.md)

**Проверки:**

- [tests/contract/selarti-port.test.ts](../../../../tests/contract/selarti-port.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-004.01** — Сценарий Make на входящее или исходящее сообщение Selarti ищет Packages по client_id с package_end_date > now и messages_available > 0, сортирует по package_end_date ASC; при отсутствии строк шлёт заглушку, обнуляет просроченные остатки и останавливает логику ии-Тони, иначе увеличивает messages_used и уменьшает messages_available первого пакета на 1 и продолжает логику ассистента.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-004.02** — ТЗ требует 13 сценариев Make: списание чата, reminder 3 дня, резерв 72ч, автоснятие, действие эксперта Telegram, добавление waitlist, отмена клиентом, аудиокаст, лог диалога, лог события, алерт негативного отзыва, фильтр слотов 24ч и применение купонов в резерве.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-004.03** — Конфигурация должна внешне задавать идентификатор Sheets и имена 8 листов, URL/API-учётные данные Planerka и Selarti, токен Telegram и admin chat id, а также константы: min_hours_before_slot=24, reservation_hours=72, reminder_days=3, package_days=60, coupon_days=90.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-004.05** — Selarti отправляет вебхук для всех входящих/исходящих событий с client_id, message, direction incoming/outgoing и timestamp; при каждом ответе ии-Тони через Make списывается сообщение. Все диалоги логируются в Dialogs, ключевые события — в Events_Log, негативные отзывы отправляются администратору Telegram.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-006.01** — Единый словарь данных охватывает 8 сущностей Clients, Packages, Events, Reservations, Waitlist, Experts, Dialogs, Events_Log; дополнения Experts.timezone и Reservations.expert_id объединены. Точные поля и legacy-вычисления из A032/A040/A044/A077 сохранены отдельными подпунктами каталога. PostgreSQL владеет состоянием, Sheets отражает проекцию; сроки60/90 и формулы не активировать до решений FIN.
  - Проверка: Проверить все явно перечисленные в этом пункте значения, переходы и исключения; конкретные сценарии и границы приведены в связанной карточке задачи.

- [ ] **REQ-PLT-006.04** — Предложенная структура архива expert_part включает expert_prompt.txt с ролью, операциями, стилем и конфиденциальными ограничениями бота, а также expert_scenario.json для обработки действий эксперта.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-006.06** — Experts расширяется полями кода, бонусов, статуса акции, времени расчёта, учтённых рефералов, оплаты и category expert/center/organizer/space; Clients получает purchase_order для FIFO; Selarti сохраняет timestamp, предлагает акцию/бонусы и блокирует бонусы на 3 месяца при акции; FAQ разделяет купоны и бонусы.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-006.07** — Схема Experts включает статусы оплаты pending/paid/overdue, категорию, статус/данные/аудит проверки и онбординга; Spaces — тип, capacity, amenities и учёт пакета; Clients — purchase_order для FIFO.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-013.03** — Документ описывает Selarti как диалоговую платформу, Planerka как запись, Make+Google Sheets как автоматизацию/хранилище; его поток — списать сообщение, создать 72-часовой резерв, получить действие эксперта, снять резерв при таймауте и вести отдельные логи.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Точные подпункты и каталоги

Применить каждый подпункт в пределах утверждённых решений; для отвергнутого варианта сохранить причину и ссылку на решение.

- [ ] **DET-026** — Clients: client_id, name, phone, email, registration_date, last_reminder_sent.

- [ ] **DET-027** — Packages: package_id, client_id, type, messages_total, messages_used, messages_available, package_start_date, package_end_date, coupons_total, coupons_used, coupons_available, coupon_issue_date, coupon_expiry_date, last_reminder_sent.

- [ ] **DET-028** — Расчёты Make: messages_available = messages_total − messages_used; coupon_expiry_date = coupon_issue_date + 90 days; package_end_date = package_start_date + 60 days.

- [ ] **DET-029** — Events: event_id, title, author, type, total_seats, current_seats, has_audiocast; total_seats и current_seats могут быть ∞.

- [ ] **DET-030** — Reservations: reservation_id, event_instance_id, client_id, status, reserved_until, created_at.

- [ ] **DET-031** — Waitlist: waitlist_id, event_instance_id, client_id, created_at, position.

- [ ] **DET-032** — Experts: expert_id, name, specialization, format, price, telegram_id, has_audiocast.

- [ ] **DET-036** — Clients — клиенты; Packages — пакеты сообщений и купоны; Events — мероприятия и слоты; Reservations — резервы и брони; Waitlist — лист ожидания; Experts — эксперты; Dialogs — логи диалогов; Events_Log — лог событий.

- [ ] **DET-037** — 01_Deduct_Message_On_Chat — webhook Selarti входящего/исходящего сообщения; списывает 1 из ближайшего package_end_date.

- [ ] **DET-038** — 02_Reminder_3_Days — ежедневный schedule; одно сообщение по всем пакетам.

- [ ] **DET-039** — 03_Create_Reservation_72h — webhook выбора слота; 72ч, места, купоны.

- [ ] **DET-040** — 04_Auto_Remove_Reservation — ежечасный schedule; снимает срок, места, waitlist.

- [ ] **DET-041** — 05_Expert_Action_Telegram — Telegram webhook; confirm/cancel/reschedule.

- [ ] **DET-042** — 06_Waitlist_Add — Selarti webhook вступления в очередь.

- [ ] **DET-043** — 07_Client_Cancel_Booking — Selarti webhook отмены клиентом.

- [ ] **DET-044** — 08_Send_Audiocast — Selarti webhook решения ии-Тони; ссылка+пояснение одним сообщением.

- [ ] **DET-045** — 09_Log_Dialog встроен во все сценарии; 10_Log_Event — отдельный; 11_Negative_Feedback_Alert — Selarti webhook негативного отзыва; 12_Filter_Slots_24h встроен в показ слотов; 13_Apply_Coupons встроен в резерв.

- [ ] **DET-046** — Имена листов: clients_sheet_name, packages_sheet_name, events_sheet_name, reservations_sheet_name, waitlist_sheet_name, experts_sheet_name, dialogs_sheet_name, events_log_sheet_name.

- [ ] **DET-047** — Интеграционные значения: google_sheets_id, planerka_api_key/base_url, selarti_webhook_url/api_key, telegram_bot_token/admin_chat_id.

## Шаги

- [ ] Сопоставить все13 сценариев и8 сущностей из каталога с существующим backend owner; указать исключённые legacy-записи в Sheets.
- [ ] Сохранять incoming/outgoing id, direction, timestamp, sender и результат обработки; списание только FIN21.
- [ ] Опубликовать минимальные проекции Dialogs/Events_Log/анкеты через outbox с фильтрацией PII.
- [ ] Внешние ключи брать из env/secret storage; импорт сценариев сам по себе не активирует capability.

## Критерии приёмки

- [ ] Повтор входящего события не создаёт второй ответ/списание; исходящий echo не зацикливает обработку.
- [ ] Правка Sheets не подтверждает оплату и не меняет бронь/остаток.
- [ ] Карта содержит все13 сценариев и поля8 сущностей; секреты не попадают в payload/log; сеть выключена по умолчанию.

## Команды проверки

```bash
pnpm exec vitest run tests/contract/selarti-port.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
