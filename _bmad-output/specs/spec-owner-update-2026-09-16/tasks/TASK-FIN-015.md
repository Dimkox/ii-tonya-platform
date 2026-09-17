# TASK-FIN-015: Выбрать lifecycle экспертского referral code

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Code namespace, created/visible/revoked lifecycle and content gate.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: нет.
- Решения: DEC-FIN-014, DEC-FIN-022.
- Вопросы: Q-053, Q-054, Q-083, Q-129, Q-157, Q-198.

## Что уже есть

Baseline подтверждает expert referral repository, но источник спорит о создании/показе кода.

## Файлы

**Прочитать:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../../packages/db/src/repositories/expert-referral-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-expert-code-lifecycle.md](../../../../docs/superpowers/implementation-artifacts/fin-expert-code-lifecycle.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-014.01** — Экспертские коды и бонусы существуют в отдельном namespace, таблицах и ledger, не смешиваются с клиентским promo_XXXX/купонным продуктом.
  - Проверка: Проверка схемы/сервисов не позволяет применить экспертский код в клиентской рефералке.

- [ ] **REQ-FIN-014.02** — Выбрать момент создания и показа многоразового кода: EXPERT_[ID] или EXP_XXXX создаётся при регистрации до оплаты и показывается после оплаты; альтернативный вариант — генерируется при первом подключении действующего оплаченного резидента.
  - Проверка: Lifecycle code описывает createdAt, visibleAt, revocation и eligibility без двусмысленности.

- [ ] **REQ-FIN-014.03** — До подтверждения участия можно спросить о коллегах, но полные материалы, сообщения, промокоды и регистрационные инструкции выдаются только после утверждённого момента оформления.
  - Проверка: Контент и API-gating используют один установленный статус участия.

## Шаги

- [ ] Choose DEC-FIN-014.
- [ ] Define uniqueness, multi-use and authorization of display.

## Критерии приёмки

- [ ] One resident has deterministic code lifecycle and client code namespace cannot collide.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
