# TASK-PLT-023: Гейт времени показа meeting_url эксперту (§4 «не ранее 30 минут»)

> For agentic workers: исполнять по superpowers:subagent-driven-development или superpowers:executing-plans после закрытия зависимостей.

**Goal:** Временной гейт на обоих путях показа ссылки (SQL и рендер сообщения): до порога ссылка не раскрывается.

**Architecture:** Следовать существующим границам пакетов на SHA `18af66fef61c33d21216c3b24f935cb1fe3d7b2d` и [контракту исполнения](../execution-contract.md).

**Tech Stack:** TypeScript, Node 24, pnpm 11.9.0, PostgreSQL; для design/content — форматы из критериев задачи.

**Spec:** [SPEC.md](../SPEC.md), [requirements.md](../requirements.md).

## Статус и область

- State: `implemented_pending_review`; readiness: `ready`.
- Тип: implementation; исполнитель: backend; приоритет: P1.
- Depends on: .
- Решения: `DEC-PLT-004`.
- Носитель: найдено независимым review read-path PR #97 (2026-09-21); interim-правило `DEC-PLT-004`.
- Статус live: ничего не включается; внешние флаги остаются `false`.

## Что уже есть

§4 действующего правила требует отдавать ссылку не ранее 30 минут до встречи. Read-path гейтит только статус: `booking-repository.ts:588-590` `when r.status = 'booked' then r.meeting_url`, `telegram-adapter.ts:471-477` рендерит `Встреча: <url>` в сообщение расписания. Замер review PR #97 (случай без согласий, встреча через ~24 часа): `meetingUrl` возвращается (проверено 2026-09-21).

## Файлы

**Прочитать:**

- [booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [telegram-adapter.ts](../../../../packages/integrations/src/telegram/telegram-adapter.ts)
- [go-live-evidence.md](../../../../docs/runbooks/go-live-evidence.md)


**Изменить:**

- [booking-repository.ts](../../../../packages/db/src/repositories/booking-repository.ts)
- [telegram-adapter.ts](../../../../packages/integrations/src/telegram/telegram-adapter.ts)


**Создать:**

- [meeting-url-timing-gate.test.ts](../../../../tests/repo/meeting-url-timing-gate.test.ts)


**Проверки:**

- [meeting-url-timing-gate.test.ts](../../../../tests/repo/meeting-url-timing-gate.test.ts)


## Пункты задачи

- [ ] Временной гейт на обоих путях показа ссылки (SQL и рендер сообщения): до порога ссылка не раскрывается.
- [ ] Порог — число из схемы env с fail-closed default: отсутствие конфигурации = не показывать.


## Шаги

- [ ] Не менять состав §3 (минимальный handoff включает meeting_url) — ужесточение только по времени.
- [ ] Контроль обязан перевернуться: за 40 минут ссылки нет, за 10 минут — есть.


## Критерии приёмки

- [ ] Ссылка не попадает в expert schedule message и в schedule-запись ранее порога (тест).
- [ ] При `starts_at` в прошлом или неопределённом — отказ по умолчанию (fail-closed).


## Исполнено (2026-09-21, ветка codex/fin-001)

- [x] SQL-гейт в `booking-repository.ts`: `s.starts_at - ${MEETING_URL_DISCLOSURE_LEAD_MS} * interval '1 millisecond' <= clock_timestamp()`
  при `status='booked'`; константа `30 * 60 * 1_000` рядом с `MINIMUM_LEAD_MS`.
- [x] Адаптер Telegram не изменён: печать `Встреча:` уже условна на присутствие поля
  (`telegram-adapter.ts:473-476`), а маппинг репозитория опускает `null` (`booking-repository.ts:681-682`) — проверено чтением кода.
- [x] Таблица истинности выражения на `postgres:16-alpine`: `+2h → false`, `+30min → true`,
  `+10min → true`, `-1h → true`.
- [x] Интеграционный кейс в обе стороны: встреча через 2 часа — свойства `meetingUrl` нет;
  через 10 минут — ссылка есть; затем `starts_at` возвращается к исходному.
  Контроль: при удалении условия тест падает с «to not have property "meetingUrl"» (замерено).
- [ ] Независимый review этого гейта.

## Команды проверки

```bash
pnpm exec vitest run tests/repo/meeting-url-timing-gate.test.ts
```


## Evidence и завершение

- [ ] Результаты проверок сохранены с точным коммитом.
- [ ] Независимый review пройден; live-активация не объявляется.
- [ ] Контрольный случай, доказывающий переключение гейта, обязан дать противоположный вердикт.
