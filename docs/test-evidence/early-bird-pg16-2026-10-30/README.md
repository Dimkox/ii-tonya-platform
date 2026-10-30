# Early Bird PostgreSQL 16 compatibility — 30 October 2026

Production was inspected read-only: PostgreSQL 16.15, Node 24.19.0, release
`19ecb3456a647743f00584b14d097c2759f0d718`, with 76 migrations forming an exact
prefix of the candidate's 84. No production database or provider mutation was
performed by these probes. Mandatory PostgreSQL 17.5 state and role checks remain
separate evidence.

The retained source and JSON identify the actual downloaded old compiled runtime,
its archive/module hashes, new migration hash and synthetic probe. The probe ran
only in task container `early-bird-compat16-20261030`, PostgreSQL 16.15, isolated
`early_bird_release_compatibility` database. Credentials were resolved in memory
from that task container and never printed or committed.

Old API readiness and an actual worker cycle passed on the old schema. Migration
to 84 SQL entries passed on PostgreSQL 16.15. Unmodified old API startup correctly
rejected the longer history. The reviewed bridge's exact journal validator,
combined with the old API lifecycle and worker, passed against the new schema.
This is why a separately signed bridge must precede the business deployment.

The final business probe passed old tariff/checkout replay, verified settlement
and replay, restricted coverage helper access, denied wave-table access, negative
unqualified-card admission, booking search/reservation/duplicate/capacity, and
verified full refund/replay. Checkout and booking used the synthetic administrative
connection; settlement and refund used a limited synthetic role. Provider facts
were synthetic and checked by the actual old branded verifier. Positive qualified
publication, live YooKassa, production principals and target process isolation
were not established by this probe. Publication has separate PostgreSQL 17.5
integration evidence.

Attempts 1–2 failed before connecting because of fixture configuration/import
mistakes. Attempts 3–4 exposed incorrect fixture permissions, command shape,
expected duplicate result and class selection. The original three-run budget and
two owner-authorized additional failed-PostgreSQL invocations were consumed;
attempt 5 passed. Failed logs remain under the protected task directory. No sixth
attempt or exhausted test rerun is authorized by this evidence.

Independent read-only review checked source assertions and source/result hashes;
it confirmed the stated synthetic scope and limitations. These observations do
not replace exact-SHA CI, signed artifact assembly, target role audits, deployment
health or a resident-initiated real payment.

The executed probe source remains immutable in commit
`1164de8c0b52111b906560f8176918b4b4dc6a9c` and the original protected task file;
its digest is the `probeSha256` in the JSON result. The current text copy only
extracts two identical synthetic literals into local constants so the generic
secret scanner does not mistake fixture assignments for credentials. Independent
AST substitution review confirmed equivalent statements and values. That
refactored copy was not executed again; it is not a new test result.
