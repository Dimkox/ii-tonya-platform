# TASK-EXP-004: КлиентскийFAQ, аудиокаст и уведомления по утверждённой policy

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Consumer versioned commercial policy, не выбирающий спорные когорты, сроки, лимиты или цены.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-001](TASK-FIN-001.md), [TASK-FIN-002](TASK-FIN-002.md), [TASK-FIN-003](TASK-FIN-003.md), [TASK-FIN-004](TASK-FIN-004.md), [TASK-FIN-021](TASK-FIN-021.md), [TASK-PLT-004](TASK-PLT-004.md).
- Решения: DEC-FIN-001, DEC-FIN-002, DEC-FIN-003, DEC-FIN-004.
- Вопросы: Q-014, Q-028, Q-155.

## Что уже есть

Есть free_client_v2/legacy_package_v1 и Telegram delivery; consumer утверждённой пакетной policy для FAQ, аудиокаста и напоминаний не подтверждён.

## Файлы

**Прочитать:**

- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/application/src/client-commercial-policy.ts](../../../../packages/application/src/client-commercial-policy.ts)
- [packages/worker/src/telegram-send-text-dispatcher.ts](../../../../packages/worker/src/telegram-send-text-dispatcher.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/conversation-service.ts](../../../../packages/application/src/conversation-service.ts)
- [packages/application/src/client-commercial-policy.ts](../../../../packages/application/src/client-commercial-policy.ts)
- [packages/worker/src/telegram-send-text-dispatcher.ts](../../../../packages/worker/src/telegram-send-text-dispatcher.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/conversation-service.test.ts](../../../../packages/application/src/conversation-service.test.ts)
- [packages/application/src/client-commercial-policy.test.ts](../../../../packages/application/src/client-commercial-policy.test.ts)
- [packages/worker/src/telegram-send-text-dispatcher.test.ts](../../../../packages/worker/src/telegram-send-text-dispatcher.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-004.01** — Подтверждённая запись даёт ссылку и напоминания за 2 дня, 1 день, 1 час.
  - Проверка: Есть ровно три напоминания.

- [ ] **REQ-EXP-004.02** — Аудиокаст выбирает активный пакет с ближайшим дедлайном, отправляет одно сообщение со ссылкой/пояснением и списывает одну единицу.
  - Проверка: Списывается ближайший дедлайн.

- [ ] **REQ-EXP-005.01** — CTA клиента передаёт в мессенджер «тест клиент» для бесплатной диагностики и подбора.
  - Проверка: CTA содержит точный код.

- [ ] **REQ-EXP-005.02** — FAQ берётся из Энциклопедии v2.1; Selarti разрешён только при отсутствии ответа, «РАССЧИТАТЬ» или сложном возражении; 80% базы бесплатны, лимит считает только Selarti.
  - Проверка: Ответ базы не вызывает Selarti.

## Шаги

- [ ] Получать когорту, срок, лимит, порядок списания и reminder-семантику только из FIN-решений.
- [ ] Создавать через идемпотентную очередь напоминания подтверждённой записи за 2 дня, 1 день и 1 час.
- [ ] Для аудиокаста выбирать активный пакет с ближайшим утверждённым дедлайном, посылать одно сообщение со ссылкой/пояснением и транзакционно списывать одну единицу.
- [ ] Направлять «тест клиент» в мессенджер; брать FAQ из Энциклопедии v2.1 и вызывать Selarti только без ответа, при «РАССЧИТАТЬ» или сложном возражении.

## Критерии приёмки

- [ ] Без DEC-FIN-001…004 функция pending и не выбирает когорту, срок, лимит или цену.
- [ ] Подтверждённая запись создаёт ровно три напоминания: 2 дня, 1 день, 1 час.
- [ ] При двух пакетах аудиокаст списывает одну единицу только с ближайшего дедлайна.
- [ ] Повтор delivery event не создаёт второе сообщение и второе списание.
- [ ] Ответ из базы не вызывает Selarti; лимит считает только Selarti.

## Команды проверки

```bash
pnpm vitest run packages/application/src/conversation-service.test.ts packages/application/src/client-commercial-policy.test.ts packages/worker/src/telegram-send-text-dispatcher.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
