# TASK-FIN-003: Спроектировать пакетный ledger и списание сообщений

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Матрица message class, exact ordering, idempotency/retry contract и future migration outline.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-001](TASK-FIN-001.md), [TASK-FIN-002](TASK-FIN-002.md).
- Решения: DEC-FIN-001, DEC-FIN-002, DEC-FIN-003.
- Вопросы: Q-015, Q-016, Q-053, Q-054, Q-118, Q-163, Q-177.

## Что уже есть

chargeDelta списывает только ordinary inbound/outbound; choosePackage сортирует intro после paid; system/safety/error бесплатны.

## Файлы

**Прочитать:**

- [packages/domain/src/billing.ts](../../../../packages/domain/src/billing.ts)
- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/db/src/schema/billing.ts](../../../../packages/db/src/schema/billing.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-message-ledger-design.md](../../../../docs/superpowers/implementation-artifacts/fin-message-ledger-design.md)

**Проверки:**

- [packages/domain/src/billing.test.ts](../../../../packages/domain/src/billing.test.ts)
- [packages/domain/src/billing.property.test.ts](../../../../packages/domain/src/billing.property.test.ts)
- [packages/application/src/conversation-service.test.ts](../../../../packages/application/src/conversation-service.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-001.02** — Если выбрана пакетная модель, списание каждого входящего, исходящего и системного сообщения, включая уведомление, reminder, кнопку и аудио, равно 1 unit; Telegram-бот эксперта не списывает клиентские units.
  - Проверка: Матрица классов сообщений определяет charge=1 либо явное исключение для каждого класса; экспертский Telegram не изменяет баланс клиента.

- [ ] **REQ-FIN-001.03** — Пакетное списание выбирает активный пакет с положительным остатком и ближайшим package_end_date; при отсутствии подходящего пакета поведение заглушки и её тарификация определяются явно.
  - Проверка: Тест с двумя пакетами списывает тот, у которого раньше окончание; тест нулевого баланса подтверждает выбранное поведение заглушки.

## Шаги

- [ ] Спроектировать atomic debit с idempotency key.
- [ ] Определить paid/intro ordering и zero-balance response.

## Критерии приёмки

- [ ] Design покрывает duplicate webhook, failed delivery и concurrent debits.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/billing.test.ts packages/application/src/conversation-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
