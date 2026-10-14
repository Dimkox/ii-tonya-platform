# TASK-EXP-003: Политика сопровождения клиента после визита

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Идемпотентные follow-up, unavailable-expert handoff и недельный чекап.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: [TASK-EXP-002](TASK-EXP-002.md), [TASK-FIN-021](TASK-FIN-021.md), [TASK-PLT-008](TASK-PLT-008.md), [TASK-DEC-EXP-006](TASK-DEC-EXP-006.md).
- Решения: DEC-EXP-006.
- Вопросы: Q-005, Q-008, Q-021, Q-022, Q-023, Q-121, Q-124.

## Что уже есть

Сервисы диалога и feedback существуют; follow-up после визита и добровольный чекап не зафиксированы.

## Файлы

**Прочитать:**

- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/application/src/feedback-service.ts](../../../../packages/application/src/feedback-service.ts)
- [packages/worker/src/outbox-runner.ts](../../../../packages/worker/src/outbox-runner.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/application/src/feedback-service.ts](../../../../packages/application/src/feedback-service.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/conversation-service.test.ts](../../../../packages/application/src/conversation-service.test.ts)
- [packages/application/src/feedback-service.test.ts](../../../../packages/application/src/feedback-service.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-003.01** — Оплативший пакет видит купоны/остаток, закрытые события, новых экспертов, слоты и приоритетную запись при наличии места; текущему эксперту показывать только его расписание и напоминания.
  - Проверка: Неоплативший контекст не получает приоритетную запись.

- [ ] **REQ-EXP-003.02** — Источник одновременно задаёт запрос отзыва на следующий день и3–4дня без инициативных сообщений; затем продолжение или напоминание через1–2недели. Порядок исключений, ежедневных чекапов и quiet period выбрать DEC-EXP-006. При отсутствии эксперта передать запрос админу, предложить альтернативы и сообщать о добавлении лишь после факта.
  - Проверка: ПровереныD+1,D+3,D+4 и чекап внутри паузы: отправка или подавление точно соответствует DEC-EXP-006.
  - Проверка: Визит/отзыв/таймер с тем же id не создаёт повторного сообщения.

- [ ] **REQ-EXP-003.03** — Добровольный чекап: ПН настроение, ВТ победа, СР тело, ЧТ инсайт, ПТ дыхание 4–2–6, СБ благодарность, ВС планы/запись; прекращение сервиса не компенсирует единицы и купоны.
  - Проверка: Пятничная ветвь содержит 4–2–6.

## Шаги

- [ ] Сделать завершённый визит единственным стартом цепочки.
- [ ] Поставить отзыв на следующий день, запретить инициативное сообщение дни 1–3, затем предложить продолжение либо 1–2-недельное напоминание.
- [ ] При отсутствии эксперта передать админу, показать альтернативы и сообщать о добавлении только после факта.
- [ ] Добавить opt-in чекап ПН–ВС с пятничным дыханием 4–2–6 и остановкой без компенсации единиц/купонов.

## Критерии приёмки

- [ ] До следующего дня после визита отзыв не создаётся.
- [ ] В первые 3 полных дня не создаётся инициативное сообщение.
- [ ] Пятничная ветвь содержит 4–2–6.
- [ ] Отсутствующий эксперт создаёт handoff админу без ложного обещания.
- [ ] Отключение чекапа не меняет единицы и купоны.

## Команды проверки

```bash
pnpm vitest run packages/application/src/conversation-service.test.ts packages/application/src/feedback-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
