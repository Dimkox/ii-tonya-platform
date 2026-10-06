# Client async authority RC — release preparation, 2026-10-06

Owner command: publish to ii-tonya.ru. This is a bounded RC, not certification of
the complete commercial product. The existing host is 157.22.187.237, release root
`/opt/ii-tonya-platform`. Preflight native/web and remote RC source all matched
`4354818c0187d41057b9660deb847e15a002a574`; API, worker and Nginx were active and
readiness reported PostgreSQL, migrations, worker lease and adapters ready.

## Candidate scope and evidence

Original-consent stamps fence client production, durable dispatch and late responses.
Final financial nonapplication is terminal; configured client workers recover only
their bot's queue. Contention defers provably unstarted work without consuming its
attempt budget or inventing provider/accounting facts. Limited-batch recovery does
not convert unstarted overflow into uncertain effects. Started work retains its
uncertainty. Database migrations, dependency graph and Nginx configuration are unchanged.

Independent initial reviews and bounded closure were recorded before final testing.
Final focused PostgreSQL evidence on 2026-10-05 at15:00:26 UTC: **34/34**, exit0,
23.69s. This includes six post-claim contention cases, backlog-limit recovery,
uncertain started effects, bot isolation and financial/residual scenarios.
The last correction was synthetic update-ID uniqueness, not weakened production
idempotency or test assertions. Earlier failed logs are retained.

- Log SHA256: `a5f75060bb3fa96fc4be05bdc176e04eb08c8b07f4ed3458057ee006ad8d9498`.
- Test-file SHA256: `38d0461368f51a9f15cee40e340b604a07a0002f5944f1e89fea4e248a1edd26`.
- Both hashes were rechecked before release preparation on 2026-10-06.
- Node24.21.0 and pnpm11.9.0 environment preflight passed; pre-push hook is active.
- No exhausted PostgreSQL file or interrupted aggregate was rerun for publication.

See [implementation and verification ledger](../../superpowers/implementation-artifacts/spec-client-async-authority.md).

## Release boundaries

Navigation, session and privacy configuration must be preserved. Personal-content
ingress, provider processing, general outbound delivery and erasure activation are
not authorized by this bounded patch. No real catalogue data, consent documents,
provider evidence or user login result is manufactured. The ordinary launch route
does not require written consent or electronic signing; detailed special-category
processing remains unavailable.

Factory PR247 remains open at9352f1ead48d1fbcf07364663073b60e3c945817 and consumer
issue243 remains open at preflight. A factory repository check is not an ii-tonya
Trust CI receipt. No external exact-SHA Trust CI or Database Gate receipt is claimed.
The full-product acceptance and live provider/real-data gaps remain separate.

This file initially records preparation, not successful deployment. Publication,
artifact signatures/checksums, installed SHA, live checks and cleanup must be recorded
after their actual results. Rollout helpers are pinned to the previous4354818 source;
previous native/web releases and configuration backups must be retained for recovery.
