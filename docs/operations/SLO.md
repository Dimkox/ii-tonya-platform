# ии-Тоня Service Level Objectives

## Current scope

ии-Тоня is pre-production. These objectives cover engineering evidence and data
safety; they do not claim production availability.

| Indicator                                              |     Objective |                     Window |
| ------------------------------------------------------ | ------------: | -------------------------: |
| Required governance check                              |  100% passing |      every reviewed commit |
| Unit and contract tests                                |  100% passing |      every reviewed commit |
| PostgreSQL integration tests                           |  100% passing |      every reviewed commit |
| Immutable artifact checksum and detached signature     | 100% verified | every default-branch build |
| Secret or personal-data disclosure in CI evidence      |      0 values |                 continuous |
| Unauthorized production messages, payments or bookings |  0 operations |                 continuous |

## Error-budget response

- A failed required check blocks merge.
- A contract, booking, billing, consent, safety or audit regression consumes the
  engineering error budget and blocks rollout.
- Any credential or personal-data disclosure blocks further artifact
  publication until the material is removed and the credential owner has
  completed the separately authorized response.
- A missing external integration is recorded as a blocked capability, not a
  successful end-to-end result.

## Telemetry

- GitHub Actions job status and retained, sanitized evidence.
- Vitest output for unit, PostgreSQL integration and contract suites.
- SHA-addressed artifacts, checksums and detached ECDSA signatures.

## Production activation

Before accepting live traffic, define measured availability and latency
objectives for the executable API and workers, staging health/readiness probes,
alert ownership and a tested production rollback procedure.
