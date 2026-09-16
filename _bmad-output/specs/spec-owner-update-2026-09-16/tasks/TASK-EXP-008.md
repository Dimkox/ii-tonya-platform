# TASK-EXP-008: Демо-диагностика и карточки эксперта

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Stateful diagnostic flow и три прозрачные демо-карточки.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-007](TASK-EXP-007.md), [TASK-FIN-006](TASK-FIN-006.md).
- Решения: нет.
- Вопросы: Q-059, Q-060, Q-061, Q-062, Q-069, Q-081, Q-084.

## Что уже есть

Trial собирает базовые ответы; последовательная диагностика, три демо-карточки и запрет ссылок после отказа не подтверждены.

## Файлы

**Прочитать:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/application/src/client-catalog-service.ts](../../../../packages/application/src/client-catalog-service.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/test-expert-telegram-service.ts](../../../../packages/application/src/test-expert-telegram-service.ts)
- [packages/application/src/client-catalog-service.ts](../../../../packages/application/src/client-catalog-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/test-expert-telegram-service.test.ts](../../../../packages/application/src/test-expert-telegram-service.test.ts)
- [packages/application/src/client-catalog-service.test.ts](../../../../packages/application/src/client-catalog-service.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-008.01** — Последовательно спросить запрос, детали, длительность, шаги, первый результат и тип помощи; отразить тему/потребность и границу: бот не решает проблему и не заменяет эксперта.
  - Проверка: Следующий вопрос ждёт ответ.

- [ ] **REQ-EXP-008.02** — Показать ровно три направления и три демо-эксперта с опытом, стоимостью, локацией, связью с запросом; реальные эксперты доступны после оплаты.
  - Проверка: Три карточки имеют четыре поля.

- [ ] **REQ-EXP-008.03** — Предложить соцссылки выбранных имён, не отдавать при «нет/не надо/позже», перейти к слотам; карточка резидента содержит соцсети/сайт; запросить обратную связь и ждать её.
  - Проверка: «не надо» не отправляет ссылку.

## Шаги

- [ ] Запрашивать по одному: запрос, детали, длительность, шаги, первый результат и тип помощи; ждать каждый ответ.
- [ ] Отразить тему/потребность и границу, что бот не решает проблему и не заменяет эксперта.
- [ ] Показать ровно три направления и три демо-эксперта с опытом, стоимостью, локацией и связью с запросом.
- [ ] Давать соцссылки только выбранных имён; при «нет», «не надо», «позже» перейти к слотам и запросить feedback без ссылки.

## Критерии приёмки

- [ ] Следующий вопрос не формируется до ответа на предыдущий.
- [ ] Результат содержит ровно три карточки, каждая с четырьмя заданными полями.
- [ ] «нет», «не надо» и «позже» не отправляют соцссылку.
- [ ] Демо не выдаёт реального эксперта как доступного без оплаты.

## Команды проверки

```bash
pnpm vitest run packages/application/src/test-expert-telegram-service.test.ts packages/application/src/client-catalog-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
