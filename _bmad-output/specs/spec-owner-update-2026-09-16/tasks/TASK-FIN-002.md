# TASK-FIN-002: Специфицировать каталог и срок пакетов

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Таблица SKU с price, units, coupon grant, duration, timezone и migration mapping.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: decision; исполнитель: product-owner; приоритет: P0.
- Depends on: [TASK-FIN-001](TASK-FIN-001.md).
- Решения: DEC-FIN-002, DEC-FIN-003.
- Вопросы: Q-003, Q-016, Q-018, Q-019, Q-024, Q-053, Q-054, Q-118, Q-163, Q-169, Q-178, Q-179.

## Что уже есть

billing schema хранит intro ровно 100 сообщений без expiresAt; источники требуют 80/100 и 30/60 дней.

## Файлы

**Прочитать:**

- [packages/domain/src/billing.ts](../../../../packages/domain/src/billing.ts)
- [packages/db/src/schema/billing.ts](../../../../packages/db/src/schema/billing.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-client-package-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-client-package-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-002.01** — Сохранить варианты исходного каталога: «Знакомство» 80–100 сообщений без срока и без купонов; «Старт» 500, «Базовый» 1000, «Глубокий» 1500, «Максимальный» 2000 сообщений.
  - Проверка: Решение фиксирует одно точное число для «Знакомства»: 80 или 100.

- [ ] **REQ-FIN-002.02** — Для платных пакетов выбрать один срок: 60 календарных дней по ранним правилам либо 30 календарных дней по V5/файлу 05; определить момент старта и часовой пояс.
  - Проверка: Правило вычисляет expiresAt из оплаченного timestamp в заданном часовом поясе и задаёт историческую совместимость.

- [ ] **REQ-FIN-002.03** — Связать каждый платный пакет с точным купонным начислением: Старт 1000, Базовый 2000, Глубокий 3000, Максимальный 4000, либо вывести его только из утверждённой x2-формулы и подтверждённых цен пакетов.
  - Проверка: Для каждого продаваемого SKU определены price, message grants, coupon grants и срок; нет невычисляемого значения без цены.

## Шаги

- [ ] Выбрать DEC-FIN-002 и DEC-FIN-003.
- [ ] Зафиксировать start timestamp, historic package handling и no-expiry exception.

## Критерии приёмки

- [ ] Нет диапазона или невычисляемой суммы в целевом SKU.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
