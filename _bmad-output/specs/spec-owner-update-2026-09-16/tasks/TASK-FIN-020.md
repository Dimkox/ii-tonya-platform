# TASK-FIN-020: Подготовить versioned finance migration plan

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** New-policy schema delta, backfill/no-backfill, rollout and rollback plan.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-002](TASK-FIN-002.md), [TASK-FIN-005](TASK-FIN-005.md), [TASK-FIN-008](TASK-FIN-008.md), [TASK-FIN-010](TASK-FIN-010.md), [TASK-FIN-017](TASK-FIN-017.md), [TASK-FIN-018](TASK-FIN-018.md), [TASK-FIN-019](TASK-FIN-019.md), [TASK-FIN-001](TASK-FIN-001.md), [TASK-DEC-FIN-005](TASK-DEC-FIN-005.md), [TASK-FIN-007](TASK-FIN-007.md), [TASK-DEC-FIN-017](TASK-DEC-FIN-017.md).
- Решения: DEC-FIN-001, DEC-FIN-002, DEC-FIN-005, DEC-FIN-007, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017.
- Вопросы: Q-016, Q-018, Q-019, Q-024, Q-053, Q-054, Q-086, Q-088, Q-090, Q-118, Q-119, Q-126, Q-130, Q-131, Q-148, Q-154, Q-162, Q-163, Q-164, Q-169, Q-170, Q-179, Q-181, Q-185, Q-194, Q-197, Q-200, Q-201, Q-202.

## Что уже есть

Migration history is hand-authored; V2/A2 constraints pin existing policy values and cannot be overwritten.

## Файлы

**Прочитать:**

- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)
- [packages/db/migrations/0033_expert_referral_maturity_a2.sql](../../../../packages/db/migrations/0033_expert_referral_maturity_a2.sql)
- [packages/db/migrations/0037_partner_commerce_a.sql](../../../../packages/db/migrations/0037_partner_commerce_a.sql)
- [packages/db/migrations/meta/_journal.json](../../../../packages/db/migrations/meta/_journal.json)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-versioned-migration-plan.md](../../../../docs/superpowers/implementation-artifacts/fin-versioned-migration-plan.md)

**Проверки:**

- [tests/repo/migration-history-integrity.test.ts](../../../../tests/repo/migration-history-integrity.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-002.02** — Для платных пакетов выбрать один срок: 60 календарных дней по ранним правилам либо 30 календарных дней по V5/файлу 05; определить момент старта и часовой пояс.
  - Проверка: Правило вычисляет expiresAt из оплаченного timestamp в заданном часовом поясе и задаёт историческую совместимость.

- [ ] **REQ-FIN-004.03** — Выбрать срок купона: 90 календарных дней либо 45 календарных дней с начисления; после истечения купон аннулируется без восстановления, а правило возврата услуги с уже использованными купонами фиксируется отдельно.
  - Проверка: Boundary-тест на expiresAt запрещает расход после утверждённого срока и сохраняет неизменяемый ledger.

- [ ] **REQ-FIN-008.01** — Старые варианты цены не объединяются: база 12000 и Эксклюзив 20000 с setup 3000; график входа 8000/9000/10000/12000 на дни 1–7/8–14/15–21/22+; V3 10000/11000/12000/13000/14000 и Эксклюзив 16000→20000; ориентиры 8000–15000 и 16000–20000; действующая V2 фиксирована 3900/5900/9990. Ранняя недельная скидка от базы 12000: −4000/−3000/−2000/0 по окнам 1–7/8–14/15–21/22+ дней (эквивалентно 8/9/10/12 тыс.).
  - Проверка: Decision выбирает одну новую versioned policy либо сохраняет V2; исторические правила не становятся активными неявно.

- [ ] **REQ-FIN-009.01** — Эквивалентные записи одной шкалы «Энергии начала» объединены: скидки 40%/30%/20%/0% означают коэффициенты оплаты 0.6/0.7/0.8/1 для эксперта/центра/организатора; для аренды 20%/10%/0% означают 0.8/0.9/1. Начало отсчёта — calculation_timestamp. Точные переходы этапов определяются DEC-FIN-010.
  - Проверка: Boundary-тесты на дни 3/4/6/7/9/10 и time zone возвращают утверждённые коэффициенты.

- [ ] **REQ-FIN-010.02** — После всех скидок месячная цена каждой категории не ниже 5000 ₽; при достижении floor дополнительная скидка «Старт» не применяется. Порядок floor, акции, трёхмесячной скидки и бонусного списания фиксируется.
  - Проверка: Quote ниже 5000 поднимается до 5000 и не получает дополнительную скидку Start.

- [ ] **REQ-FIN-016.02** — Варианты source/code cap:20% ранней версии,30% для эксперта/центра/организатора поздней и действующей V2,50% общего legacy quote; для пространства источник задаёт10%. DEC-FIN-017 выбирает применимость версии/категории и базу до/после скидок; лишь выбранный cap активируется. В30%-варианте остальные70% оплачиваются деньгами.
  - Проверка: Quote использует выбранный versioned cap: для30%варианта3000bps, для10%пространства1000bps; остальные варианты и исторические счета не переписываются.
  - Проверка: cash+credit=price; нет согласия/письменного запроса — нет bonus debit.

- [ ] **REQ-FIN-017.01** — Для участника Energy Start расход бонусов запрещён до окончания акционного периода; альтернативные сроки — 3 месяца либо уже существующая зрелость 30 дней. При полной цене расход доступен сразу.
  - Проверка: Тест до и после утверждённого срока блокирует/разрешает spend независимо от наличия баланса.

## Шаги

- [ ] Map each selected policy to new version/table/constraints.
- [ ] Preserve historical orders, grants, maturity and financial ledger evidence.

## Критерии приёмки

- [ ] Plan requires manual SQL+journal entry and does not alter 0032/0033/0037.

## Команды проверки

```bash
pnpm exec vitest run tests/repo/migration-history-integrity.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
