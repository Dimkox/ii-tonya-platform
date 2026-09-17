---
title: "Client commercial-policy cohorts (DEC-FIN-001)"
type: "policy"
created: "2026-09-17"
status: "approved"
decision: "DEC-FIN-001"
variant: "B"
task: "TASK-FIN-001"
baseline_commit: "cb07bd1"
live_activation: false
---

# Клиентские когорты доступа — DEC-FIN-001 вариант B

Контракт назначения policy version и отката. Не включает SKU, цены, срок пакета и
тарифы: это `TASK-FIN-002` / `DEC-FIN-002` / `DEC-FIN-003` / `TASK-FIN-021`.
Live-активация не объявлена. `PAYMENTS_ENABLED` и внешние флаги остаются default-off.

## Решение

Принято 2026-09-17, product-owner, DEC-FIN-001 **вариант B**:

- новым клиентам назначается **новая versioned платная package-политика**, не
  `free_client_v2`;
- `legacy_package_v1` остаётся **только** у уже назначенных исторических;
- когорта **не переприсваивается молча** (строка `client_commercial_policy_assignments`
  неизменяема после insert);
- вариант C (кампания миграции существующих когорт) **отложен** — отдельный вердикт
  по выборке и обратимому контракту, не часть этого документа.

## Когорты

Каждая когорта имеет ровно одну `policy_version`. Новая строка получает значение
один раз; `UPDATE`/`DELETE` assignment запрещены прикладным контрактом (сейчас это
обеспечивает `INSERT … ON CONFLICT DO NOTHING` и отсутствие update-path).

| Когорта | `policy_version` | Кто в ней | Как попадает | Как выходит |
|---|---|---|---|---|
| Исторический пакет | `legacy_package_v1` | Уже назначенные; также **текущий** default для *нового* user_id, пока FIN-021 не ввёл платную версию в CHECK | Insert при первом `resolveOrAssign` с `allowV2Admission=false`, либо backfill миграции `0032` | Только явная кампания C (отложена). Rollback admission не трогает строку |
| Бесплатный V2 | `free_client_v2` | Только те, кому уже записали эту версию, пока admission V2 был включён | Исторический insert при `CLIENT_FREE_ACCESS_V2_ENABLED=true` **и** control `admission_policy=free_client_v2` | Не переназначается. Закрытие admission не конвертирует в legacy и не отбирает free-доступ |
| Целевая платная | *идентификатор SQL выдаёт TASK-FIN-021* (ещё нет в CHECK `0032`) | Новые клиенты **после** аддитивной миграции и отдельного admission control | Только новый control/flag, не `free_client_v2` | Не переписывает legacy/V2 строки. Rollback = выключить admission; уже записанные paid-строки остаются |

Идентификатор третьей когорты **не выдуман здесь**: CHECK
`client_commercial_policy_assignment_policy` сегодня допускает только
`legacy_package_v1` и `free_client_v2`. Расширение множества — аддитивная миграция
FIN-021, без rewrite существующих assignment.

## Admission сегодня (runtime на `cb07bd1`)

1. `CLIENT_FREE_ACCESS_V2_ENABLED` default `false` (`packages/config/src/env.ts`).
2. `conversation-service` передаёт `allowV2Admission: clientFreeAccessV2Enabled === true`.
3. При `allowV2Admission=false` новый user_id получает `legacy_package_v1`.
4. При `true` новый user_id получает `free_client_v2` **только если** control
   `client_access` (object `00000000-0000-0000-0000-000000000041`) согласован с
   audited `client_commercial_policy.control_v2` и `admission_policy=free_client_v2`.
   Иначе снова `legacy_package_v1`.
5. Повторный `resolveOrAssign` возвращает уже записанную версию без выбора.

Следствие DEC-FIN-001: **новое** включение `CLIENT_FREE_ACCESS_V2_ENABLED` для
набора `free_client_v2` **запрещено**. Флаг остаётся `false`, пока FIN-021 не
заменит admission на платную версию. Уже существующие `free_client_v2` строки
grandfathered.

## Новые клиенты vs исторические

- **Исторические** = есть строка в `client_commercial_policy_assignments` на момент
  принятия DEC-FIN-001, либо будут назначены `legacy_package_v1` текущим default-off
  путём до миграции FIN-021. Их policy_version не меняется этим контрактом.
- **Новые после FIN-021** = нет assignment на момент первого resolve после
  публикации новой policy version. Им пишется только платная версия.
- Массовый `UPDATE policy_version` запрещён. Вариант C не активирован.

## Rollback (безопасно, без переприсвоения)

Опирается на существующий runbook
[`commercial-core-v2-a1-rollback.md`](../../runbooks/commercial-core-v2-a1-rollback.md)
и дополняет его правилом DEC-FIN-001:

1. Не писать `admissionPolicy: "free_client_v2"` в новые
   `client_commercial_policy.control_v2`.
2. Оставить `CLIENT_FREE_ACCESS_V2_ENABLED=false`.
3. Для отката *будущего* paid-admission (после FIN-021): выключить соответствующий
   control той же audited-командой на `legacy_package_v1` **или** на явную
   «стоп-версию», которая не создаёт новых paid-строк. Уже записанные
   `legacy_package_v1` / `free_client_v2` / paid-строки не UPDATE.
4. Не удалять assignment, execution results, audit. Не reopen исторических control
   version.
5. Возврат к `free_client_v2` для *новых* клиентов требует нового DEC, не rollback.

Проверка отката: `select policy_version, count(*) from client_commercial_policy_assignments
group by 1` до и после control-команды совпадает по составу когорт; меняется только
control version.

## Вопросы этой карточки

- **Q-016** (бесплатный пакет без срока vs платная модель): закрыт вариантом B.
  Новые клиенты не получают бессрочный `free_client_v2`. Intro 100 сообщений — SKU
  `DEC-FIN-002`, не когорта.
- **Q-169** (момент старта пакета и TZ): **не закрыт здесь**. Это часы `expiresAt`
  в `TASK-FIN-002`. Runtime `DISPLAY_TIMEZONE=Europe/Moscow` не считается решением
  Q-169.

## Не в этом контракте

Цены пакетов, 60 дней, intro 100, x2-начисление, купонный cap, миграция CHECK,
включение `PAYMENTS_ENABLED`. Пока их нет, третья когорта не материализуется в SQL.

## Приёмка REQ-FIN-001.01

- Назначение новых: платная versioned policy после FIN-021; до неё default-off путь
  пишет только `legacy_package_v1`, никогда новый `free_client_v2`.
- Назначение существующих: без молчаливого rewrite; `free_client_v2` и
  `legacy_package_v1` grandfathered.
- Откат: выключение admission, строки не переприсваиваются.
