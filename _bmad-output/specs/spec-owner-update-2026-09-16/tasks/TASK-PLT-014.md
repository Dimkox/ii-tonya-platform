# TASK-PLT-014: Атрибуция рекламного бота и партнёров

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Атрибуция рекламного бота и партнёров с проверкой перечисленных исходных пунктов и свидетельствами приёмки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-FIN-024](TASK-FIN-024.md), [TASK-DEC-PLT-009](TASK-DEC-PLT-009.md).
- Решения: DEC-PLT-009.
- Вопросы: нет.

## Что уже есть

Исходные компоненты есть на базовом SHA; соответствие новым условиям требует проверки и указанных изменений.

## Файлы

**Прочитать:**

- [packages/observability/src/logger.ts](../../../../packages/observability/src/logger.ts)
- [packages/application/src/partner-commerce.ts](../../../../packages/application/src/partner-commerce.ts)
- [packages/db/src/repositories/partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/observability/src/logger.ts](../../../../packages/observability/src/logger.ts)
- [packages/application/src/partner-commerce.ts](../../../../packages/application/src/partner-commerce.ts)
- [packages/db/src/repositories/partner-commerce-repository.ts](../../../../packages/db/src/repositories/partner-commerce-repository.ts)

**Создать:**

- [packages/application/src/acquisition-attribution.ts](../../../../packages/application/src/acquisition-attribution.ts)

**Проверки:**

- [packages/db/src/repositories/partner-commerce-repository.test.ts](../../../../packages/db/src/repositories/partner-commerce-repository.test.ts)

## Пункты задачи

- [ ] **REQ-PLT-007.02** — Переход рекламного Telegram-бота в ядро сохраняет source=promo_bot для измерения эффективности. QA связывает версии финансовых правил, FIFO, акции/floor, slots, код/первую оплату, категории и терминологию с утверждёнными policy; событие перехода не означает продажу.
  - Проверка: Проверить все явно перечисленные в этом пункте значения, переходы и исключения; конкретные сценарии и границы приведены в связанной карточке задачи.

- [ ] **REQ-PLT-007.04** — Центры и организаторы публикуют анонсы по своей базе, а сервис обрабатывает и записывает откликнувшихся, сохраняя отдельный атрибуционный статус партнёра.
  - Проверка: Решение/дизайн фиксирует источник, границы, отказные случаи и проверяемый результат.

## Шаги

- [ ] Сохранить source=promo_bot при переходе и отдельный partner attribution по утверждённому правилу.
- [ ] Сопоставить идентификаторы клика/участника/заявки/подтверждённой оплаты без включения PII в метрики.
- [ ] Отчёт отделяет переход, анкету, бронь и квалифицирующую оплату.

## Критерии приёмки

- [ ] Повтор перехода не удваивает конверсию; реферальный бонус создаёт только FIN24.
- [ ] Partner status не теряется при переходе междуботом иядром.
- [ ] Выбранное first/last touch поведение воспроизводится при нескольких источниках.

## Команды проверки

```bash
pnpm exec vitest run packages/db/src/repositories/partner-commerce-repository.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
