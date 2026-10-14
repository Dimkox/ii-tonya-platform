# TASK-EXP-010: Статусная машина онбординга резидента

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Проверяемая status machine эксперта, центра/студии, организатора и владельца пространства.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: [TASK-EXP-009](TASK-EXP-009.md), [TASK-FIN-022](TASK-FIN-022.md), [TASK-PLT-008](TASK-PLT-008.md), [TASK-DEC-PLT-006](TASK-DEC-PLT-006.md), [TASK-DEC-FIN-026](TASK-DEC-FIN-026.md).
- Решения: DEC-PLT-006, DEC-FIN-026.
- Вопросы: Q-125, Q-182.

## Что уже есть

Residency service, schema и repository существуют; полнота анкеты, ручной payment link и manager audit требуют сверки с состояниями.

## Файлы

**Прочитать:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/schema/expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)
- [packages/db/src/repositories/expert-residency-repository.ts](../../../../packages/db/src/repositories/expert-residency-repository.ts)

**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.

**Изменить:**

- [packages/application/src/expert-residency-service.ts](../../../../packages/application/src/expert-residency-service.ts)
- [packages/db/src/repositories/expert-residency-repository.ts](../../../../packages/db/src/repositories/expert-residency-repository.ts)

**Создать:**

Нет.

**Проверки:**

- [packages/application/src/expert-residency-service.test.ts](../../../../packages/application/src/expert-residency-service.test.ts)
- [packages/db/src/repositories/expert-residency-repository.test.ts](../../../../packages/db/src/repositories/expert-residency-repository.test.ts)

## Пункты задачи

- [ ] **REQ-EXP-010.01** — Виды: эксперт, центр/студия, организатор, владелец пространства; до публикации нужны проверка и оплата.
  - Проверка: Непроверенный не публикуется.

- [ ] **REQ-EXP-010.02** — Онбординг: тест эксперт, анкета, договор, 3 000 ₽; образование, опыт, кейсы, соцсети, специализация, сертификаты/материалы; достоверность услуг, цен и компетенций.
  - Проверка: Неполная анкета остаётся pending.

- [ ] **REQ-EXP-010.03** — Статусы: pending, проверка 1–2 дня, approved/rejected, ручная payment link, paid, бриф, карточка 1–3 дня, completed; хранить аудит менеджера, данные и link; отказ при непрохождении стандартов.
  - Проверка: Rejected не публикуется; paid определяется только подтверждённым платёжным событием, ранний/неожиданный платёж не теряется и направляется на разбор.

## Шаги

- [ ] Зафиксировать типы и запрет публикации до проверки и оплаты.
- [ ] Проверять образование, опыт, кейсы, соцсети, специализацию, сертификаты/материалы, достоверность услуг, цен и компетенций.
- [ ] Реализовать pending → review 1–2 дня → approved/rejected → paid → brief → card 1–3 дня → completed с причиной отказа и audit.
- [ ] Хранить payment link как ручной артефакт, не делая провайдера источником статуса проверки.

## Критерии приёмки

- [ ] Неполная анкета остаётся pending.
- [ ] Непроверенный или неоплаченный резидент не публикуется.
- [ ] Approved/rejected хранит manager action и причину/доказательство.
- [ ] card не достигается до paid и brief.
- [ ] Платёж после rejected не публикует карточку: подтверждённый финансовый факт сохраняется и направляется на разбор/возврат по утверждённому правилу.

## Команды проверки

```bash
pnpm vitest run packages/application/src/expert-residency-service.test.ts packages/db/src/repositories/expert-residency-repository.test.ts
```

## Evidence и завершение

- [ ] Сохранить результаты проверок и связь с пунктами исходника.
- [ ] Закрыть связанные DEC/Q или явно оставить задачу blocked.
- [ ] Пройти независимый review; не объявлять live-активацию по результату локального теста.
