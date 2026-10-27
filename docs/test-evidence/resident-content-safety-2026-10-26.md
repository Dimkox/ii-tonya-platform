# Resident content safety — local implementation evidence

Date: 2026-10-26. Branch: `codex/residency-content-safety-20261026`.
Frozen contract baseline: `1ac2091735836fe2a07ed0e8d95bd749f5617e80`.
Implementation starts after approved-spec checkpoint `d62c80d8`; coordinator-only
continuation commits remain separate. The implementation commit is the Git commit
containing this report; independent review and the canonical final gate belong to
the root coordinator and are pending at this checkpoint. No release is claimed.

## Changes and acceptance

Hand-authored SQL0061 introduces 35 effective source-derived registry rules, immutable
policy versions, atomic authorized publication, a bounded SQL token interpreter,
minimal committed incidents/outcomes and append-only answer corrections. Actual
work-bot input, document import, tag selection, submission, manager detail/edit/
approval and existing publication/activation gates use the same policy. The manager
must explicitly acknowledge current warnings. Source history and original uploads
are preserved; erasure deletes their new private linkage under the subject lock.

The owner can page through answers and replace one at the 100-entry cap. Multiple
legacy blocked answers/tags can be corrected incrementally. Manager detail separates
current effective fields from original history and permits returning an approved
card for correction. No finance contract, historical SQL, provider flag or client
copy guard changed. [Operating contract](../operations/resident-content-safety.md)
documents the syntax, budgets, hot reload and recovery.

The PG acceptance file exercises real repositories and actual Fastify work/manager
routes. Its 12 cases include every seeded positive witness, Cyrillic/mixed case,
NBSP/newline, percentage endings, benign containing words, ordinary CAT_03,
caps 49/50/51/zero letters, unsupported syntax/budgets, invisible formatting refusal,
committed blocked replay, original-file fallback, correction at 100 entries, bounded
13-page answer traversal, warning acknowledgment, valid-to-invalid activation after
tag-label change, forged SQL review, atomic invalid-policy rollback, policy/approval
race, missing/corrupt policy, lock timeout, multiple-tag recovery and erasure.

## Verification results

Environment preflight passed: Node 24.22.1, pnpm 11.9.0, PowerShell 7.6.9, Docker 29.9.2,
Compose 5.6.1. PostgreSQL server version 170005 was asserted. All database work reused
the existing task-owned cluster on loopback 55483; credentials stayed in protected
child-process memory. No new cluster, provider request, deployment or paid action.

| Check                                                                 | Result                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Initial refusal RED                                                   | Expected failure: unsafe text persisted, entryCount 1 instead of 0                                                          |
| Initial migration attempt                                             | Failed before cases: heterogeneous trigger NEW field resolution; fixed with branch-specific record access                   |
| First refusal GREEN                                                   | 1/1, committed refusal and nonduplicating replay                                                                            |
| First expanded matrix                                                 | 8 pass, 1 fixture failure: existing revision guard correctly rejects a jump to 100; fixture now advances revisions          |
| Expanded matrix GREEN                                                 | 9/9                                                                                                                         |
| Large-input RED                                                       | Near-limit document accepted; representative aggregate hit unchanged 2 s timeout during repeated normalization              |
| Large-input GREEN                                                     | 1 selected pass, 9 intentionally filtered; normalize once per field; 64 KB document plus 100 large Cyrillic fields accepted |
| Final PG matrix                                                       | 12/12 in 13.97 s total; no skipped cases                                                                                    |
| Legacy core compatibility                                             | 16 pass, 1 existing skip: actual Python PDF/DOCX parser gated by absent `II_TONYA_PARSER_PYTHON`                            |
| Legacy main publication/finance compatibility                         | 20/20, including 1/3-month publication, receipts, erasure and settlement races                                              |
| Approved-card return UI RED/GREEN                                     | Expected disabled-control RED; final UI 12/12                                                                               |
| Web client compatibility                                              | 10/10                                                                                                                       |
| Application and DB builds                                             | ESM and declaration builds passed                                                                                           |
| Application, DB, API, web and tests types                             | All passed                                                                                                                  |
| Changed TypeScript lint                                               | Passed                                                                                                                      |
| Migration history, exact scope inventory, journal parity and boundary | 155/155                                                                                                                     |
| Boundary after new files entered Git index                            | 130/130; rerun justified by newly tracked SQL/schema/source artifacts                                                       |
| Full-chain metadata reconstruction                                    | Passed: 195 tables, 118 functions, 167 triggers, 1321 constraints, 498 indexes, 2 extensions                                |

The reconstruction replayed all 62 hand-authored migrations in an isolated database
on PostgreSQL 17.5, introspected into an empty temporary directory, normalized supported
constraint/index metadata and retained exact SQL definitions separately. SQL0061,
its snapshot/catalogue/manifest and the journal are registered by exact hashes; the
six additional relations are exact names with adjacent-name negative probes.
`drizzle-kit generate` was not run. Temporary reconstruction databases were removed.

The owner-approved run-count opt-out recorded in the frozen spec was used for
changed-code/changed-coverage focused runs. No repeat helper above 3, full suite,
canonical final gate, push or hosted CI was run by the implementer. Historical CI
is not evidence for this change. The malformed source fragment remains quarantined
as `TODO: Wait for Content Spec`; it is neither executed nor counted.

## Retained evidence

Complete local logs are retained under
`.superpowers/sdd/resident-content-safety-20261026/` (gitignored local evidence).
Hashes preserve failed and passing results; no failed run was overwritten. Metadata
artifact hashes and migration input hashes are also committed in
`packages/db/migrations/state/0061_manifest.json`.

| Log                             | SHA256                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| `red.log`                       | `a14ba6a8a93c84c750662fcc3b6f47e4deb78a3dd35cc44fd875f2d48b25681e` |
| `green-initial.log`             | `cc1d7fc009122657d9d14a59f467bea163006cc73b00cfdb7d2516b4a77e5351` |
| `green-first.log`               | `0f9dcb9d118d0ff72781864b33e7ba93190d44744cd8fecabc10ffb8942a243b` |
| `matrix1.log`                   | `14a7a4f0c20b55d5fe56b2e9b85a00b9fb0f9faf7a7b02343cb683c2a09175aa` |
| `matrix2.log`                   | `07eb33434590c7b52515f3b0f70ab76e81e22efbc95d9d0b2372d86a32ee8d89` |
| `bounds.log`                    | `0740519f09456dc60cf2d1781d4d52f6d4e3ab6ae7dd0b6d60a81f12e4da4cf1` |
| `bounds-green.log`              | `e8491408f702c7d7c089f275cd2100f79454f4c2481539e665525271226256a9` |
| `matrix-final.log`              | `3b5d5225d5f8a63838889e44501e1f3e284d8b83da7d34eb0c6d1fdf672e365e` |
| `return-red.log`                | `792cd05c291b86b8d7127752e61fbf81d129bdd422dc53db16059fafaadd2036` |
| `ui-final.log`                  | `08282e1626cf2877c646ea7a6daed738c76d9314a010c21aa4601b03c2f401de` |
| `compatibility-core.log`        | `0a0332758b75faf4ef037b5c81cc09b04c4e95b7dfcae3121145b8156207de80` |
| `compatibility-publication.log` | `fd4017e729b01523c3f42f21e8edd97c4eb1367a4adc6d65ecccc61979e374f8` |
| `client-compatibility.log`      | `354e0281a2730b97f3e2992398b76fe13d8fea65a1584aed29d9cd3599e49026` |
| `application-build.log`         | `09adeb60c79a020b69ab31eb178a566e31b4e0f60161c106c3807ba48750e7d6` |
| `db-build.log`                  | `1c8a9f6871e5acbc4cb3224c53f32c3c2651d8b42bf886839549c092884654f7` |
| `application-types.log`         | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `db-types-final.log`            | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `api-types.log`                 | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `web-types.log`                 | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |
| `tests-types.log`               | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `lint.log`                      | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `boundaries.log`                | `995571aae87a97cfbf2ef35ea41fc779f62e20a833b2c5e8b0b45990dab01e13` |
| `tracked-boundary.log`          | `7987a354c94dd4ead4aaac9aed3e7a2aee05278e52beeaeeba36e0f55f286d4a` |
| `reconstruction-final.log`      | `45906d57b158854bb7d4bc40674f01fb79925b8cda38cf3b49fb41edc243a07c` |
