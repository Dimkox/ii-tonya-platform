# TASK-EXP-007: Вход и состояния теста эксперта

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Детерминированная карта тестовых входов и безопасный стартовый текст.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-001](TASK-EXP-001.md).
- Решения: нет.
- Вопросы: Q-055, Q-056, Q-057.

## Что уже есть

Сервис уже распознаёт «тест эксперт» и хранит trial-state; развилки intention/referral/buy требуют расширения.

## Файлы

**Прочитать:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/worker/src/test-expert-trial-reconciliation.ts](../../../../packages/worker/src/test-expert-trial-reconciliation.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../../packages/application/src/test-expert-telegram-service.test.ts)
- [tests/integration/test-expert-trial-postgres.test.ts](../../../../tests/integration/test-expert-trial-postgres.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-007.01** — «ии-Тоня: эксперт-навигатор» знакомит с сервисом, собирает данные/бизнес, демонстрирует клиентский путь и ведёт к списку резидентов или менеджеру; стиль тёплый, профессиональный, лаконичный, история персонализирует ответы.
  - Проверка: Презентация не называет бот заменой специалиста.

- [ ] **REQ-EXP-007.02** — Точный «тест эксперт» ведёт в этап 4; intention просит код; рефкод просит имя рекомендовавшего; неопределённый текст предлагает тест; buy intent просит источник и ведёт к этапу 8.
  - Проверка: Каждая входная ветвь имеет отдельный next state.

## Шаги

- [ ] Закрепить «ии-Тоня: эксперт-навигатор» с запретом на обещание заменить специалиста.
- [ ] Развести точный код, intention, referral-code, неопределённый текст и buy intent по отдельным переходам.
- [ ] Для intention запросить код, для referral — имя рекомендовавшего, для buy — источник и этап 8.
- [ ] Хранить персональную историю только для продолжения того же trial.

## Критерии приёмки

- [ ] «тест эксперт» ведёт в этап 4.
- [ ] Intention без кода запрашивает код.
- [ ] Referral-code без имени не проходит дальше запроса имени.
- [ ] Неопределённый вход предлагает тест, buy intent запрашивает источник и ведёт к этапу 8.

## Команды проверки

```bash
pnpm vitest run packages/application/src/test-expert-telegram-service.test.ts tests/integration/test-expert-trial-postgres.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
