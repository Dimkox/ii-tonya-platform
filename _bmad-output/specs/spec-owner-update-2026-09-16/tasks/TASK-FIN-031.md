# TASK-FIN-031: Lifecycle эксперского кода: отметка видимости и ограничение одного активного кода

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Отметка видимости кода по первой успешной оплате резидентуры (DEC-FIN-014 ①) реализована колонкой и гейтом display/API.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-DEC-FIN-029`.
- Решения: `DEC-FIN-014`, `DEC-FIN-029`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Артефакт fin-expert-code-lifecycle.md описывал несуществующее: колонки visibleAt нет (0 совпадений по packages/ и apps/), «один резидент — один активный код» не обеспечено (unique только code_hash и тривиальный (id, inviter_expert_id), expert-residency.ts:244-247), коды чеканятся батчем (expert_referral.batch_generate), а не при регистрации резидента. Многоразовость — открытый DEC-FIN-029.

## Файлы

**Прочитать:**

- [expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)
- [expert-referral-admin-repository.ts](../../../../packages/db/src/repositories/expert-referral-admin-repository.ts)


**Получить от зависимых задач (файлы ещё предстоит создать):**

Нет.


**Изменить:**

- [expert-residency.ts](../../../../packages/db/src/schema/expert-residency.ts)


**Создать:**

- [0040_expert_referral_visibility.sql](../../../../packages/db/migrations/0040_expert_referral_visibility.sql)
- [expert-referral-code-lifecycle.test.ts](../../../../tests/repo/expert-referral-code-lifecycle.test.ts)


**Проверки:**

- [expert-referral-code-lifecycle.test.ts](../../../../tests/repo/expert-referral-code-lifecycle.test.ts)


## Пункты задачи

- [ ] Отметка видимости кода по первой успешной оплате резидентуры (DEC-FIN-014 ①) реализована колонкой и гейтом display/API.
- [ ] Ограничение «не более одного кода в статусе issued на резидента» обеспечено схемой (partial unique) после решения DEC-FIN-029 о многоразовости.


## Шаги

- [ ] Миграцию выполнять вручную; проверять, что выдача батча не может создать второй активный код тому же резиденту.
- [ ] Не менять деривацию code_hash/key_version (это ключ идемпотентности).


## Критерии приёмки

- [ ] Тест: до первой успешной оплаты код не отдаётся в display/API, после — отдаётся.
- [ ] Тест: второй issued-код тому же inviter_expert_id отклоняется (при однократной семантике).


## Команды проверки

```bash
pnpm exec vitest run tests/repo/expert-referral-code-lifecycle.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] Миграции — только вручную (`drizzle-kit generate` запрещён AGENTS.md).
