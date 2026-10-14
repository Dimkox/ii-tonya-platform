# TASK-FIN-016: Специфицировать qualification и reversal referral reward

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Event-sourced qualification/reversal/debt model with idempotency.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-015](TASK-FIN-015.md), [TASK-DEC-FIN-015](TASK-DEC-FIN-015.md).
- Решения: DEC-FIN-015.
- Вопросы: Q-053, Q-054, Q-129, Q-130, Q-199.

## Что уже есть

A2 has pending/granted/cancelled maturity and amount 100000 minor; 30-day maturity already exists.

## Файлы

**Прочитать:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/db/migrations/0033_expert_referral_maturity_a2.sql](../../../../packages/db/migrations/0033_expert_referral_maturity_a2.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-expert-reward-design.md](../../../../docs/superpowers/implementation-artifacts/fin-expert-reward-design.md)

**Проверки:**

- [packages/domain/src/expert-referral.test.ts](../../../../packages/domain/src/expert-referral.test.ts)
- [packages/domain/src/expert-referral.property.test.ts](../../../../packages/domain/src/expert-referral.property.test.ts)
- [packages/db/src/repositories/expert-referral-repository.test.ts](../../../../packages/db/src/repositories/expert-referral-repository.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-015.01** — Пригласивший получает 1000 бонусов (1 бонус=1 ₽) один раз за первую квалифицированную оплату каждого реферала; продления не вознаграждаются, реферал не получает бонус. Срок начисления по B072 — не позднее3 рабочих дней после подтверждения оплаты; определить рабочий календарь и проверить предельный срок.
  - Проверка: Две оплаты/продление одного реферала создают максимум один grant 1000 бонусов.

- [ ] **REQ-FIN-015.02** — Квалифицирующий event выбирается из вариантов: регистрация+оплата участия; анкета+setup fee+первый месяц; либо «после подписки». Ранее зарегистрированный/тестовый эксперт, чужой код, только setup fee, самореферал и возврат/расторжение в первые 30 дней не должны давать бонус, если выбрана полная офертная политика.
  - Проверка: Матрица qualification/reject покрывает перечисленные негативные случаи и создаёт обратимое событие при возврате.

- [ ] **REQ-FIN-015.03** — При аннулировании уже использованного бонуса фиксируется debt и срок денежной доплаты 5 рабочих дней после уведомления; правило недостаточного баланса не допускает отрицательного доступного balance без отдельного долга.
  - Проверка: Reversal использованного grant создаёт проверяемую задолженность и не разрушает исторический ledger.

## Шаги

- [ ] Choose qualifying payment and refund window.
- [ ] Model self-referral, prior registration/trial and double events.

## Критерии приёмки

- [ ] At-most-once 1000 reward, reversal and debt paths are explicit.
- [ ] Grant создан не позднее3 рабочих дней после подтверждённой квалифицированной оплаты; повтор не создаёт второй grant.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts packages/db/src/repositories/expert-referral-repository.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
