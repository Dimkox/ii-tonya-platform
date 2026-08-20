# Client Session Activation Gate

Status: **BLOCKED**. This file is evidence metadata, not activation or deployment approval.

## Current safe posture

- `CLIENT_SESSION_ENABLED=false`.
- A Security-approved identity-proof source is not recorded.
- No production verifier implementation, trust key, credential, provider session, or network
  activation is authorized by `MVP-CLIENT-PRINCIPAL-001`.
- Selarti external channel user ID is not an internal user UUID and is not accepted as proof.
- Planerka is not required for this gate.

## Required Security evidence

| Gate               | Required evidence                                                                                                                                | Current result                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Proof source       | named source, owner, official contract/version, environment and evidence URI/checksum                                                            | not approved; activation blocked |
| Internal mapping   | proof resolves canonical internal `users.id` without exposing provider subject or contact                                                        | not approved; activation blocked |
| Audience and scope | exact `ii-tonya-client` and `client_session:create` negative/positive evidence                                                                   | not executed; activation blocked |
| Signature/trust    | algorithm, key reference, rotation, expiry, revocation and compromise procedure                                                                  | not approved; activation blocked |
| Replay             | stable versioned `HMAC-SHA-256(K_replay[v], domain-separated canonical fields)`, key-overlap, proof-expiry and concurrent single-winner evidence | not executed; activation blocked |
| Verifier bounds    | 2-second deadline, cancellation, 32-call process ceiling, saturation and late-completion evidence                                                | not executed; activation blocked |
| Failure modes      | invalid, expired, wrong scope/audience, verifier outage and unknown subject outcomes                                                             | not executed; activation blocked |
| Privacy            | proof/subject/contact/token absence from storage, logs, traces, metrics and evidence                                                             | not executed; activation blocked |
| Reviewer           | named Security approver, date, verdict and signed evidence reference                                                                             | no approver; activation blocked  |

All rows must be satisfied by project-owned evidence. A local fake, fixture, Claw environment,
green CI run, provider screenshot, or verbal approval does not satisfy a row.

## Pre-activation sequence

1. Merge the catalog prerequisite and allocate the next actual database migration after it.
2. Implement pure capability preflight before migrations, production composition with no verifier
   fallback, and keep the flag false.
3. Pass local TDD, real PostgreSQL concurrency, privacy, startup, and session-to-own-catalog tests.
4. Obtain independent interface/security review and resolve every Critical and Important finding.
5. Run exactly one focused Claw invocation for this slice. A pass ends the gate; a failure is
   retained as terminal evidence and is not rerun under this slice ID.
6. Record all Security evidence rows above and obtain named Security approval.
7. Obtain separate target-environment deployment authorization. Only that authorization may
   permit a controlled activation change.

## Activation checks

- Default false starts with no session routes.
- Session true without verifier/repository/resolver fails startup before listen.
- Catalog true with session false or no resolver fails startup before listen.
- Every invalid flag/dependency combination fails pure preflight before migrations are called.
- Raw-header validation rejects duplicate, folded, or proxy-ambiguous authorization credentials.
- Proof, bearer and nested verifier data are redacted before every configured sink.
- One valid proof creates one session; ten-way replay creates no second session.
- Deactivation and revocation are visible on the immediately following fresh PostgreSQL lookup.
- The session-to-own-catalog proof has zero provider, ledger, reservation, booking and payment facts.

## Rollback and recovery

If an authorized activation later fails, disable `CLIENT_CATALOG_ENABLED` first, then disable
`CLIENT_SESSION_ENABLED`, so composition remains internally consistent. Stop new issuance, retain
only permitted session metadata within the approved retention policy, and never extend a replay
receipt beyond proof expiry. Revoke affected sessions by hash-only database operation, run the
normal receipt-first expiry cleanup, and reconcile that no provider or business facts were created.
Restore service only from an immutable previously approved configuration and a new Security
decision. No step in this runbook authorizes production mutation by itself.
