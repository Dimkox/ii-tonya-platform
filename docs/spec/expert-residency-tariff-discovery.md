# ER-TG-004 Expert Residency Tariff Discovery Traceability

Status: implementation candidate. Focused local tests are green; independent review and
the single exact-SHA Claw gate are pending. The feature remains disabled by default.
This document does not authorize staging, production, a live Telegram transport, or a
payment provider.

Source design:
`docs/superpowers/specs/2026-08-14-expert-residency-tariff-discovery-design.md`.

| Requirement | Implementation | Focused verification | Release evidence | Recovery / rollback | Owner |
| --- | --- | --- | --- | --- | --- |
| ER-TG-004-R1 | `PostgresExpertResidencyRepository.listActiveTariffs` | repository unit and real-PostgreSQL current-window/order/limit tests | exact-SHA focused Claw gate pending | keep residency billing disabled; repair authoritative tariff rows through the existing admin path | DB owner |
| ER-TG-004-R2 | `ExpertResidencyService.listActiveTariffs`; repository eligibility query; HTTP/Telegram principal resolvers | application ownership, HTTP authentication, Telegram private-channel, and PostgreSQL inactive-expert tests | exact-SHA focused Claw gate pending | revoke the expert session or disable the residency/Telegram capability | Security + Operations |
| ER-TG-004-R3 | `ResidencyTariff`; HTTP response; `ExpertResidencyTariffsView` | exact response/view-shape and renderer rejection tests | exact-SHA focused Claw gate pending | remove the discovery composition; no client financial facts are accepted or stored | Finance reviewer |
| ER-TG-004-R4 | authenticated `GET /v1/expert/residency/tariffs`; private exact `/residency`; bounded renderer | route, command-processor, empty-list, deterministic-order, and 4,096-character tests | exact-SHA focused Claw gate pending | disable expert residency billing or Telegram financial views | Operations |
| ER-TG-004-R5 | existing `/residency <UUID>` default command path is unchanged | existing UUID quote compatibility test plus focused command tests | exact-SHA focused Claw gate pending | revert discovery-only code; do not modify callback or checkout state | Operations |
| ER-TG-004-R6 | existing residency and Telegram feature gates; capability-injected ingress factory | disabled-view/no-query tests and existing app/server fail-closed tests | exact-SHA focused Claw gate pending | retain default-false flags and omit the optional ingress capability | Operations |

## Evidence boundary

Local Node 26 focused evidence is diagnostic, not a release gate:

- application and repository: 2 files, 19 tests passed;
- authenticated HTTP route: 1 file, 9 tests passed;
- Telegram processor and adapter: 2 files, 47 tests passed.

The real-PostgreSQL integration file is intentionally reserved for the one final Claw
run. No GitHub Actions, live Telegram, provider call, checkout mutation, production
operation, image build, or image prune is part of ER-TG-004.

## Telemetry and data boundary

Discovery returns only server-issued tariff UUID, display name, minor-unit RUB price,
and duration. It adds no secret, provider identifier, payment URL, client financial
field, or high-cardinality logging. An empty active set is a successful bounded result.
Authorization or repository failure returns an existing bounded closed outcome.
