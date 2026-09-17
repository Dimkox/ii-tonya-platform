# TASK-FIN-012: Выбрать centre tier и referral qualification

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Centre tier table and qualified-referral definition.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: нет.
- Решения: DEC-FIN-012.
- Вопросы: Q-150, Q-152, Q-164, Q-188.

## Что уже есть

Shadow quote применяет >=6/>=10; source даёт 5–9 и >5 варианты.

## Файлы

**Прочитать:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)
- [packages/db/migrations/0037_partner_commerce_a.sql](../../../../packages/db/migrations/0037_partner_commerce_a.sql)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-center-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-center-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-011.01** — Центр/студия/салон имеет базу 15000 ₽/месяц и квоту 10 мероприятий вместимостью до 30; сверх квоты взимается 10% сбора, нерезидент — 15% выручки + 4500 ₽ за карточку.
  - Проверка: Quote центра возвращает 15000, entitlement 10×30 и заданные комиссии.

- [ ] **REQ-FIN-011.02** — Тариф по приведённым экспертам имеет альтернативные границы: <5/5–9/10+ = 15000/12000/8000 либо 0–5/>5–<10/10+; текущий код использует >=6 и >=10. Определить квалификацию учитываемого эксперта.
  - Проверка: Boundary-тесты на 4, 5, 6, 9 и 10 квалифицированных экспертов соответствуют принятой таблице.

## Шаги

- [ ] Выбрать DEC-FIN-012 для centre.
- [ ] Определить event, который засчитывает приведённого эксперта.

## Критерии приёмки

- [ ] Таблица однозначна для 4,5,6,9,10.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
