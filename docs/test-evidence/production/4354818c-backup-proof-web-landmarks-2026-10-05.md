# Backup-proof and accessible-web RC — production evidence, 2026-10-05

Observed deployment/readback: approximately 05:50 UTC (08:50 GMT+3).

Source and remote RC: `4354818c0187d41057b9660deb847e15a002a574`, branch `rc/client-consent-factory`.
Separate production host: `ii-tonya.ru`, `157.22.187.237`,
root `/opt/ii-tonya-platform`. Native and web source markers match this SHA.
Previous source `2db008f7d25cfcaef134afbd9d8de4d6e975c8b7` is retained.

This is a bounded release candidate, **not completion of the commercial product**.

## Delivered changes

Backup erasure no longer becomes verified merely because time elapsed. Trusted
server verification must supply a strict job/policy/expiry-bound attestation
reference. Database time, exact timestamp precision, all four named processor
acknowledgements and booking completion are checked before certification and on
terminal replay. Public terminal replay also requires the active policy.
A blocked event loop cannot admit a verifier result after its five-second budget.
Receipt fields survive and conflicting attestations cannot overwrite a proof.

No production verifier or fake success adapter was installed. No erasure, provider
processing or new personal-content capability was enabled. Real evidence, policy
rescheduling, durable child-work invariants and restore approval remain separate
activation prerequisites.

All seven web routes now have one main landmark. Skip links focus that content
with the keyboard; a JavaScript-disabled fallback provides its own main/heading.
Commercial/legal copy, authentication and catalogue data were not replaced.

See [backup implementation/review evidence](../../superpowers/implementation-artifacts/spec-backup-erasure-evidence.md)
and [web implementation/review evidence](../../superpowers/implementation-artifacts/spec-web-main-landmark.md).

## Verification and publication

Three independent review layers were collected before the patch round.
An independent read-only closure found no remaining concrete correctness or
regression blockers in the bounded scope. This is not a human Trust attestation.

- Backup PostgreSQL file: final 61/61 PASS, **3/3 invocations exhausted**.
- Existing privacy workflow: 3/3 PASS, 2/3 invocations used.
- Worker focused file: 51/51 PASS, also rerun independently by main.
- Composed web file: 8/8 PASS, also rerun by main; catalogue and HTML-shell files
  individually 5/5; retention 3/3 and application privacy service 9/9.
- Relevant package builds/typechecks, tests typecheck, scoped lint/format and
  whitespace checks passed. Main separately checked API and app-worker types.
- Normal pre-push hook passed syntax, formatting, whitespace, evidence integrity,
  changed-file ESLint and tests/repo. No bypass, force push or history rewrite.
- Remote RC readback matched the exact SHA. GitHub check-runs returned total_count0;
  no hosted/external exact-SHA Trust CI or Database Gate receipt is claimed.
- Native and web were built from the committed dependency graph. Packaged API and
  worker imports passed with Node --jitless, without bootstrap/provider calls.

The earlier aggregate remained interrupted (exit130, including an observed
expert-referral-schema timeout); it was not rerun or reclassified as green.
No exhausted navigation/catalogue PostgreSQL file was rerun.

## Signed artifacts

Both Cosign signatures verified; all manifest checksums passed. Both provenance
files bind source archive SHA256
`85889e0cf0c02c37cb05c3aacd930f6bec24c459deb0d59b33afda9c12b9ddd1`.

| Artifact               | SHA256                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| Signed native manifest | `abb7e9690e10aaa683496aadbf6b32f9e2357302b8bacb6b352395747c0fe473` |
| Signed web manifest    | `d696feda0dbf42f2afb719dddae1eb6afea049ff049b22093454507c0f8ee2a2` |
| Native archive         | `f3e797fc8a71f91674abd10df09efefc1980789ab5635d490dfb22c0a472e9df` |
| Web archive            | `f36bf55106ce67380baa37a52825223bd318e9ce4175062722bb5b6bbcfb13f4` |

Artifacts, signatures, SBOM, provenance, screenshots and operational evidence are
retained in ignored `.native-release/client-web-4354818c0187d41057b9660deb847e15a002a574/`.

## Live readback

API, worker and Nginx were individually active. Readiness returned200 with
PostgreSQL, migrations, worker lease and adapter checks true.
Migration directories match the previous deployment byte-for-byte.

Direct real-Chrome checks with TLS verification passed /catalog, /account,
/consent, /my-data, /, /privacy and /oferta. All passed main/skip-target uniqueness,
navigation ancestry, actual Enter-key focus and mobile-width checks. A separate
JavaScript-disabled context passed all seven fallback routes with no API/external
requests. Browser errors and unexpected external requests were zero.

Session discovery is available but anonymous; bot username is
`ii_tonya_assistant_bot`, browser widget remains disabled, erasure unavailable.
Private consent access returned401, forged MiniApp proof401, oversized proof413.
Public catalogue returned200 with no-store/no-referrer and **zero services**.
HTTP canary checks returned404/400/401 without reflecting the marker. Actual
telemetry sink contents were not inspected by this probe.

Read-only production counts at05:50:04 UTC: zero experts, services, publishable
services, future slots and navigation receipts. Real-user Telegram delivery/login
remains unobserved. Telegram webhook URL/IP match; pending updates0; its stored
last error is connection timeout at03:20:01 UTC, not a newly observed delivery.

Bounded local-file and connected-Drive metadata searches did not identify an
approved real catalogue/slot dataset. Unrelated Drive content was not fetched,
and nothing was imported, shared or published.

## Recovery and cleanup

The normal API restart produced three brief localhost connection-refused retries
before readiness succeeded. No zero-downtime claim is made.
The temporary Nginx-check unit was already unloaded when reset-failed ran; fresh
readback confirmed its file absent and LoadState not-found. Both owned incoming
directories are absent. Temporary local preview servers were stopped.

Previous native/web releases and protected configuration backups remain available.
No live rollback drill was performed. The rollout helpers used here are pinned to
the previous2db008f source; prepare new helpers anchored to this release before a
future rollout. Signed artifact integrity is not provider verification or Trust CI.
