# Content-free telemetry RC — production evidence, 2026-10-05

## Released identity

Product source: `2db008f7d25cfcaef134afbd9d8de4d6e975c8b7`.
Canonical remote: https://github.com/Dimkox/ii-tonya-platform.git.
RC branch readback: `rc/client-consent-factory` at that exact SHA.
Separate production host: `ii-tonya.ru`, `157.22.187.237`,
`/opt/ii-tonya-platform`. Owner explicitly authorized publication in this conversation.

API, worker and web were deployed by approximately 05:00 UTC. Independent readback
confirmed native SOURCE_SHA and web-current at the source above, each of API,
worker and Nginx active, and readiness200 with PostgreSQL, migrations, workerLease
and adapters passing. Previous native/web `cab25eef3d7abd8591c2a49c3605a14acdc76585`
remains available for recovery. No live rollback was performed.

This is a release candidate, **not completion of the full commercial product**.
Telegram navigation, sessions and privacy routes remain enabled; widget login,
personal ingress, AI/provider dispatch, payments and erasure activation remain off.
Migrations are byte-for-byte unchanged. No expert, service, slot or customer fact
was invented or seeded.

## Source, verification and artifacts

Three independent review layers plus bounded closure closed eleven accepted
findings and one further Fastify status-precedence regression. The detailed
RED/GREEN ledger is in [the operations record](../../operations/content-free-telemetry.md).
The private Fastify status-selection symbol is tied to the pinned installed version;
source and compiled resolution plus differential sync/async behavior were checked.

Main separately observed logger20, tracing12, composed leakage27, executable
bootstrap2 and API36 passing, relevant four-package typechecks, tests typecheck
and whitespace checks. The normal exact-commit pre-push gate passed repository
tests, formatting, evidence integrity, script syntax and changed-file lint.
There was no bypass, force-push, new hosted workflow, repeated aggregate or PG run.
The earlier interrupted aggregate remains a failure, not a full-suite PASS.

Native and web bundles were freshly built with the committed dependency graph.
Both identify source archive SHA256
`eab6192f6a3f083a01d7121b29afe7e0106884f83cb9e36f4447f9de988623fe`.
Native packaged API and worker imports passed under Node --jitless from an
isolated extracted archive, without bootstrap, database or provider calls.

Both checksum manifests were signed and their signatures verified; every listed
file checksum passed. Manifest SHA256 values:

- Native: `9fa6195d95ed78afa444cbf88fb394751349bc383bfa7195ff0a9d32dfca7331`.
- Web: `fb5693ee7156ad02b6090c462bd52cb8f0b31cadfeaff982fbd94818057bdcdc`.

Bundles, SBOM, signatures, operational helpers and screenshots are retained in
the ignored local directory `.native-release/client-web-2db008f7d25cfcaef134afbd9d8de4d6e975c8b7/`.
No credential/runtime file or secret webhook backup is part of this report.

GitHub check-runs for this SHA were empty. Factory PR245 remained the latest
merged PR at the 04:10 UTC recheck. The previously documented Trust CI enrollment
gap is unresolved: local checks and artifact signatures are not independent
factory Trust CI/Database Gate attestations. Story status therefore stays in-review.

## Direct live checks

Real Chrome used direct HTTPS with system proxies disabled and TLS verification
enabled; no tunnel or certificate bypass:

- Catalog/account/consent/my-data routes returned200 and expected UI.
- Correct bot username, anonymous available session, widget and erasure off.
- Private consents401; forged Mini App proof401; oversized proof413.
- Public catalog200, correct projection and no-store/no-referrer; zero entries.
- JavaScript errors0, external requests0, browser storage empty; mobile390px no overflow.
- Additional unknown-path canary returned404; malformed session JSON400; private
  request401. Error responses did not reflect the canary. No real account was created.

These are browser/HTTP and synthetic recorder checks, not inspection of every
production log/APM/support/backup sink. Real-user Telegram login remains unobserved.

A read-only production transaction at 05:00:14 UTC confirmed zero experts,
services, future slots and client-bot navigation receipts. Telegram webhook URL/IP
still match the host, pending queue0, and its stored connection-timeout timestamp
remains 03:20:01 UTC. Registration is not command-delivery evidence. The owner was
asked for a real Telegram launch and an approved source of catalog data.

## Deployment and recovery limits

The shared host release lock, exact previous/candidate pins, protected backups
and artifact hashes were retained. Three connection-refused retries during service
restart recovered before readiness passed; this was not a zero-downtime rollout.
The transient check-unit reset reported already-unloaded state; independent checks
confirmed both incoming staging directories and the temporary systemd unit absent.

The previous release is retained, but rolling back also removes this telemetry
fix. Keep content capabilities off during recovery. A later release must prepare
new helpers anchored to this deployed SHA rather than blindly reusing this release's
cab25ee recovery anchor.
