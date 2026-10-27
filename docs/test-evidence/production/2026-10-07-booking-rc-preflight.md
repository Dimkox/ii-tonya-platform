# Booking RC preflight and publication

## Publication result (supersedes preflight-only status below)

Native and web are now deployed at
`b4bac0637548a7abe3e1178f442a3304423d667b`, matching the remote RC. Pinned SSH
confirmed both source markers, API/worker/nginx active, and all four readiness
checks true. Deployment exited0. Three connection-refused retries occurred during
API restart before readiness succeeded; this was not a zero-downtime deployment.

Rollout/recovery helpers were copied to `/tmp/ii-tonya-booking-release.ckaIXB/`
and their previous-release pins changed from4354818 to the freshly verified425e647.
The SQL delta adds only0040's session-grant table/FK; no historical SQL was changed.
Migration service succeeded. Existing runtime capabilities were preserved: session,
privacy/navigation on, booking/reserve/new grants off. No provider or erasure
capability was activated. Thus this publication is NOT a working live booking claim.

Real Chrome checks passed against the published site: public catalogue, account,
consent/data pages, home/privacy/offer, mobile layout and keyboard skip links.
Seven no-JavaScript routes passed. Anonymous private access401, forged login401,
oversized proof413. Browser errors0 and unexpected external requests0, TLS verified.
Catalogue count0 is owner-accepted. Real Telegram login remains unobserved.

Previous425e647 native/web releases and runtime/nginx backups are retained. Both
owned incoming directories are absent. The temporary nginx check unit is absent
(LoadState=not-found); reset-failed printed that it had already unloaded, and
subsequent cleanup/readback confirmed absence. Screenshots are under the new helper
directory, without overwriting previous release evidence. All processes completed.

Preflight documentation was temporarily stored in exact stash
`0abcb27d553f27dd8ed816b4ffdc51bb9f40d48d` to satisfy the existing clean-tree
deployment guard, then applied back successfully. No user files were stashed.
The stash is retained as an additional recovery copy, not outstanding code work.

Next: review and activate the ordinary booking/catalogue runtime composition,
verify fresh authentic login, finish ordinary documents/erasure and the remaining
acceptance map. If grants or bookings become active, old425e647 is not an automatic
compatible recovery target; preserve owner read/cancel and disable creation first.
The full product goal remains active, not achieved.

## Original preflight observations

Candidate: `b4bac0637548a7abe3e1178f442a3304423d667b`.
Remote `rc/client-consent-factory` readback matches that exact revision after a
normal push. The installed pre-push gate passed script syntax, formatting,
whitespace, evidence integrity, scoped lint and tests/repo. No bypass or force push.

Native and web builds completed using the committed lockfile. Native production
dependencies were deployed offline; the web build used a clean source archive and
offline frozen-lockfile installation. Native SBOM generation warned that the
directory source has no explicit artifact name/version; generation still exited0.
Packaged API and worker imports passed using Node --jitless without bootstrap or
provider calls. Native manifest checksums passed. Both manifest signatures passed
Cosign verification with the existing public key.

Artifacts are retained in ignored
`.native-release/client-web-b4bac0637548a7abe3e1178f442a3304423d667b/`.

| Manifest              | SHA256                                                             |
| --------------------- | ------------------------------------------------------------------ |
| native-release.sha256 | `3d7c1a85f7595b36acc80f4726283a704e92bf5c7e2694e05570b4b9e7bc4fc0` |
| web-release.sha256    | `9054424a8ff5c4e6d8b310e08f946dc7a48b5d93c244b7f452c9a6eedd0fc0ea` |

An initial signing invocation failed because current Cosign rejects the legacy
`--tlog-upload=false` with its default signing configuration. No artifact signature
was created by that invocation. Retrying with the normal default signing
configuration succeeded; signature verification was not weakened.

## Read-only target checks

Pinned SSH confirmed native and web are still
`425e647a6e8a577095df2d9a89f28660d5a781ef`. API, worker and nginx are active.
The first readiness request mistakenly used `/ready` and exited22; the correct
`/health/ready` returned status ready with postgres, migrations, workerLease and
adapters all true. No deployment or runtime configuration mutation occurred.

## Cutover requirements still open

- Refresh all old rollout/recovery helpers: they pin previous4354818, not current425e647.
- Verify additive0040 compatibility and preserve recovery artifacts; do not drop
  the session-grant table or relabel existing sessions as newly authorized.
- Review activation as a unit: session grants require booking; booking requires
  catalog and WORKER_OUTBOX_DELIVERY_ENABLED. Production registry inspection in
  apps/worker/src/main.ts shows the selected registry uses only
  safety.operator_escalation, admin.negative_feedback and catalog.show. The
  repository is constructed with that topic allowlist. This is source inspection,
  not live activation evidence; other worker capabilities must remain off.
- Empty catalogue is owner-accepted. Reservation creation must not be represented
  as usable with real experts/slots until real inventory exists. Do not seed demos.
- Keep a compatible owner read/cancel path when disabling creation or issuance.
  Do not blindly restore an old binary after granting new booking authority.
- Erasure, ordinary document availability and real-user login remain unfinished
  product acceptance items. This preflight is not completion of the goal.

No full suite, multi-path run or exhausted PostgreSQL/browser file was rerun.
Factory/Trust CI integration remains excluded; local release signatures are not
external acceptance. Human review remains a separate deliverable after publication.
