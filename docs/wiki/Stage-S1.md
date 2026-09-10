# S1 · Фундамент: исходник, требования, архитектура, threat model

Milestone: [1](https://github.com/Dimkox/ii-tonya-platform/milestone/1) · Label: `stage:foundation` · Статус: **ЗАВЕРШЁН**

## Цель этапа

Превратить неструктурированный продуктовый исходник (4470 строк, 11 блоков, 0 импортируемых Make-blueprint) в нормализованные требования, архитектуру, threat model и исполняемый план Tasks 1–21.

## Что вошло

- Авторитетный snapshot с подтверждённым SHA-256 и границами блоков
- Нормализованные требования MVP-FR-001…016, WF-01…08, 16 сущностей
- Threat model и §17 «Non-waivable NO-GO conditions»
- Аудит live-интеграций: Selarti/Planerka/Telegram/Make/Sheets = BLOCKED
- Первая сборка платформы (squash Tasks 1–17) и remediation image-vulnerability гейта

## Документация-источник (main)

- [`docs/source/ii-tonya-expert-full-source-2026-07-28.txt`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/source/ii-tonya-expert-full-source-2026-07-28.txt)
- [`docs/spec/normalized-requirements.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/normalized-requirements.md)
- [`docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-07-28-ii-tonya-platform-design.md)
- [`docs/superpowers/plans/2026-07-28-ii-tonya-platform.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-07-28-ii-tonya-platform.md)
- [`docs/security/threat-model-and-go-live-gates.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/security/threat-model-and-go-live-gates.md)
- [`docs/integrations/live-readiness.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/integrations/live-readiness.md)

## PR этапа

[#1](https://github.com/Dimkox/ii-tonya-platform/pull/1) · [#2](https://github.com/Dimkox/ii-tonya-platform/pull/2)

## Гейты и ограничения

Гейтов релиза не вводило. Итог этапа: продуктовое намерение отделено от исполняемой конфигурации; платежи, купоны, referrals, waitlist, reschedule, проактивность отложены.

**Статус этапа:** ЗАВЕРШЁН · **Ключ этапа:** `S1` · **Label:** `stage:foundation`

## PR этапа

[#1](https://github.com/Dimkox/ii-tonya-platform/pull/1), [#2](https://github.com/Dimkox/ii-tonya-platform/pull/2)

## Открытые issues этапа

—

← [все этапы](Stages.md) · [Home](Home.md)
