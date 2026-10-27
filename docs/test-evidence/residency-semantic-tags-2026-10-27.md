# S3b local semantic tags: implementation evidence

This is local synthetic evidence, not deployment, live-provider or release approval.
The implementation starts at `e0e2095664cb762811983e18b187500ad3ef329f`; the accepted
S3a fixture uses `254c8c169cbb8432654a46de206bd20500cecc3f`. Root coordination, independent
review, final branch gate and exact-commit delivery remain separate.

The portable [artifact manifest](residency-semantic-tags-2026-10-27/manifest.json)
records original paths, raw/compressed SHA-256 and size, commands/results where
available, and final source hashes. Every retained failed run remains diagnostic
history. `ARTIFACTS.sha256` covers the archive and manifest. No model, credentials,
private resident data, database URL or dependency tree is included.

## What is exercised

- Real pinned Navec news vectors, Russian morphology, exact synonyms, non-identical
  semantic examples, strict cosine threshold, qualifier coverage, negation,
  deterministic top 15, vector integrity and public-only cache: Python 10/10.
- Initial PostgreSQL semantic suite: 10/10, including canonical deduplication,
  aggregate limits, concurrent/stale preview fencing, pending custom approval,
  actual authenticated catalogue export and normal work-bot ingress/replay.
- Supplemental real PostgreSQL cases: BLOCKER refusal and WARNING review, stale
  decision rejection, actual callbacks, helper cache corruption/restore, inactive
  selected-tag removal, consent withdrawal and erasure. A missing existing privacy
  capability was a fixture issue; its corrected focused scenario passed.
- Actual owner command flow through API, database and isolated helper: callback and
  custom-command repeats acknowledge once without a duplicate mutation. Custom text
  commands carry the rotating preview token; old commands cannot target a new scope.
- Populated upgrade from all migrations through 0068, seeded by the actual historical
  S3a repository: approved rich profile with 24 unique tags across three services,
  then 0069, unchanged immutable approval and financial facts, explicit visible format
  deselection, subset reductions 24 → 23 → 20 and no whole-card confirmation above 20.
  Other answers survive. This proves historical approved-version preservation, not
  a new live-provider publication. Initial fixture/import and five-second harness
  timeout failures are retained; the longer synthetic journey has a 30-second test
  timeout without changing recommendation deadlines.
- Actual headless Chrome, current web client/view and real protected API fixture:
  pending tag displayed, card approval disabled, revision-bound decision, logout
  fences delayed decision/export responses. Browser responses are deliberately
  replayed/delayed; authoritative role/MFA checks use real PostgreSQL/API separately.
- Empty PostgreSQL 17.5 full SQL replay and normalized Drizzle introspection through
  0069: 213 tables, 151 functions, 193 triggers, 1,448 constraints, 533 indexes and
  two extensions. Snapshot, SQL supplement and manifest are exact-hash pinned.
- Final inspection found a genuine SQL three-valued-logic defect: missing vector
  fields could pass the database validator. The helper already rejected them.
  A focused regression failed, the SQL missing/null checks were corrected, and the
  regression passed. State reconstruction and exact-hash guards were refreshed.
- Affected unit/state batch: 164/166 initially passed; both failures were stale
  newest-snapshot/table-count expectations (68/211). Exact expectations were advanced
  to 69/213; focused history 9/9 passed. Updated state guard 2/2 passed. No repeated
  broad suite was used. Changed-source lint, seven affected package typechecks and
  the complete tests typecheck passed; final whitespace checks are retained.

## Bounded performance witness

Final normal authenticated work-bot request used a staged service with five available
fields and a 741-character description (the exact synthetic text is in the retained
integration source). The warm API → application → PostgreSQL → Unix-socket helper →
response path was **269.3 ms**; cache startup was **1,800.5 ms**, and registry rebuild
was **2,028.2 ms**. Earlier runs are retained rather than cherry-picked or averaged.
This is one bounded local observation, not a production percentile claim.

Host: x86_64 Intel Xeon E5-2680 v4 at 2.40 GHz, 28 logical CPUs. The separately
provisioned helper was constrained to one CPU, 320 MiB memory/swap, 16 PIDs, read-only
root and no network. A retained Docker resource snapshot reports 173.7 MiB and one
PID; this is an observed snapshot, not a peak-memory profiler. Existing Node memory
configuration is unchanged. Input caps are 16,000 characters/512 tokens/128 clauses,
40 tokens per semantic clause, with 400 ms recommendation transport deadline and
five-second cache preparation/restore deadline. Maximum-sized input latency is not
claimed by this witness.

## Reproduction and limits

Ordinary focused integration tests use `II_TONYA_TEST_POSTGRES_ADMIN_URL` and the
provisioned `II_TONYA_SEMANTIC_TEST_SOCKET`. The retained `run.py` reads the protected
local Compose configuration in memory, passes credentials only by environment and
sanitizes captured errors. It contains no secret value. Configure an equivalent
isolated local PostgreSQL 17.5 instance before reproduction. `reconstruct.ts` uses
fresh temporary introspection directories and only a temporary config path in argv;
`drizzle-kit generate` was never used.

To reproduce the historical upgrade, restore `populated-upgrade.test.ts.gz` to its
original execution path `tests/integration/resident-semantic-upgrade.test.ts` and
`baseline--expert-card-repository.ts.gz` to
`.superpowers/sdd/residency-semantic-tags-20261027/baseline/expert-card-repository.ts`.
The retained baseline rewrites imports to this worktree; adapt that root on another
machine. The harness is excluded from normal discovery because it depends on this
historical evidence fixture. Restore the archived browser harness and API fixture to
their manifest paths for the browser witness.

Model bytes remain outside Git. Model/package hashes and publisher/license provenance
are in the [runbook](../runbooks/resident-semantic-tags.md) and runtime assets manifest.
The publisher repository is MIT; a separate model/corpus-specific license grant was
not identified. Production provisioning and redistribution review remain separate.
No payment flags, external API inference, provider activation, production mutation,
public raw storage links or global custom-tag insertion were introduced.
