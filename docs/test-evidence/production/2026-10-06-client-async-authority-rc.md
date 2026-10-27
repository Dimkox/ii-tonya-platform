# Client async authority RC — production evidence, 2026-10-06

Published and deployed source: `425e647a6e8a577095df2d9a89f28660d5a781ef`.
Remote branch: `rc/client-consent-factory`. Native and web source markers match.
Observed successful rollout/readback approximately07:36 UTC (10:36 GMT+3).

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

## Publication and artifacts

Full workspace and tests typecheck exited0 on 2026-10-06. Normal RC push passed the
installed hook: script syntax, formatting, whitespace, evidence integrity, scoped
ESLint and tests/repo. No bypass, force push or history rewrite. Remote RC readback
matched425e647. Exact-SHA GitHub check-runs returned total_count0; this is not an
external CI attestation.

Native and web builds exited0 using the committed dependency graph. Packaged API
and worker entrypoint imports passed with Node `--jitless`, without bootstrap or
provider calls. Cosign signatures on both manifests verified, and all manifest
checksums passed before installation. Both provenance files bind source archive
SHA256 `4c72c07041f2c3924a6d80990b50d23e3d44c3ba0c37c761ed58367d60f82402`.

| Artifact        | SHA256                                                             |
| --------------- | ------------------------------------------------------------------ |
| Native manifest | `9a50c9bc0d6846b903e05de1c88a6cacb5f765e78abc14be3fe3ef5293489b27` |
| Web manifest    | `de899f2fe3e103ae4c1420b811eba1cae20bf78b858e7fd2cb4f1c9e6ebe107e` |
| Native archive  | `aebe6191cabfec08bc5e1608352a4d3343018004e11628928f75861e98e10a75` |
| Web archive     | `052ce512a59b44259d178ce626efc8a5d213eba13ded24deeeb4f4ca3733b878` |

Signed artifacts, SBOM, provenance, command logs, live readback and screenshots are
retained in ignored `.native-release/client-web-425e647a6e8a577095df2d9a89f28660d5a781ef/`.

## Live readback and cleanup

API, worker and Nginx were individually active. Readiness returned200 with all four
checks true. Native and web SOURCE_SHA matched425e647. Migration directories on
the host match previous4354818 byte-for-byte. Navigation/session/privacy are enabled;
browser widget, personal ingress, hybrid routing, Selarti ingress, B2 and general
outbox delivery remain disabled. No new provider capability was activated.

Real Chrome checked /catalog, /account, /consent, /my-data, /, /privacy and /oferta,
including mobile overflow, unique landmarks and keyboard skip focus. All seven
no-JavaScript fallbacks passed with no API/external requests. Browser errors and
unexpected external requests were zero; TLS verification remained enabled.
Anonymous session discovery passed; private consent access returned401, forged
Mini App proof401 and oversized proof413. Content-free error probes returned
404/400/401 without reflecting the canary or exposing stack/cause fields.
Telemetry sink contents were not inspected.

The live public catalogue still has zero services. Real-user Telegram login and
delivery remain unobserved; erasure remains unavailable. Do not interpret this
bounded successful rollout as completion of these product requirements.

Four localhost connection-refused retries occurred during the normal API restart
before readiness succeeded; no zero-downtime claim is made. The temporary Nginx
check unit had already unloaded before reset-failed and was subsequently confirmed
absent (`LoadState=not-found`). Both owned incoming directories are absent. Browser
processes exited. Previous4354818 native/web releases and configuration backups are
retained; no live rollback drill was performed. Existing rollout/recovery helpers
remain pinned to previous4354818 and must be refreshed before a future deployment.
