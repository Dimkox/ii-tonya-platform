# Словарь нумерации и идентификаторов

В проекте сосуществуют несколько схем, и имя «Task N» из имени ветки **не** равно пункту плана. Отсюда
путаница в объёме сделанного.

| Схема                  | Где живёт                                                                                                                                                                                  | Диапазон | Значение                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| Platform plan Tasks    | [`docs/superpowers/plans/2026-07-28-ii-tonya-platform.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-07-28-ii-tonya-platform.md)                   | 1–21     | план платформы целиком                                     |
| Expert residency Tasks | [`docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-03-expert-residency-referrals.md) | 1–12     | отдельный эпик (это же «task25» в именах веток)            |
| `MVP-FR-*`             | [`docs/spec/normalized-requirements.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/normalized-requirements.md)                                                       | 001–016  | нормализованные требования                                 |
| `WF-*`                 | там же                                                                                                                                                                                     | 01–08    | продуктовые workflow                                       |
| `ERR-FR-*`             | [`docs/spec/expert-residency-referrals-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-residency-referrals-traceability.md)                       | 001–042  | трассировка «требование → код → тест → команда CI»         |
| `AC-*`                 | acceptance-разметка планов                                                                                                                                                                 | 001–025  | приёмочные сценарии, AC-025 = цепочка MVP                  |
| `PRIV-*`               | threat model                                                                                                                                                                               | 01–05    | приватность                                                |
| `P1-*`                 | реестр дефектов плана                                                                                                                                                                      | 01–06    | известные дефекты плана                                    |
| `ER-TG-00N`            | ветки + планы 14.08                                                                                                                                                                        | 001–004  | экспертный Telegram-контур                                 |
| `ER-AI-00N`            | ветки + планы 14.08                                                                                                                                                                        | 001–003  | экспертный AI ingress/транспорты/receipts                  |
| `A1`, `A2`, `A2.1`     | plans 28–29.08                                                                                                                                                                             | —        | commercial core v2, реферальная зрелость                   |
| `B2`, `B3`             | [`docs/superpowers/plans/2026-08-29-hybrid-message-gateway-b.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-29-hybrid-message-gateway-b.md)     | —        | сходимость диалога, cost admission Selarti                 |
| `SBX-TST-009`          | sandbox payment plan                                                                                                                                                                       | —        | smoke checkout→refund на собранном контейнере, не исполнен |
| `codex/taskNN-*`       | имена веток                                                                                                                                                                                | до 25    | номера задачи в трекере, не пункты плана                   |

Ловушки, зафиксированные при разборе:

1. Ветки `task10-fix1…fix4`, `task11-fix2/3-metrics`, `task12-*` — промежуточные чекпоинты эпика
   Tasks 1–12, их дерево совпадает с запушенным `codex/task25-expert-referral-design`.
2. Задач с номерами 13–16 и 18–24 в `docs/` нет: это нумерация трекера.
3. `ER-AI-*` и `ER-TG-*` в старых ветках встречаются только как имена веток, а как идентификаторы
   требований — только на main.
4. Единая привязка «этап →milestone→ PR → issue» заведена сейчас: [Этапы](Stages.md) и
   [https://github.com/Dimkox/ii-tonya-platform/issues/62](https://github.com/Dimkox/ii-tonya-platform/issues/62).

← [Home](Home.md)
