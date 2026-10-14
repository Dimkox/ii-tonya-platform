# S2 · Экспертная резидентура и рефералы (Tasks 1–12)

Milestone: [2](https://github.com/Dimkox/ii-tonya-platform/milestone/2) · Label: `stage:expert-residency` · Статус: **ЗАВЕРШЁН как disabled candidate; остаток — перенос линейки на актуальный main (см. issue «rebase task25»)**

## Цель этапа

Реализовать коммерческое ядро эксперта: схема резидентуры и рефералов, доменные правила, quote/reservation, settlement/refund/reversal, audit scope, hold-replay, телеметрия, admin-workflow, release gates — как disabled release candidate.

## Что вошло

- 25 SQL-миграций, 54 таблицы, точный parity journal↔files↔pgTable
- packages/domain: 572 строки чистых правил + 2 fast-check property-сюита
- 19 Postgres-репозиториев (10.7k строк SQL), миграционные upgrade-тесты
- Provider-neutral settlement с trust-boundary: только requireVerifiedExpertResidencyPaymentEvent
- 42 строки трассировки ERR-FR-0NN и 3-кратные concurrency-гейты в DB Gate

## Документация-источник (main)

- [`docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md)
- [`docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-03-expert-residency-referrals.md)
- [`docs/spec/expert-residency-referrals-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-residency-referrals-traceability.md)
- [`docs/security/expert-residency-referrals-go-live-gates.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/security/expert-residency-referrals-go-live-gates.md)
- [`docs/runbooks/expert-residency-referrals.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/expert-residency-referrals.md)
- [`docs/runbooks/expert-residency-referrals-rollback.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/expert-residency-referrals-rollback.md)
- [`docs/agents/expert-residency-team.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/agents/expert-residency-team.md)
- [`docs/handoffs/2026-08-11-expert-residency-referrals-full.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/handoffs/2026-08-11-expert-residency-referrals-full.md)

## PR этапа

[#3](https://github.com/Dimkox/ii-tonya-platform/pull/3) · [#4](https://github.com/Dimkox/ii-tonya-platform/pull/4) · [#5](https://github.com/Dimkox/ii-tonya-platform/pull/5) · [#7](https://github.com/Dimkox/ii-tonya-platform/pull/7) · [#8](https://github.com/Dimkox/ii-tonya-platform/pull/8) · [#9](https://github.com/Dimkox/ii-tonya-platform/pull/9) · [#43](https://github.com/Dimkox/ii-tonya-platform/pull/43) · [#44](https://github.com/Dimkox/ii-tonya-platform/pull/44)

## Гейты и ограничения

Матрица трассировки помечена «disabled release candidate … It is not activation evidence»; 7 внешних гейтов PENDING/BLOCKING. Активация требует EXPERT_REFERRAL_ENABLED + HMAC-ключи.

**Статус этапа:** ЗАВЕРШЁН как disabled candidate; остаток — перенос линейки на актуальный main (см. issue «rebase task25») · **Ключ этапа:** `S2` · **Label:** `stage:expert-residency`

## Открытые вопросы этапа

[#52](https://github.com/Dimkox/ii-tonya-platform/issues/52) · [#60](https://github.com/Dimkox/ii-tonya-platform/issues/60)

## PR этапа

[#3](https://github.com/Dimkox/ii-tonya-platform/pull/3), [#4](https://github.com/Dimkox/ii-tonya-platform/pull/4), [#5](https://github.com/Dimkox/ii-tonya-platform/pull/5), [#7](https://github.com/Dimkox/ii-tonya-platform/pull/7), [#8](https://github.com/Dimkox/ii-tonya-platform/pull/8), [#9](https://github.com/Dimkox/ii-tonya-platform/pull/9), [#43](https://github.com/Dimkox/ii-tonya-platform/pull/43), [#44](https://github.com/Dimkox/ii-tonya-platform/pull/44), [#64](https://github.com/Dimkox/ii-tonya-platform/pull/64)

## Открытые issues этапа

[#52](https://github.com/Dimkox/ii-tonya-platform/issues/52), [#73](https://github.com/Dimkox/ii-tonya-platform/issues/73)

← [все этапы](Stages.md) · [Home](Home.md)
