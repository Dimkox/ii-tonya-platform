# TASK-PLT-021: Канал подписи и исключающий спецданные режим Telegram

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** docs/operations/detailed-mode-channel-boundary.md: границы канала по DEC-PLT-013 (что допустимо в Telegram, что только в веб-контуре).

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `planned`; readiness: `blocked_by_decision`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: `TASK-DEC-PLT-013`, `TASK-PLT-019`.
- Решения: `DEC-PLT-013`.
- Вопросы: нет.
- Статус live: ничего не включено и не активировано; внешние флаги остаются `false`, опубликованные тексты не меняются (DEC-PLT-007).

## Что уже есть

ТЗ предпочитает защищённую веб-страницу каналом подписи и отдаёт участие Telegram на аудит; правило DEC-PLT-004 §4 запрещает тексты о здоровье даже в служебных чатах; Telegram сейчас транспорт, webhook/HMAC/admin chat id отсутствуют.

## Файлы

**Прочитать:**

- [env.ts](../../../../packages/config/src/env.ts)
- [owner-update-data-matrix.md](../../../../docs/operations/owner-update-data-matrix.md)


**Получить от зависимых задач (файлы ещё предстоит создать):**

- `_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-013-rule.md` (от `TASK-DEC-PLT-013`)
- `packages/db/migrations/0040_consent_evidence.sql` (от `TASK-PLT-019`)
- `docs/security/detailed-mode-signature.md` (от `TASK-PLT-019`)
- `tests/repo/consent-evidence.test.ts` (от `TASK-PLT-019`)


**Изменить:**

- [env.ts](../../../../packages/config/src/env.ts)


**Создать:**

- [detailed-mode-channel-boundary.md](../../../../docs/operations/detailed-mode-channel-boundary.md)


**Проверки:**

Нет.


## Пункты задачи

- [ ] docs/operations/detailed-mode-channel-boundary.md: границы канала по DEC-PLT-013 (что допустимо в Telegram, что только в веб-контуре).
- [ ] Конфигурационный гейт в packages/config/src/env.ts, запрещающий спецданные в Telegram-пути до решения DEC-PLT-013.
- [ ] Ревизия §4 правила и матрицы обработителей при допуске Telegram (отдельная запись владельца).


## Шаги

- [ ] Не начинать до принятия DEC-PLT-013.
- [ ] Паспортные реквизиты и содержимое подробного разговора в чат не отправляются — проверить текстами интерфейса и кодом.
- [ ] Отказ от подробного режима не закрывает каталог: проверить UX-путь.


## Критерии приёмки

- [ ] Матрица обработителей и код канала не противоречат друг другу (проверяемый тест/скрипт).
- [ ] Ни один путь Telegram не может донести спецданные до персиста или внешнего ИИ при закрытом DEC-PLT-013.
- [ ] Копия не давит на клиента и не обещает несуществующего (проверка copy-guard).


## Команды проверки

```bash
python3 _bmad-output/specs/spec-owner-update-2026-09-16/validate_backlog.py --repo-root .
```


## Evidence и завершение

- [ ] Результаты проверок сохранены под `docs/test-evidence/` с точным коммитом и датой прогона.
- [ ] Независимый review пройден; live-активация по локальному тесту не объявляется.
- [ ] interim-правило `DEC-PLT-004` (§1–§9) соблюдается: спецданные и ПД третьих лиц не персистятся и не передаются, подробный режим закрыт.
