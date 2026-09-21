# TASK-PLT-019: Письменное согласие с ЭП: подписание, идентификация, хранилище доказательств

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Миграция packages/db/migrations/0040_consent_evidence.sql: хранилище доказательств подписания (версия документа, штамп времени, результат проверки).

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `pending_dependencies`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-DEC-PLT-011`, `TASK-PLT-017`.
- Решения: `DEC-PLT-011`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

Компонентов нет ни в коде, ни в backlog (проверено 2026-09-21): нет подписания, identity-proofing, evidence-хранилища и портов с реализацией; режим закрыт флагами.

## Файлы

**Прочитать:**

- [consent.ts](../../../../packages/domain/src/consent.ts)
- [privacy-repository.ts](../../../../packages/db/src/repositories/privacy-repository.ts)
- [server.ts](../../../../apps/api/src/server.ts)
- [go-live-evidence.md](../../../../docs/runbooks/go-live-evidence.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-011-rule.md` (от `TASK-DEC-PLT-011`)
- `packages/db/migrations/0039_consent_grant_audit.sql` (от `TASK-PLT-017`)
- `tests/repo/consent-grant.test.ts` (от `TASK-PLT-017`)


**Изменить:**

- [consent.ts](../../../../packages/domain/src/consent.ts)
- [privacy-repository.ts](../../../../packages/db/src/repositories/privacy-repository.ts)
- [server.ts](../../../../apps/api/src/server.ts)


**Создать:**

- [0040_consent_evidence.sql](../../../../packages/db/migrations/0040_consent_evidence.sql)
- [detailed-mode-signature.md](../../../../docs/security/detailed-mode-signature.md)
- [consent-evidence.test.ts](../../../../tests/repo/consent-evidence.test.ts)


**Проверки:**

- [consent-evidence.test.ts](../../../../tests/repo/consent-evidence.test.ts)


## Пункты задачи

- [ ] Миграция packages/db/migrations/0040_consent_evidence.sql: хранилище доказательств подписания (версия документа, штамп времени, результат проверки).
- [ ] docs/security/detailed-mode-signature.md: способ подписи и идентификации по DEC-PLT-011 с границами и отказными случаями.
- [ ] Тесты tests/repo/consent-evidence.test.ts на отрицательные сценарии.


## Шаги

- [ ] Начинать только после принятия DEC-PLT-011 и закрытия TASK-PLT-017 (grant — общий путь записи).
- [ ] Подробный режим держать закрытым default-off флагом до приёмки всех условий CAP-3.
- [ ] Не персистить спецданные до TASK-PLT-020 (класс УЗ и РФ-регион).


## Критерии приёмки

- [ ] Отрицательные сценарии (сбой подписи, повторные нажатия, отзыв, просроченная версия документа) оставляют режим закрытым.
- [ ] Одной кнопки недостаточно в коде, а не только в тексте: гейт проверяет подпись, личность, объём и действительность.
- [ ] interim-правило DEC-PLT-004 не нарушается ни в одном тестовом прогоне.


## Команды проверки

```bash
pnpm install --frozen-lockfile && pnpm exec vitest run tests/repo/consent-evidence.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] interim-правило `DEC-PLT-004` (§1–§9) соблюдается: спецданные и ПД третьих лиц не персистятся и не передаются, подробный режим закрыт.
