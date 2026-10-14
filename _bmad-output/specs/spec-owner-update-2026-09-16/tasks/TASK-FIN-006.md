# TASK-FIN-006: Изолировать test-expert финансовую демонстрацию

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Virtual-only state contract и content boundaries.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-FIN-005](TASK-FIN-005.md), [TASK-DEC-FIN-005](TASK-DEC-FIN-005.md), [TASK-DEC-FIN-006](TASK-DEC-FIN-006.md).
- Решения: DEC-FIN-005, DEC-FIN-006.
- Вопросы: Q-071, Q-082, Q-146, Q-163, Q-177.

## Что уже есть

Trial резервирует 2 units с cap 100, warmup потребляет 0; реальная финансовая связка demo не подтверждена.

## Файлы

**Прочитать:**

- [packages/application/src/test-expert-warmup.ts](../../../../packages/application/src/test-expert-warmup.ts)
- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/db/src/repositories/test-expert-trial-repository.ts](../../../../packages/db/src/repositories/test-expert-trial-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-test-demo-isolation.md](../../../../docs/superpowers/implementation-artifacts/fin-test-demo-isolation.md)

**Проверки:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../../packages/application/src/test-expert-telegram-service.test.ts)
- [packages/db/src/repositories/test-expert-trial-repository.test.ts](../../../../packages/db/src/repositories/test-expert-trial-repository.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-006.01** — Демо-купонный баланс 3000, тестовый максимум списания 1000 и остаток 2000 не связаны с реальным балансом, booking, payment или ledger; правило округления демо-суммы определяется отдельно.
  - Проверка: Тестовый flow не создаёт реальных финансовых операций и не изменяет реальный баланс.

- [ ] **REQ-FIN-006.02** — Коммерческие объяснения в тестовом экспертском сценарии не включают спорные старые цены как активную оферту.
  - Проверка: Snapshot тестового контента не содержит неутверждённых цен/гарантий.

## Шаги

- [ ] Разделить virtual quote/balance от real order/booking IDs.
- [ ] Определить demo rounding без real ledger mutation.

## Критерии приёмки

- [ ] Test session не создаёт payment, reservation или real coupon event.

## Команды проверки

```bash
pnpm exec vitest run packages/application/src/test-expert-telegram-service.test.ts packages/db/src/repositories/test-expert-trial-repository.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
