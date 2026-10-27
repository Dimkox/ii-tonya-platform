# Resident content safety — bounded review remediation

Date: 2026-10-26. Baseline contract: `1ac2091735836fe2a07ed0e8d95bd749f5617e80`.
This report belongs to its containing corrective commit after reviewed candidate
`a882d5621bb0a0912376b71f8d5c432f9e52c9a8`. Root-owned review/spec/coordinator records
and the original evidence archive are unchanged by this implementation batch.
Independent re-review, canonical final gate and push remain coordinator-owned.

## Corrections

- R1: every policy activation now requires a fresh authorized publication fact.
  Append-only ledger triggers validate the manager session, fresh MFA and
  security-admin role, lock publication, compile rules and validate witnesses.
  Underlying policy/pointer transitions require that transaction's ledger fact.
  A new activation UUID and monotonic generation bind every assessment, including
  authorized rollback. Previously accepted warning proof cannot regain authority
  when the original policy is restored. Direct pointer/publication writes fail.
- R2: real owner commands `/card_document REVISION discard` and
  `/card_document REVISION replace text` recover blocked document proposals at the
  100-entry limit. Separate bounded history preserves proposals and uploaded
  entries. Current owner, revision, consent, replay and submission semantics apply.
- R3: database fault probes return an observed outcome, roll back using a specific
  sentinel, and assert outside the rollback wrapper. Unexpected errors propagate.
  Mutation checks demonstrate unexpected success fails missing-policy,
  unknown-engine and corrupt-program assertions.
- R4: actual browser-client responses now exercise refusal for edit/review and
  actual client/view recovery. Private reasons reach the manager, refused requests
  do not show success, corrected submissions use fresh keys, and uncertain network
  failure retains the exact pending request for retry. Production UI behavior
  needed no change; R5 was rejected by the coordinator as a false positive.

## Verification

Environment preflight passed with Node24.22.1, pnpm11.9.0 and PostgreSQL17.5 on the
existing task-owned loopback cluster. Credentials stayed private. No new cluster,
provider call, deployment, push or release operation occurred.

| Check                                        | Result                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| R1 regression RED                            | Direct active-pointer update incorrectly succeeded                                   |
| First R2 attempt                             | Fixture-only JSON parameter type error; retained separately                          |
| R2 behavioral RED                            | Real command had no handler/recovery reply                                           |
| R1/R2 focused GREEN                          | 2 selected cases passed; 12 intentionally filtered                                   |
| R3 mutation RED                              | Unexpected success failed both missing-policy/engine assertions outside rollback     |
| R3 corrupt-program mutation RED              | Unexpected success failed the separate corrupt-program probe                         |
| Final PostgreSQL matrix                      | 14/14 passed, no skips, 16.31 s total                                                |
| Actual browser client and view               | 26/26 passed (12 client, 14 view); no production UI change                           |
| Application and DB builds                    | ESM and declaration builds passed                                                    |
| Application, DB, API, web, tests type checks | Passed                                                                               |
| Migration inventory and scope checks         | 152/152 passed                                                                       |
| Changed TypeScript lint                      | Passed                                                                               |
| Full-chain0061 reconstruction                | 197 tables, 121 functions, 172 triggers, 1333 constraints, 502 indexes, 2 extensions |

The final matrix includes actual owner recovery with 100 media-only entries,
wrong-owner/revision refusal, replay without duplicate history, preserved uploads,
successful submission, and activation validity before/after authorized policy
rollback. Existing 64KB/large-aggregate bounds, SQL review proofs, approval race,
lock timeout, erasure and actual ingress cases remain green. Mutation edits were
restored byte-for-byte after each diagnostic run. No broad unchanged compatibility
suites were repeated. The original Python-parser-gated skip remains explicitly
recorded in the original evidence; it was not rerun or claimed covered here.

SQL0061 remains unpublished and hand-authored. Full migration-chain replay on an
isolated database, fresh-directory introspection and catalogue normalization
regenerated its supported snapshot and exact SQL supplement. Manifest and scope
hashes now match the final artifacts. The reconstruction database was removed;
`drizzle-kit generate` was not used. No historical migration or journal index changed.

## Evidence and remaining gate

Local logs are retained under
`.superpowers/sdd/resident-content-safety-remediation-20261026/`.
The separate committed archive
[manifest](resident-content-safety-remediation-2026-10-26/manifest.json) records
lossless compressed logs and SHA256 hashes of original and archived bytes,
including every failed diagnostic run. Original evidence is preserved separately.

Independent review and the root's final gate remain pending at this local commit.
No live-policy mutation, staging or production readiness is claimed. Policy
publication uses existing database session authority; database superusers able to
disable triggers remain outside the application authorization boundary.
