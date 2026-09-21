# TASK-FIN-008: Спроектировать personal expert quote

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Versioned quote input/output, factor provenance, setup fee and price-lock design.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: design; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-FIN-007](TASK-FIN-007.md), [TASK-DEC-FIN-021](TASK-DEC-FIN-021.md), [TASK-DEC-FIN-024](TASK-DEC-FIN-024.md), [TASK-FIN-009](TASK-FIN-009.md).
- Решения: DEC-FIN-007, DEC-FIN-021, DEC-FIN-024, DEC-FIN-028.
- Вопросы: Q-075, Q-079, Q-086, Q-088, Q-091, Q-092, Q-126, Q-134.

## Что уже есть

Нет проверенной реализации personal formula; V2 tariff constraints нельзя переписывать исторически.

## Файлы

**Прочитать:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

Нет.

**Создать:**

- [docs/superpowers/implementation-artifacts/fin-personal-quote-design.md](../../../../docs/superpowers/implementation-artifacts/fin-personal-quote-design.md)

**Проверки:**

- [packages/application/src/expert-residency-service.test.ts](../../../../packages/application/src/expert-residency-service.test.ts)

## Пункты задачи

- [ ] **REQ-FIN-008.02** — Первое подключение может требовать setup fee 3000 ₽, а обновление карточки включаться в абонентскую плату; определить, для каких категорий и policy version это применимо.
  - Проверка: Invoice явно разделяет setup и recurring line items.

- [ ] **REQ-FIN-008.03** — Подтверждённая цена фиксируется на непрерывное резидентство; при перерыве более 3 месяцев она пересчитывается по актуальной политике. Резидентство предоплачивается фиксированной суммой за один месяц/не более 30 календарных дней; link продления предлагается за 3–5 дней.
  - Проверка: Order не позволяет купить более 30 календарных дней вперёд; тест на 3 месяца перерыва подтверждает выбранную границу перерасчёта.

- [ ] **REQ-FIN-007.04** — Изменение сведений эксперта запускает проверку менеджером и пересчёт персонального тарифа по актуальным проверенным данным. Для намеренно искажённых/скрытых сведений процедура, доказательства, уведомление, обжалование и срок проверки закрываются DEC-FIN-024; автоматическое ретроактивное взыскание не задано исходником.
  - Проверка: Изменённые факторы создают новый запрос проверки и новый снимок расчёта, сохраняя прежние значения и аудит менеджера.
  - Проверка: Два одинаковых события изменения не создают два ценовых предложения.
  - Проверка: Без подтверждённого правила DEC-FIN-024 обвинение в недостоверности не приводит к автоматическому дополнительному списанию.

## Шаги

- [ ] Зафиксировать city/format/check eligibility inputs.
- [ ] Определить new policy tables and manual migration requirement.
- [ ] Добавить ручную проверку изменённых ценовых факторов эксперта, неизменяемую историю и re-quote по DEC-FIN-024.

## Критерии приёмки

- [ ] Quote воспроизводим по persisted inputs и не допускает произвольной цены.
- [ ] Повтор изменения не создаёт дубли проверки/расчёта; прежний оплаченный заказ не переписывается.

## Команды проверки

```bash
pnpm exec vitest run packages/application/src/expert-residency-service.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
