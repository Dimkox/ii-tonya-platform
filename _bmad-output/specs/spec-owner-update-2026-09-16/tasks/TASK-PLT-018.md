# TASK-PLT-018: Карантин входящего текста до правового основания (CAP-4 дефект)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Режим обработки входа по DEC-PLT-014: скрининг/карантин до персиста сырого текста (hybrid-message-repository.ts:105-107) с документированным TTL.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P0.
- Depends on: `TASK-DEC-PLT-014`.
- Решения: `DEC-PLT-014`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

CAP-4 не выполнен сегодня: путь B1 персистит сырой текст входящего сообщения в dialogue_inbound.text с TTL 30 дней без скрининга (hybrid-message-repository.ts:105-107); детерминированный safety-конвейер в проде отключён (apps/api/src/server.ts:332-333); guardClientCopy гейтит только исходящие.

## Файлы

**Прочитать:**

- [safety.ts](../../../../packages/domain/src/safety.ts)
- [env.ts](../../../../packages/config/src/env.ts)
- [b2-sensitive-retention-repository.ts](../../../../packages/db/src/repositories/b2-sensitive-retention-repository.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-014-rule.md` (от `TASK-DEC-PLT-014`)


**Изменить:**

- [hybrid-message-repository.ts](../../../../packages/db/src/repositories/hybrid-message-repository.ts)
- [env.ts](../../../../packages/config/src/env.ts)


**Создать:**

- [inbound-text-quarantine.test.ts](../../../../tests/repo/inbound-text-quarantine.test.ts)


**Проверки:**

- [inbound-text-quarantine.test.ts](../../../../tests/repo/inbound-text-quarantine.test.ts)


## Пункты задачи

- [ ] Режим обработки входа по DEC-PLT-014: скрининг/карантин до персиста сырого текста (hybrid-message-repository.ts:105-107) с документированным TTL.
- [ ] Обновление docs/operations/owner-update-data-matrix.md: фактический состав и срок персиста входа.
- [ ] Регресс-тест tests/repo/inbound-text-quarantine.test.ts: контрольный текст не попадает в постоянные хранилища и во внешние вызовы.


## Шаги

- [ ] До принятия DEC-PLT-014 не имплементировать: задача открыта как носитель дефекта, interim-правило уже запрещает персист спецданных.
- [ ] Замерить текущий фактический персист (30 дней) и зафиксировать в матрице как дефект, а не как основание.
- [ ] Выбранный вариант реализовать с тест-контролем «последующее согласие не легализует задним числом».


## Критерии приёмки

- [ ] Контрольный текст не обнаруживается в dialogue_inbound и в исходящих payload после реализации.
- [ ] TTL и состав персиста входа в матрице и в коде совпадают (проверяются тестом).
- [ ] Better-than-nothing: ни один внешний ИИ-вызов не получает неэкранированный вход до granted основания.


## Команды проверки

```bash
pnpm install --frozen-lockfile && pnpm exec vitest run tests/repo/inbound-text-quarantine.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] interim-правило `DEC-PLT-004` (§1–§9) соблюдается: спецданные и ПД третьих лиц не персистятся и не передаются, подробный режим закрыт.
