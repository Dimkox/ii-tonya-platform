# TASK-FIN-024: Реализовать approved expert referral and bonus policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Separate referral namespace, immutable rewards/reversals/debt, category caps and selected promo maturity.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-015](TASK-FIN-015.md), [TASK-FIN-016](TASK-FIN-016.md), [TASK-FIN-017](TASK-FIN-017.md), [TASK-FIN-018](TASK-FIN-018.md), [TASK-FIN-019](TASK-FIN-019.md), [TASK-FIN-020](TASK-FIN-020.md), [TASK-DEC-FIN-015](TASK-DEC-FIN-015.md), [TASK-DEC-FIN-017](TASK-DEC-FIN-017.md), [TASK-DEC-FIN-018](TASK-DEC-FIN-018.md).
- Решения: DEC-FIN-014, DEC-FIN-015, DEC-FIN-016, DEC-FIN-017, DEC-FIN-018.
- Вопросы: Q-053, Q-054, Q-083, Q-129, Q-130, Q-131, Q-154, Q-157, Q-171, Q-198, Q-199, Q-200, Q-201, Q-202.

## Что уже есть

Existing A2 grants mature after 30 days; V2 cap30 exists; space cap/promo hold and requested lifecycle are not verified.

## Файлы

**Прочитать:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)
- [packages/db/migrations/0033_expert_referral_maturity_a2.sql](../../../../packages/db/migrations/0033_expert_referral_maturity_a2.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/domain/src/expert-referral.ts](../../../../packages/domain/src/expert-referral.ts)
- [packages/db/src/repositories/expert-referral-repository.ts](../../../../packages/db/src/repositories/expert-referral-repository.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)

**Создать:**

- [packages/db/migrations/0042_fin_referral_policy.sql](../../../../packages/db/migrations/0042_fin_referral_policy.sql)

**Проверки:**

- [packages/domain/src/expert-referral.test.ts](../../../../packages/domain/src/expert-referral.test.ts)
- [packages/domain/src/expert-referral.property.test.ts](../../../../packages/domain/src/expert-referral.property.test.ts)
- [packages/db/src/repositories/expert-referral-repository.test.ts](../../../../packages/db/src/repositories/expert-referral-repository.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-014.01** — Экспертские коды и бонусы существуют в отдельном namespace, таблицах и ledger, не смешиваются с клиентским promo_XXXX/купонным продуктом.
  - Проверка: Проверка схемы/сервисов не позволяет применить экспертский код в клиентской рефералке.

- [ ] **REQ-FIN-014.02** — Выбрать момент создания и показа многоразового кода: EXPERT_[ID] или EXP_XXXX создаётся при регистрации до оплаты и показывается после оплаты; альтернативный вариант — генерируется при первом подключении действующего оплаченного резидента.
  - Проверка: Lifecycle code описывает createdAt, visibleAt, revocation и eligibility без двусмысленности.

- [ ] **REQ-FIN-014.03** — До подтверждения участия можно спросить о коллегах, но полные материалы, сообщения, промокоды и регистрационные инструкции выдаются только после утверждённого момента оформления.
  - Проверка: Контент и API-gating используют один установленный статус участия.

- [ ] **REQ-FIN-015.01** — Пригласивший получает 1000 бонусов (1 бонус=1 ₽) один раз за первую квалифицированную оплату каждого реферала; продления не вознаграждаются, реферал не получает бонус. Срок начисления по B072 — не позднее3 рабочих дней после подтверждения оплаты; определить рабочий календарь и проверить предельный срок.
  - Проверка: Две оплаты/продление одного реферала создают максимум один grant 1000 бонусов.

- [ ] **REQ-FIN-015.02** — Квалифицирующий event выбирается из вариантов: регистрация+оплата участия; анкета+setup fee+первый месяц; либо «после подписки». Ранее зарегистрированный/тестовый эксперт, чужой код, только setup fee, самореферал и возврат/расторжение в первые 30 дней не должны давать бонус, если выбрана полная офертная политика.
  - Проверка: Матрица qualification/reject покрывает перечисленные негативные случаи и создаёт обратимое событие при возврате.

- [ ] **REQ-FIN-015.03** — При аннулировании уже использованного бонуса фиксируется debt и срок денежной доплаты 5 рабочих дней после уведомления; правило недостаточного баланса не допускает отрицательного доступного balance без отдельного долга.
  - Проверка: Reversal использованного grant создаёт проверяемую задолженность и не разрушает исторический ledger.

- [ ] **REQ-FIN-016.01** — Бонусы резидентов действуют один год/365 дней от определённого события, не являются деньгами, не выводятся и не передаются; внутренний ledger поддерживает накопление, FIFO/утверждённый порядок списания, баланс по запросу и уведомления истечения за 14 и 7 дней. Внутренний курс1 бонус=1₽, расход только на резидентство/утверждённый пакет категории, не на услуги эксперта клиенту. Списание автоматически лишь с сохранённым согласием либо по письменному запросу; отзыв согласия блокирует последующее автоматическое списание.
  - Проверка: Boundary expiry и порядок списания проверены; баланс равен сумме неизменяемых grants/reversals/spends.

- [ ] **REQ-FIN-016.02** — Варианты source/code cap:20% ранней версии,30% для эксперта/центра/организатора поздней и действующей V2,50% общего legacy quote; для пространства источник задаёт10%. DEC-FIN-017 выбирает применимость версии/категории и базу до/после скидок; лишь выбранный cap активируется. В30%-варианте остальные70% оплачиваются деньгами.
  - Проверка: Quote использует выбранный versioned cap: для30%варианта3000bps, для10%пространства1000bps; остальные варианты и исторические счета не переписываются.
  - Проверка: cash+credit=price; нет согласия/письменного запроса — нет bonus debit.

- [ ] **REQ-FIN-017.01** — Для участника Energy Start расход бонусов запрещён до окончания акционного периода; альтернативные сроки — 3 месяца либо уже существующая зрелость 30 дней. При полной цене расход доступен сразу.
  - Проверка: Тест до и после утверждённого срока блокирует/разрешает spend независимо от наличия баланса.

## Шаги

- [ ] Add a new versioned policy/migration only; never mutate A2 historical rows.
- [ ] Implement qualification and atomic spend with cash-credit conservation.

## Критерии приёмки

- [ ] Tests cover duplicate payment, self-referral, refund, spend cap, expiry, promo lock and reversal debt.
- [ ] Автоматическое списание требует сохранённого согласия или письменного запроса; курс1=1₽ применяется только к разрешённому резидентству.
- [ ] Grant создан не позднее3 рабочих дней после подтверждённой квалифицированной оплаты; повтор не создаёт второй grant.

## Команды проверки

```bash
pnpm exec vitest run packages/domain/src/expert-referral.test.ts packages/domain/src/expert-referral.property.test.ts packages/db/src/repositories/expert-referral-repository.test.ts
pnpm exec vitest run tests/repo/migration-history-integrity.test.ts
git diff --check
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
