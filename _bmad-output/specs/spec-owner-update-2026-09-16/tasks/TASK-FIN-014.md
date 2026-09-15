# TASK-FIN-014: Специфицировать group-event financial settlement

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Deposit, final settlement, registered-attendee report and invoice deadline contract.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: нет.
- Решения: DEC-FIN-013, DEC-FIN-020.
- Вопросы: Q-075, Q-076, Q-127, Q-148.

## Что уже есть

Current partner quote knows 10%/15%+4500 but source conflicts on deposit base.

## Файлы

**Прочитать:**

- [packages/domain/src/partner-pricing.ts](../../../../packages/domain/src/partner-pricing.ts)
- [packages/db/src/schema/partner-commerce.ts](../../../../packages/db/src/schema/partner-commerce.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-group-event-settlement.md](../../../../docs/superpowers/implementation-artifacts/fin-group-event-settlement.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-013.01** — Базовый резидент получает неограниченные индивидуальные услуги и одну группу до 20 человек в месяц; дополнительная группа стоит 10% расчётной выручки. Нерезидент может заказать только набор группы за 15% выручки + 4500 ₽ карточки.
  - Проверка: Quote отделяет включённую группу, дополнительную резидентскую и нерезидентскую услугу.

- [ ] **REQ-FIN-013.02** — При заявке берётся бронь 30%; исходные формулировки «30% услуги проекта» и «30% предполагаемой выручки» являются альтернативами. После набора оплачивается остаток 70%, отчёт формируется по зарегистрированным, счёт имеет срок 5 рабочих дней, набор не гарантирован.
  - Проверка: Decision определяет базу 30%; settlement использует зарегистрированных участников и сохраняет расчёт.

## Шаги

- [ ] Choose DEC-FIN-013.
- [ ] Specify cancellation/no-enrollment behavior without guaranteed recruitment.

## Критерии приёмки

- [ ] Example settlement conserves 30% deposit + 70% remainder and records attendees.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
