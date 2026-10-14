# S7 · Коммерческое ядро V2 и гибрид: A1 · A2 · A2.1 · B2 · B3

Milestone: [7](https://github.com/Dimkox/ii-tonya-platform/milestone/7) · Label: `stage:hybrid` · Статус: **В РАБОТЕ (PR #38 CONFLICTING)**

## Цель этапа

Единый диалог клиента и эксперта: A1 коммерческое ядро V2, A2/A2.1 созревание реферальных начислений, B2 сходимость ответов в одном диалоге, B3 cost admission для Selarti.

## Что вошло

- A1 commercial-core-v2 (traceability + spec)
- A2.1 expert-referral maturity: 30-дневная незаменяемость первых коммерческих settlements, lease-fenced, default-off
- B2: monotonic dialogue sequence → ordered telegram.send_text.v1 outbox; Selarti proposals untrusted, отдельный authenticated endpoint
- B3: SELARTI cost admission целочисленной арифметикой, cap = min(operator cap, 10% settled revenue за 30 дней)
- default-off hybrid test-expert foundation (PR #39)

## Документация-источник (main)

- [`docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/specs/2026-08-28-free-client-hybrid-platform-v2-design.md)
- [`docs/superpowers/plans/2026-08-28-commercial-core-v2-a1.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-28-commercial-core-v2-a1.md)
- [`docs/spec/commercial-core-v2-a1-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/commercial-core-v2-a1-traceability.md)
- [`docs/superpowers/implementation-artifacts/spec-commercial-core-v2-a1.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/implementation-artifacts/spec-commercial-core-v2-a1.md)
- [`docs/superpowers/plans/2026-08-29-expert-referral-maturity-a2.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-29-expert-referral-maturity-a2.md)
- [`docs/spec/expert-referral-maturity-a2-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/expert-referral-maturity-a2-traceability.md)
- [`docs/runbooks/expert-referral-maturity-a2-rollback.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/expert-referral-maturity-a2-rollback.md)
- [`docs/superpowers/plans/2026-08-29-hybrid-message-gateway-b.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/plans/2026-08-29-hybrid-message-gateway-b.md)
- [`docs/spec/hybrid-message-gateway-b2-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/hybrid-message-gateway-b2-traceability.md)
- [`docs/runbooks/hybrid-message-gateway-b2.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/hybrid-message-gateway-b2.md)
- [`docs/spec/hybrid-message-gateway-b3-traceability.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/spec/hybrid-message-gateway-b3-traceability.md)
- [`docs/runbooks/hybrid-message-gateway-b3.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/runbooks/hybrid-message-gateway-b3.md)
- [`docs/superpowers/architecture/hybrid-message-gateway-b/reviews/b3-review-closure.md`](https://github.com/Dimkox/ii-tonya-platform/blob/main/docs/superpowers/architecture/hybrid-message-gateway-b/reviews/b3-review-closure.md)

## PR этапа

[#38](https://github.com/Dimkox/ii-tonya-platform/pull/38) · [#39](https://github.com/Dimkox/ii-tonya-platform/pull/39)

## Гейты и ограничения

Dispatch, response ingress и sensitive retention независимо выключены. Live активация B2 требует официальный authenticated Selarti fixture + staging-доказательство реконсиляции unknown outcome. SELARTI_COST_ADMISSION_ENABLED=false.

**Статус этапа:** В РАБОТЕ (PR #38 CONFLICTING) · **Ключ этапа:** `S7` · **Label:** `stage:hybrid`

## Открытые вопросы этапа

[#54](https://github.com/Dimkox/ii-tonya-platform/issues/54) · [#57](https://github.com/Dimkox/ii-tonya-platform/issues/57)

## PR этапа

[#38](https://github.com/Dimkox/ii-tonya-platform/pull/38), [#39](https://github.com/Dimkox/ii-tonya-platform/pull/39), [#69](https://github.com/Dimkox/ii-tonya-platform/pull/69)

## Открытые issues этапа

[#57](https://github.com/Dimkox/ii-tonya-platform/issues/57)

← [все этапы](Stages.md) · [Home](Home.md)
