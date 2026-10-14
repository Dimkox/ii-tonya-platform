# TASK-FIN-013: Выбрать organizer tier и consumption rules

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Organizer tier table, qualifying referral and band-consumption rules.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: нет.
- Решения: DEC-FIN-012.
- Вопросы: Q-151, Q-152, Q-164, Q-190, Q-191.

## Что уже есть

Current entitlements are fixed 5×50/3×100/1×500, but cross-band consumption is not stated.

## Файлы

**Прочитать:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-organizer-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-organizer-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-012.01** — Организатор имеет базу 20000 ₽/месяц и включения 5 событий до 50, 3 до 100 и 1 до 500; сверх лимита — 10%, нерезидент — 15% выручки + 4500 ₽.
  - Проверка: Quote организатора возвращает три точные корзины 5×50, 3×100 и 1×500.

- [ ] **REQ-FIN-012.02** — Тариф по приведённым экспертам имеет альтернативы <5/5–9/10+ = 20000/15000/10000 и 0–5/>5–<10/10+; текущий код использует >=6. Определить, расходует ли меньшее мероприятие квоту большей корзины и кто считается квалифицированным экспертом.
  - Проверка: Boundary 5/6/10 и расход одной корзины другой покрыты тестами.

## Шаги

- [ ] Choose threshold rule.
- [ ] Define exact band allocation algorithm.

## Критерии приёмки

- [ ] One event cannot consume ambiguous capacity; 5/6/10 threshold specified.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
