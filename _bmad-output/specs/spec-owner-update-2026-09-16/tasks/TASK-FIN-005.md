# TASK-FIN-005: Специфицировать клиентский coupon ledger

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Grant/spend/expiry/reversal events, cap model, ordering and idempotency design.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-002](TASK-FIN-002.md), [TASK-DEC-FIN-005](TASK-DEC-FIN-005.md), [TASK-DEC-FIN-006](TASK-DEC-FIN-006.md), [TASK-DEC-FIN-026](TASK-DEC-FIN-026.md), [TASK-DEC-FIN-027](TASK-DEC-FIN-027.md).
- Решения: DEC-FIN-005, DEC-FIN-006, DEC-FIN-026, DEC-FIN-027.
- Вопросы: Q-003, Q-024, Q-063, Q-071, Q-082, Q-118, Q-119, Q-146, Q-154, Q-163, Q-170, Q-180, Q-181.

## Что уже есть

Baseline не подтверждает текущую реализацию x2/45–90-дневного coupon ledger или expert-specific cap.

## Файлы

**Прочитать:**

- [packages/domain/src/billing.ts](../../../../packages/domain/src/billing.ts)
- [packages/db/src/schema/billing.ts](../../../../packages/db/src/schema/billing.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-client-coupon-ledger-design.md](../../../../docs/superpowers/implementation-artifacts/fin-client-coupon-ledger-design.md)

**Проверки:**

- [packages/domain/src/billing.test.ts](../../../../packages/domain/src/billing.test.ts)
- [packages/domain/src/billing.property.test.ts](../../../../packages/domain/src/billing.property.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-004.01** — Клиентские купоны начисляются x2 от оплаты пакета; 1 купон = 1 ₽ исключительно частичной оплаты рекомендованной услуги эксперта или мероприятия. Примеры исходной x2-модели: 500→1000, 1000→2000, 2000→4000, 5000→10000; это один вариант начисления, пока DEC по каталогу/купонам открыт. Применение купона требует активной брони;24ч/72ч и очередь из A031 реализуются TASK-PLT-001/002.
  - Проверка: Оплата 1000 ₽ начисляет 2000 купонов; расчёт услуги использует курс 1:1.

- [ ] **REQ-FIN-004.02** — Купоны не являются деньгами, не обмениваются и не выводятся; передача запрещена, кроме явно утверждённых исключений.
  - Проверка: API не имеет операции вывода/обмена купонов и отклоняет перевод между пользователями без утверждённого исключения.

- [ ] **REQ-FIN-004.03** — Выбрать срок купона: 90 календарных дней либо 45 календарных дней с начисления; после истечения купон аннулируется без восстановления, а правило возврата услуги с уже использованными купонами фиксируется отдельно.
  - Проверка: Boundary-тест на expiresAt запрещает расход после утверждённого срока и сохраняет неизменяемый ledger.

- [ ] **REQ-FIN-004.04** — Определить способ частичного списания: исходные варианты — один купон на эксперта/мероприятие и запрет двух на одну услугу, максимум 1000 в тестовой демо-выдаче, либо лимит эксперта обычно 20–50% цены; остаток оплачивается деньгами.
  - Проверка: У каждой услуги есть утверждённый cap/способ задания cap; quote разбивает сумму на coupon и cash без отрицательных значений.

- [ ] **REQ-FIN-004.05** — Экспертская коммуникация может объяснять купон как скидку первой сессии и разрешать заложить скидку в цену, но не обещает повторную покупку и не подменяет правила компенсации эксперту.
  - Проверка: Утверждённый контент не содержит гарантии постоянного клиента и ссылается на фактический финансовый механизм.

## Шаги

- [ ] Выбрать срок/cap/refund decisions.
- [ ] Описать cash+coupon conservation и failure handling.

## Критерии приёмки

- [ ] Design содержит ledger invariants и negative paths expired/over-cap/refund.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/billing.test.ts packages/domain/src/billing.property.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
