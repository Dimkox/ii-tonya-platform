# MVP-CLIENT-PRINCIPAL-001 Claw verification

- Date: 2026-08-14
- Exact main base: `3db7ad1f3c76a58ebe6478863226c12e83ce306c`
- Reviewed and tested production source: `5772762d92c269c4eb9586d0a8d21c41484740a5`
- Branch: `codex/mvp-client-principal-001`
- Retained container: `ii-tonya-test-yookassa` (left Up)
- Container image ID: `sha256:587eec47e1e3a9c79a4cbce2981342bded8455e198b5b1aa29316579eb6dab60`
- Exact source archive SHA-256: `03dc9dd9a73b48a3384f8405de28ac70f7ff62b8328dcbc09b4092f5f777fe9f`
- PostgreSQL: the single configured Claw test server; no connection value or credential was logged

## Final focused gate

After the final independent review authorized the gate, the brand-new
`tests/integration/client-principal-final-focused-gate.test.ts` suite was copied as
an ephemeral test-only file beside exact reviewed source `5772762` and invoked once:

```text
pnpm exec vitest run tests/integration/client-principal-final-focused-gate.test.ts --maxWorkers=1
```

- exit code: 0
- test files: 1 passed / 1
- tests: 1 passed / 1
- duration: 8.49 seconds
- test execution: 2.136 seconds; focused case: 322 milliseconds
- repeat limit: 1; the successful gate was not repeated

The gate proved opaque bearer issuance with hash-only persistence, rejection of a
non-Bearer authorization scheme, owner-only catalog access with foreign `404`,
revocation through privacy erasure, replay denial through a non-linkable receipt,
expired-receipt cleanup, and exactly one catalog request plus one `catalog.show`
outbox row with zero provider attempts, ledger facts, reservations, provider
operations, or payment attempts. Request logs contained only redacted URLs and no
proof, bearer, or digest values.

## Task and review evidence

- Task 1: token/parser/verifier/application focused gate passed 26/26.
- Task 2: schema parity passed 11/11; real-PostgreSQL repository/schema gate passed
  12/12; contracts, application and database builds passed.
- Task 3: HTTP/config/preflight/resolver closure passed 62/62; catalog integration
  passed 29/29; affected builds passed.
- Task 4: worker/logger/metrics passed 18/18; real-PostgreSQL privacy passed 1/1;
  session-to-owned-catalog E2E passed 1/1; affected builds passed. One earlier
  combined command lost its output to a transport timeout and is not claimed as
  evidence.
- Initial independent adversarial review: 0 Critical, 5 Important, 1 Minor.
- First remediation: the distinct causal RED gate failed 10/10, then passed 10/10
  after the fixes and affected builds passed.
- Closure review: 0 Critical, 2 Important, 0 Minor. Its distinct causal RED gate
  failed only the two new cases (2 failed / 6 passed), then passed 8/8 after the
  narrow fixes; changed application and database builds passed.
- Final static closure review at `5772762`: 0 Critical, 0 Important, 0 Minor from
  both the lead reviewer and the nested independent adversarial reviewer.

Successful suites were not repeated. Only causal RED suites were rerun after their
specific fixes.

## Cleanup and release boundary

After the final gate, PostgreSQL reported `test_databases=0` and
`test_sessions=0`. The exact retained source was restored with `rsync --delete`
and verified byte-for-byte with `diff -qr` before the backup was removed. The
ephemeral gate copy, all task-scoped source archives, the retained backup and the
task lock were removed. No Vitest process remained; the retained container had
only its `sleep infinity` keepalive processes and remained Up.

This evidence does not authorize activation, deployment, provider access, GitHub
Actions, image publication, push, or merge. `CLIENT_SESSION_ENABLED` remains false
by default. Live activation remains `NO-GO` until Security supplies and approves a
production identity-proof source and a separately authorized deployment occurs.
