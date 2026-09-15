# TASK-PLT-004: Адаптер Planerka и восстановление проекции брони

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Адаптер Planerka и восстановление проекции брони с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: integration; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-PLT-008](TASK-PLT-008.md), [TASK-PLT-013](TASK-PLT-013.md), [TASK-DEC-PLT-003](TASK-DEC-PLT-003.md), [TASK-DEC-PLT-004](TASK-DEC-PLT-004.md).
- Решения: DEC-PLT-003, DEC-PLT-004.
- Вопросы: Q-035, Q-039.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/integrations/src/planerka/planerka-port.ts](../../../../packages/integrations/src/planerka/planerka-port.ts)
- [packages/integrations/src/planerka/disabled-planerka-adapter.ts](../../../../packages/integrations/src/planerka/disabled-planerka-adapter.ts)
- [packages/worker/src/outbox-runner.ts](../../../../packages/worker/src/outbox-runner.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/integrations/src/planerka/planerka-port.ts](../../../../packages/integrations/src/planerka/planerka-port.ts)
- [packages/integrations/src/planerka/disabled-planerka-adapter.ts](../../../../packages/integrations/src/planerka/disabled-planerka-adapter.ts)
- [packages/worker/src/outbox-runner.ts](../../../../packages/worker/src/outbox-runner.ts)

**Создать:**

- [packages/integrations/src/planerka/planerka-http-adapter.ts](../../../../packages/integrations/src/planerka/planerka-http-adapter.ts)

**Проверки:**

- [tests/contract/planerka-port.test.ts](../../../../tests/contract/planerka-port.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-001.12** — Проверить цепочку Planerka/Sheets Reserved на 72 часа → Booked или Cancelled и автоснятие резерва с освобождением мест Events; эксперт при регистрации сообщает процент оплаты купонами 20–50%.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-004.04** — Planerka сопоставляет Reserved→«Требует подтверждения», Booked→«Предстоящие», Cancelled→«Отменённые»; используются получение слотов с фильтром +24ч, обновление статуса события и получение данных события.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

- [ ] **REQ-PLT-013.03** — Документ описывает Selarti как диалоговую платформу, Planerka как запись, Make+Google Sheets как автоматизацию/хранилище; его поток — списать сообщение, создать 72-часовой резерв, получить действие эксперта, снять резерв при таймауте и вести отдельные логи.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Точные подпункты и каталоги

Применить каждый подпункт в пределах утверждённых решений; для отвергнутого варианта сохранить причину и ссылку на решение.

- [ ] **DET-033** — Selarti: диалоги с клиентами и ИИ-Тоня.

- [ ] **DET-034** — Planerka: слоты, расписание и статусы записи экспертов.

- [ ] **DET-035** — Make+Google Sheets: списание сообщений, купоны, резервы и логи.

## Шаги

- [ ] Зафиксировать API/подписи/id внешнего события и mapping статусов.
- [ ] Получение слотов применяет фильтр24ч на сервере; клиентский фильтр вспомогателен.
- [ ] Реализовать идемпотентную проекцию после commit, retry и reconciliation; default-off сохраняется.

## Критерии приёмки

- [ ] Reserved/Booked/Cancelled дают ровно согласованные внешние статусы.
- [ ] Сбой/таймаут провайдера не откатывает уже подтверждённый ledger и не повторяет занятие места.
- [ ] Disabled adapter не выполняет сеть; контракт покрывает stale event и повтор webhook.

## Команды проверки

```bash
pnpm exec vitest run tests/contract/planerka-port.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
