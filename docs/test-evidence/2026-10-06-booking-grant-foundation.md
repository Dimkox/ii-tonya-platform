# Browser booking foundation — local evidence

Scope: migration-state prerequisite and Tasks 1–2 of
[the approved plan](../superpowers/plans/2026-10-06-browser-booking-authority.md).
This is not the browser booking feature, a production deployment or external CI.

## Revisions

- Initial state baseline: `9e7606ab5d4adee22ec7e3879e49603f8d69d24b`.
- Positional/validation semantic corrections: `696523916454b8fead1648b5a4607c9c19477b81`.
- Session-bound booking grants: `a2c751b3cde6ca62fd4c17a2fe79204ec2c0f317`.

The environment check with `-RequireDocker` passed on Node24.21.0, pnpm11.9.0,
Docker29.8.2 and Compose5.5.1. No dependency, engine or lockfile change.

## Migration-state repair

All forty historical SQL migrations replayed on a dedicated Compose PostgreSQL17.5
database. Introspection to an empty output directory produced JSON, contradicting
the historical assertion that no tool-supported JSON output exists. Raw JSON was
not reliable: independent reviewer Averroes found wrong composite-FK pairings,
wrong positional index operator classes and damaged/omitted NOT VALID semantics.

All three Important findings were accepted. Positional `pg_catalog` data now corrects
supported fields, while exact constraint/index definitions and validation flags join
the SQL-only supplement. Literal regression expectations pin the observed defects.
Schema-derived generation remains forbidden. No historical SQL was edited.

Verification:

- Repository baseline: RED2/2 missing artifacts, GREEN2/2; semantic regression RED1,
  then GREEN3/3; after adding state0040, GREEN4/4 with both manifests checked.
- History integrity: GREEN8/8 after each new baseline; no new gap exemption.
- PostgreSQL baseline run1: rejected shared testkit's PG16.0.15 before snapshot comparison.
- Run2: explicit isolated PG17.5, GREEN2/2.
- Run3: corrected semantic projection and full catalogue supplement, GREEN2/2.

The baseline PostgreSQL file has consumed **3/3** invocations. Do not rerun it without
new explicit authorization. A Minor finding remains: add explicit snapshot-ID
uniqueness/predecessor assertions; current linkage is correct and hashes bind bytes.

## Booking authority

Migration0040 adds only `client_session_booking_grants`, keyed to its parent session
with cascading deletion. It has an actual database-derived snapshot, full catalogue
supplement and input hashes. Existing sessions are not backfilled.

The default-off `CLIENT_SESSION_BOOKING_GRANTS_ENABLED` capability requests membership
only during fresh verified login. Session, replay receipt and grant share one SQL
transaction. Booking resolution accepts either legacy write scope or explicit
membership with an unexpired, unrevoked parent and active user. Read scope alone
remains denied. Grant issuance does not require reservation creation to be enabled.

Verification:

- New issuance unit tests: RED1/4, GREEN4/4.
- New configuration tests: RED4/5, GREEN5/5.
- Existing configuration tests: GREEN24/24.
- Existing session service tests: GREEN13/13.
- Grant PostgreSQL tests: RED7/7 absent authority/table; GREEN7/7; final GREEN8/8
  including an actual forward migration over an existing read session.
- New metadata hashes/inventory: GREEN4/4; history guard GREEN8/8.
- Application, database, API and test TypeScript checks passed; changed TS files
  passed ESLint. Config/application/database builds passed. Relevant Prettier and
  whitespace checks passed.

The grant PostgreSQL file has consumed **3/3** invocations. No full or multipath suite,
historically exhausted test rerun, push, deployment, production mutation, or feature
activation occurred. No real user or real business inventory was fabricated.

## Continuation

Grant slice reviewer Faraday found no observed authority defect, but identified
missing scope-guard artifact/relation registration and a stale full-schema inventory.
Both Important findings were reproduced before correction: the scope test reported
eleven exact violations, and the schema inventory reported only the new table.
Registration now pins the reviewed 0039/0040 files and updated journal hashes; no
wildcard or bypass was added. Final scope tests passed123/123 and the complete schema
file passed7/7 on the dedicated Compose PostgreSQL17.5 instance. Test types and scoped
lint passed after the corrections. Schema tests consumed2/3 invocations in this slice.

One further Minor test gap is deferred: explicitly disable issuance after granting
and demonstrate old-grant survival plus denial of a grant to the next fresh session.
The resolver's independence from issuance configuration was reviewed statically;
the exhausted grant PostgreSQL budget was not bypassed.

Both independently requested review rounds are closed; their Important findings
were corrected and locally verified. External CI is still unconfirmed. The complete
feature remains in progress. Next: Task3 owner-only paginated active bookings, Task4
browser bridge, Task5 web journey, Task6 integrated review/release. External exact-SHA
Trust CI and Database Gate remain separate and unconfirmed. Production remains the
previous RC; local foundation commits have not been deployed.

Detailed logs and disposable probe artifacts are retained under
`.superpowers/sdd/2026-10-06-browser-booking-authority/`; they are ignored and must not
be confused with committed release evidence.

The two task-owned Compose probe/inventory containers, their volumes and networks
were removed. They contained only reproducible test databases; production and
unrelated containers were not modified. Logs remain for continuation.
