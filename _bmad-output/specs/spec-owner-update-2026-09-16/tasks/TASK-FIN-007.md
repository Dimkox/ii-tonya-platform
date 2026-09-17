# TASK-FIN-007: Выбрать новую expert pricing policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Выбранная versioned pricing policy и eligibility Exclusive.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: нет.
- Решения: DEC-FIN-007 (accepted ① V2), DEC-FIN-009 (accepted ② recommendation).
- Вопросы: Q-086, Q-088, Q-089, Q-090, Q-126, Q-148, Q-164, Q-185.

## Что уже есть

V2 CHECK constraints фиксируют START/BASE/PRO=3900/5900/9990 и cap 30%; новые личные диапазоны не помещаются в V2.

## Файлы

**Прочитать:**

- [packages/db/migrations/0032_commercial_core_v2_a1.sql](../../../../packages/db/migrations/0032_commercial_core_v2_a1.sql)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)
- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-expert-pricing-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-expert-pricing-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-008.01** — Старые варианты цены не объединяются: база 12000 и Эксклюзив 20000 с setup 3000; график входа 8000/9000/10000/12000 на дни 1–7/8–14/15–21/22+; V3 10000/11000/12000/13000/14000 и Эксклюзив 16000→20000; ориентиры 8000–15000 и 16000–20000; действующая V2 фиксирована 3900/5900/9990. Ранняя недельная скидка от базы 12000: −4000/−3000/−2000/0 по окнам 1–7/8–14/15–21/22+ дней (эквивалентно 8/9/10/12 тыс.).
  - Проверка: Decision выбирает одну новую versioned policy либо сохраняет V2; исторические правила не становятся активными неявно.

- [ ] **REQ-FIN-008.04** — Порог «Эксклюзив» от цены услуги 15000 ₽ должен быть объявлен строгим eligibility rule либо только маркетинговой рекомендацией.
  - Проверка: API и контент одинаково обрабатывают услугу стоимостью 14999 и 15000 ₽.

## Шаги

- [ ] Выбрать DEC-FIN-007 и DEC-FIN-009.
- [ ] Явно маркировать 12k/20k, 8–15k, V3 как active или superseded.

## Критерии приёмки

- [ ] Policy содержит одну исполнимую формулу, не меняет историческую V2.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
