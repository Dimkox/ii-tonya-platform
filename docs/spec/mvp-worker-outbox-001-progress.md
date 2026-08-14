# MVP-WORKER-OUTBOX-001 progress ledger

## Identity

- Branch: `codex/mvp-worker-outbox-001`
- Specification base: `0bfb6efc4b2145dfc5f4ba4763fa6264f422f842`
- Canonical spec: `_bmad-output/specs/spec-mvp-worker-outbox-001/SPEC.md`
- Architecture:
  `docs/superpowers/architecture/mvp-worker-outbox-001/ARCHITECTURE-SPINE.md`
- Plan: `docs/superpowers/plans/2026-08-14-mvp-worker-outbox-001.md`
- Traceability: `docs/spec/mvp-worker-outbox-001-traceability.md`

## Story ledger

| Work item | Status | Owner | Verification responsibility | Evidence |
| --- | --- | --- | --- | --- |
| Requirements and exact handler contract | complete | specification author | implementation owner must preserve R1-R13 | BMAD spec + companion |
| Architecture decision | complete | specification author | independent reviewer checks single ownership and provider isolation | feature architecture spine |
| Task 1 config/composition | pending | implementation owner | config/app-worker focused tests | none |
| Task 2 registry/decoders | pending | implementation owner | unit + scope tests | none |
| Task 3 allowlisted outbox repository | pending | implementation owner | repository + real-PG mixed-topic tests | none |
| Task 4 local case mutation/reconciliation | pending | implementation owner | real-PG concurrency/crash tests | none |
| Task 5 runtime/metrics | pending | implementation owner | runtime + bounded telemetry tests | none |
| Independent code review | pending | reviewer distinct from implementer | no open Critical/Important at exact HEAD | none |
| Final focused Claw gate | pending | implementation owner | one run only after GREEN/review; cleanup recorded | none |
| Deployment approval | blocked outside story | human owner | explicit target authorization and release evidence | none |

## Decisions and boundaries

- Enabled generic mode replaces rather than competes with legacy local
  materialization.
- Only `safety.operator_escalation` and `admin.negative_feedback` are eligible.
- The feedback table, not payload metadata, authorizes feedback case values.
- Structural poison and unrecoverable local state are terminal typed outcomes.
- No migration is planned; existing fenced outbox and migration `0028` suffice.
- Provider topics, credentials, transports, production and live telemetry export
  remain outside the story.

## Progress history

- 2026-08-14: exact merged base inspected; docs-only specification, architecture,
  implementation plan and traceability frozen. No production code or tests run.
