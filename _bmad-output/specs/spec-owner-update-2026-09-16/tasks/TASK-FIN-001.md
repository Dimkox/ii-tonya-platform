# TASK-FIN-001: Зафиксировать policy и когорты клиентского доступа

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Утверждённая когортная матрица и migration/rollback contract.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: нет.
- Решения: DEC-FIN-001.
- Вопросы: Q-016, Q-169.

## Что уже есть

Код различает legacy_package_v1 и free_client_v2; conversation-service выбирает free для V2.

## Файлы

**Прочитать:**

- [packages/application/src/client-commercial-policy.ts](../../../../packages/application/src/client-commercial-policy.ts)
- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-client-access-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-client-access-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-001.01** — Определить целевую когорту и политику client access: существующие legacy_package_v1 и free_client_v2 нельзя массово заменить без версионированного миграционного контракта.
  - Проверка: Решение описывает назначение новых и существующих пользователей и откат без переприсвоения истории.

## Шаги

- [ ] Выбрать вариант DEC-FIN-001.
- [ ] Описать admission новых клиентов, судьбу legacy и запрет массового переприсвоения.

## Критерии приёмки

- [ ] Каждая когорта имеет одну policy version и безопасный rollback.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
