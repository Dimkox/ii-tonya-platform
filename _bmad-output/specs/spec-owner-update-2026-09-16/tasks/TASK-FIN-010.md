# TASK-FIN-010: Выбрать и специфицировать Energy Start

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Единая таблица коэффициентов, timezone, eligibility и quote lifetime.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: [TASK-FIN-007](TASK-FIN-007.md).
- Решения: DEC-FIN-010, DEC-FIN-011.
- Вопросы: Q-159, Q-162, Q-194.

## Что уже есть

Baseline не подтверждает Energy Start в active product; источники содержат две разные discount tables.

## Файлы

**Прочитать:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-energy-start-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-energy-start-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-009.01** — Эквивалентные записи одной шкалы «Энергии начала» объединены: скидки 40%/30%/20%/0% означают коэффициенты оплаты 0.6/0.7/0.8/1 для эксперта/центра/организатора; для аренды 20%/10%/0% означают 0.8/0.9/1. Начало отсчёта — calculation_timestamp. Точные переходы этапов определяются DEC-FIN-010.
  - Проверка: Boundary-тесты на дни 3/4/6/7/9/10 и time zone возвращают утверждённые коэффициенты.

- [ ] **REQ-FIN-009.02** — Для одинаковой шкалы сохраняются варианты границ: календарные «первые 3 дня / дни 4–6 / дни 7–9 / после 9» и псевдокод floor(elapsed_days) с <=3/<=6/<=9. Выбрать часовой пояс, начало дня, включительность границы и поведение повторного расчёта; после окна аренды 6 дней исходный псевдокод задаёт коэффициент 1, короткая оферта об этом умалчивает.
  - Проверка: Decision называет единственную активную таблицу, а документация маркирует альтернативу superseded.

- [ ] **REQ-FIN-009.03** — После акции цена вычисляется по актуальной policy; критерий «новый привлечённый эксперт», который уменьшает цену центра/организатора, определяется отдельно.
  - Проверка: Technical design определяет qualified referral и event, после которого пересчитывается quote.

## Шаги

- [ ] Выбрать DEC-FIN-010/011.
- [ ] Определить calculation_timestamp and persisted quote validity.

## Критерии приёмки

- [ ] Таблица имеет точные outcomes на day 3/4/6/7/9/10 по категориям.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
