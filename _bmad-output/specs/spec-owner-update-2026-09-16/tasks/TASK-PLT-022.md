# TASK-PLT-022: Подключить потребитель события booking.handoff_revoked

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Тема `booking.handoff_revoked` в allowlist и диспетчер, который исполняет аннулирование переданного состава у получателя.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: .
- Решения: `DEC-PLT-004`.
- Носитель: найдено независимым review read-path PR #97 (2026-09-21); interim-правило `DEC-PLT-004`.
- Статус live: ничего не включается; внешние флаги остаются `false`.

## Что уже есть

Событие `booking.handoff_revoked` порождается (`privacy-repository.ts:235-243`), но темы нет ни в allowlist воркера, ни в списке claim'ов Telegram: `grep -rn handoff_revoked packages/contracts/src/worker-outbox.ts packages/db/src/repositories/outbox-repository.ts` пусто (проверено 2026-09-21), а `outbox-repository.ts:31-37` бросает `worker_outbox_topic_allowlist_invalid` на неперечисленные темы. Нога §3 «получатели удаляют свои копии» не подключена.

## Файлы

**Прочитать:**

- [worker-outbox.ts](../../../../packages/contracts/src/worker-outbox.ts)
- [outbox-repository.ts](../../../../packages/db/src/repositories/outbox-repository.ts)
- [privacy-repository.ts](../../../../packages/db/src/repositories/privacy-repository.ts)


**Изменить:**

- [worker-outbox.ts](../../../../packages/contracts/src/worker-outbox.ts)
- [outbox-repository.ts](../../../../packages/db/src/repositories/outbox-repository.ts)


**Создать:**

- [handoff-revoke-consumer.test.ts](../../../../tests/repo/handoff-revoke-consumer.test.ts)


**Проверки:**

- [handoff-revoke-consumer.test.ts](../../../../tests/repo/handoff-revoke-consumer.test.ts)


## Пункты задачи

- [ ] Тема `booking.handoff_revoked` в allowlist и диспетчер, который исполняет аннулирование переданного состава у получателя.
- [ ] Идемпотентность: повторная доставка не порождает повторного исполнения и не возвращает данные эксперту.


## Шаги

- [ ] Определить поведение при выключенном внешнем канале (все флаги default-off): фиксировать локальное исполнение, не изобретать внешний вызов.
- [ ] Сохранить трипвайр: неизвестная тема по-прежнему должна ронять воркера.


## Критерии приёмки

- [ ] Событие, поставленное отзывом, прочитано потребителем и помечено исполненным (DB-free тест по allowlist + интеграционный прогон).
- [ ] Ни один путь не возвращает эксперту данные после отзыва (тот же кейс, что в read-гейте).


## Команды проверки

```bash
pnpm exec vitest run tests/repo/handoff-revoke-consumer.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены с точным коммитом.
- [ ] Независимый review пройден; live-активация не объявляется.
- [ ] Контрольный случай, доказывающий переключение гейта, обязан дать противоположный вердикт.
