# TASK-EXP-018: Тексты«Энергии начала» по согласованному расчёту

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Policy-driven renderer кампании без второй задачи принятия финансового решения.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: content; исполнитель: product-owner; приоритет: P0.
- Depends on: [TASK-FIN-001](TASK-FIN-001.md), [TASK-FIN-002](TASK-FIN-002.md), [TASK-FIN-003](TASK-FIN-003.md), [TASK-FIN-004](TASK-FIN-004.md), [TASK-EXP-015](TASK-EXP-015.md), [TASK-FIN-022](TASK-FIN-022.md), [TASK-FIN-024](TASK-FIN-024.md), [TASK-FIN-010](TASK-FIN-010.md), [TASK-FIN-019](TASK-FIN-019.md), [TASK-DEC-FIN-017](TASK-DEC-FIN-017.md).
- Решения: DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004, DEC-FIN-010, DEC-FIN-011, DEC-FIN-016, DEC-FIN-017.
- Вопросы: Q-156.

## Что уже есть

Источники конфликтуют по 40%, бонусам до 30% и формуле 3-month Start; renderer не может выбирать сам.

## Файлы

**Прочитать:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)
- [packages/db/src/schema/commercial-policy.ts](../../../../packages/db/src/schema/commercial-policy.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [apps/web/src/content.ts](../../../../apps/web/src/content.ts)
- [apps/web/src/landing-view.ts](../../../../apps/web/src/landing-view.ts)

**Создать:**

Нет.

**Проверки:**

- [apps/web/src/content.test.ts](../../../../apps/web/src/content.test.ts)
- [apps/web/src/landing-view.test.ts](../../../../apps/web/src/landing-view.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-018.01** — First entry: Energy start 40% первые 3 дня; 3-month Start = ПБЦ×0.6×3×0.85; 1000 referral bonus после акции до 30%.
  - Проверка: После day3 акция не применяется.

- [ ] **REQ-EXP-018.02** — Returning: 40% или бонусы до 30% на акции, вне акции накопленные до30; порядок expert: тариф→акция→согласие→анкета→approval→link→paid→brief→card→code; space: package→акция→проверка→ручная ссылка→paid→brief.
  - Проверка: Одновременно не применяются 40% и бонусы без policy.

## Шаги

- [ ] Получать eligibility first-entry/returning, даты, 40%, лимит бонусов, формулу и порядок онбординга только из FIN policy.
- [ ] Рендерить first-entry 40% первые 3 дня и ПБЦ×0.6×3×0.85, только если active policy содержит эти правила.
- [ ] Не совмещать 40% и бонусы без явного compatible rule.
- [ ] Показывать порядок expert/space как инструкцию без создания payment/approval операции UI.

## Критерии приёмки

- [ ] После дня 3 first-entry акция не отображается без active rule.
- [ ] Без active policy не показаны 40%, 30%, 1 000 и формула Start.
- [ ] При запрете совместимости 40% и бонусы не показаны вместе.
- [ ] Renderer не переводит в approved/paid и не создаёт payment link.

## Команды проверки

```bash
pnpm vitest run apps/web/src/content.test.ts apps/web/src/landing-view.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
