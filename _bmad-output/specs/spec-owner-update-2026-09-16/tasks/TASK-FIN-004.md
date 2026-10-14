# TASK-FIN-004: Специфицировать reminder истечения

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Временная схема, dedupe key и billing rule reminder.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: decision; исполнитель: product-owner; приоритет: P1.
- Depends on: [TASK-FIN-002](TASK-FIN-002.md).
- Решения: DEC-FIN-004.
- Вопросы: Q-015, Q-017, Q-024, Q-053, Q-054, Q-118.

## Что уже есть

В исходном коде правило reminder не подтверждено baseline.

## Файлы

**Прочитать:**

- [packages/db/src/schema/billing.ts](../../../../packages/db/src/schema/billing.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-package-reminder-policy.md](../../../../docs/superpowers/implementation-artifacts/fin-package-reminder-policy.md)

**Проверки:**

Нет.

## Пункты задачи

- [ ] **REQ-FIN-003.01** — Напоминание об окончании пакетного доступа отправляется единым сообщением с истекающим пакетом и остатками других пакетов, выбирает ближайший дедлайн и не повторяется для одного package_id. Источник задаёт группировку по client_id, проверку last_reminder_sent!=package_id и запись этого маркера после успешной отправки; ledger/outbox должны исключать двойную отправку или debit при сбое между этими шагами.
  - Проверка: Повторный scheduler-run не создаёт второе уведомление для того же package_id.

- [ ] **REQ-FIN-003.02** — Выбрать точную временную семантику: «ровно за 3 дня» либо сканирующее окно days_until 2–4; определить округление, расписание job и то, списывается ли само напоминание. Исходный планировщик запускается раз в 24 часа; варианты напоминания клиентскому пакету за 14 и 7 дней удалены в этом сценарии. В этой версии исходника reminder стоит одну единицу; отличие от действующей бесплатной system-message policy разрешается DEC-FIN-001, а не считается отсутствующим требованием.
  - Проверка: Boundary-тесты на 2, 3 и 4 дня дают утверждённый результат.

## Шаги

- [ ] Выбрать DEC-FIN-004.
- [ ] Определить timezone/rounding и interaction с pause/other notifications.

## Критерии приёмки

- [ ] Спека содержит outcomes для 2/3/4 дней и repeated run.

## Команды проверки

Проверка решений/контента по критериям выше; запуск приложения не является доказательством принятого решения.

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
