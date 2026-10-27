# Requirements registry and release evidence

## Source preservation

- Document: `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`.
- Revision: `AHj4eMRbWH3C1FVWcHiOU3x1JVMdNJCl8tqqZXl9LvSiEItBCX3BgRfC_UxrUhtjcc7QhhZiw3V-gktQ4VTnGA`.
- Snapshot date:2026-10-12. All25 tabs retained; credential tab is explicitly redacted, not silently omitted.
- Local database: `.cache/requirements-2026-10-12/requirements.sqlite`.
- Private remote database: `/home/ii_tonya/requirements-registry/2026-10-12/requirements.sqlite`, mode0600; not in public webroot or client application database.
- Database SHA256: `9071870adc42272f192c6bb3247291f7fa1e09f5990be573b01eb5590c865ab2`, matched after transfer.
- Sanitized source JSON SHA256: `325608c3d0323c98104b3cf084eec100832c7a8c15752ecce3d6a08ac7eaeb29`.
- Tables: snapshots, tabs, findings, audit_reports, tab_resources, images.
- Source-to-database25/25 hash comparison and SQLite integrity check passed locally. Remote byte identity verified; no separate remote SQL execution claimed.
- Two embedded JPEGs are byte-identical: `40c8d11f49c7396b2a5e3a71ae5caaf36f8ad18f5664d3458ac794316e2dca4d`. Both show the purple/gold figure, not two different designs.

## Audit interpretation

224 overlapping audit points:77missing,53code_only,58conflict,21uncertain,2locally_verified,13live_verified. These are not224 independent stories. Code and test file citations are static evidence unless the report explicitly records a completed execution. The13 live points concern published static content, not functional commerce.

All51 conflict records retain source disagreement. Many are superseded by accepted decisions. Reconcile them before deriving the executable backlog. The complete sanitized source remains in the registry; the draft spec does not claim every raw source assertion is settled.

## Observed production

API and web revision: `43a93e2131cde6bb09a6825fc5b83dfbf91fc600`. API, worker and nginx active. Public root, account, demo and SOURCE_SHA returned200. Readiness reported PostgreSQL, migrations, worker lease and adapters ready.

Inventory:0experts,0expert_services,0slots. Payments, Selarti, Planerka, LLM, new reservations, client Telegram ingress, hybrid routing, Selarti response ingress and erasure requests disabled. Session, booking surface and privacy surface enabled. These facts do not establish working end-to-end journeys.

## Local candidate

Planerka REST transport commit `690797db64fd80aa1aeccea8003543de470d8c16`:58/58 focused tests passed, scoped typechecks/lint/format/whitespace checks passed and independent transport review closed. Not wired to the booking workflow and not deployed. Additional test-run permissions were consumed; no silent counter reset is allowed.

Client payment work on `codex/client-paid-policy-20261010` needs lineage review before integration. Production migration0041 must not receive an unreviewed0042. Selarti ports and adapters still lack production HTTP composition.

## Release boundary

No product deployment or production feature activation occurred in this audit. Only the private requirements database was added remotely. Keep the existing release until a scoped replacement has exact-revision verification and recovery evidence. A transport-only deployment cannot satisfy the final-product request.
