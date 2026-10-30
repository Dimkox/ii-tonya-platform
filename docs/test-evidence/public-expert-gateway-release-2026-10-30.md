# Public expert payment gateway — local journey and release gates

Task 7 base: `56ba3a6b1714634a116bf3f6a515601309670f19`. This records local
synthetic evidence, not release acceptance, a real payment, or provider activation.

The focused test is
`apps/api/src/public-expert-gateway-journey.integration.test.ts`; its local provider
and isolated clock support are `tests/support/public-expert-gateway-provider.mjs`
and its declaration. Existing production transport, SQL and feature gates are
unchanged by Task 7.

## Verification boundary

The journey seeds a real approved expert application/form/selection and sealed
receipt contact through existing repositories. All payment/refund facts then
originate authenticated real gateway IPC and TLS LIST/GET from a local test
provider. No fake fresh-GET objects or direct paid facts authorize settlement.
Five distinct restricted LOGINs are provisioned from the canonical capability
catalogue, with a sixth separate gateway LOGIN and actual Python PgAuthority.
Startup audits effective rights; sender/binder/writer table reads are denied.
The existing canonical financial engine retains its trusted primary connection;
this evidence does not claim it has become a least-privilege financial principal.

The test provider has synthetic merchant credentials, generated local TLS trust
and in-memory synthetic objects. Only the fixture substitutes the TLS destination.
Production's fixed YooKassa destination and certificate verification remain intact.
The gateway runs in its own OS child process. Restart terminates that child,
opens the same durable state/nonce registry in a new PID, and retains the separate
provider process. The Node runtime is stopped and reconstructed in the test
process; a Node OS-process kill is not claimed.

To exercise publication after the immutable January 11, 2027 launch while the
host date is earlier, an ephemeral PG container alone uses libfaketime. Node and
the local provider use the same running offset. The host clock is unchanged.
The official PostgreSQL 17.5 image is pinned to
`postgres:17.5-bookworm@sha256:fbcea1bd13b6a882cd6caa6b58db3ae5c102efe50ec625b3e2a5cbc50db5bfe4`;
Debian's signed package installation pins `libfaketime=0.9.10-2.1`. Each run records
the resulting local image ID. Actual `server_version_num=170005` and clock
agreement are required. The test advances the isolated clock for expiry without
changing immutable launch/order facts or SQL guards. This is Linux amd64/Docker
local evidence, not an actual PostgreSQL 16 compatibility witness.

## Bounded execution history

Exact focused command:
`pnpm exec vitest run apps/api/src/public-expert-gateway-journey.integration.test.ts`.
Every invocation was recorded before execution in
`.superpowers/sdd/2026-10-30-public-expert-payment-gateway/task-7-report.md`.
Raw logs remain in that task directory. No original exhausted file was rerun.

| Invocation | Allowance       | Result                                                                                       |
| ---------- | --------------- | -------------------------------------------------------------------------------------------- |
| 1          | base 1/3        | Setup failed, five skipped: faketime root/postgres UID semaphore permission.                 |
| 2          | base 2/3        | Setup failed, five skipped: root MJS could not import DB-only `pg` under pnpm.               |
| 3          | base 3/3        | Setup failed, five skipped: fixture IPC timeout exceeded existing 10000 ms cap.              |
| 4          | owner extra 1/2 | Two passed, three failed: capture clock skew and missing explicit retention step in fixture. |
| 5          | owner extra 2/2 | Two passed, three failed; all allowances exhausted.                                          |

Corrections preserve the failed evidence. Startup now runs as postgres from
inception, uses TCP pg_isready, and respects the existing IPC timeout. The provider
clock no longer precedes dispatch. The privacy test executes actual ACK withdrawal
then worker receipt retention; it follows the approved rule that an already
admitted send may finish and later contact sends must stop after ACK.

The separately requested startup-only smoke performed canonical migration and
gateway provisioning/readiness, proved a new gateway PID, and observed zero
provider POSTs. Its failed initial probes and final pass are retained. This
smoke did not execute payment/refund cases or any old PostgreSQL test file.

## Final local outcome: verification incomplete

Invocation 5 passed lost unbound response recovery across an actual gateway OS
restart, and the admitted-send/ACK/privacy/retention race. Both cases use the real
restricted PgAuthority, authenticated IPC and local verified TLS.

The full journey and expiry cases passed actual held fee settlement, then stopped
at `card_invalid_event`: the test helper had generated UUID request keys instead
of the existing required `botId:numericUpdateId` shape. The owned helper is
corrected in the final candidate, but was not rerun. Main settlement, active
publication, authorized refund/recovery and delayed main capture remain
**unverified by this file**. Its expiry fixture also does not establish nonzero
reserved referral-credit preservation.

The capture-versus-cancel case exposed an unresolved production-source defect.
The CREATE and CAPTURE request contexts can independently observe the same
successful parent payment. Once one has committed the canonical paid fact, the
other can receive a new apply attempt.
`PostgresExpertVerificationRepository.settleInTransaction` then rejects its new
`eventId`/`evidenceDigest` against the already stored paid fact at
`packages/db/src/repositories/expert-verification-repository.ts:716`.
`public_resolution` and `public_payment_complete` in migration 0084 only recognize
the applied context for the same request/observation; the first repair check runs
before the new attempt has an apply context. This results in
`verification_payment_binding_mismatch` during ordinary reconciliation of the
same provider payment after CAPTURE. The final failing run did not record which
request context won the race; the exact first committer remains unobserved. The failing test and original assertions
remain. Task 7 made no source repair and did not weaken replay checks.

All base 3/3 plus explicitly authorized owner extra 2/2 runs are consumed. No
further run is implied by the fixture correction. The final focused log is
`task-7-journey-owner5.log` (three failed/two passed), with tested clock image
`sha256:e9a2b4834ba728dc26b0a612f72d4e8a08b2d2c19ceacf21dd465228610ea117`.
Independent source repair/review and separately authorized verification remain
necessary before claiming the Task 7 journey complete.

## Release blockers retained

- No authenticated live refund initiator exists. The local refund case starts
  from an explicit trusted synthetic operation command; it proves gateway and
  canonical recovery, not a live manager HTTP/UI refund path.
- The original gateway PostgreSQL file's last result is 6/9, and financial wave A
  is 5/6. Their exhausted allowances were respected; this new file does not erase
  those failed histories or declare them green.
- The actual PG16 compatibility witness remains absent and its five-run allowance
  exhausted. PG17.5 and version-selector checks do not replace it.
- Exact-SHA independent broad review, hosted CI and Database Gate remain open.
  Prior failed hosted runs 40987914970 and 41001630079 are preserved. Additional
  full CI/push authorization remains pending.
- The preliminary bridge and normal artifacts are superseded. Final distinct-source
  artifacts need rebuilding and exact acceptance. Target role/network/MFA/price
  identity prerequisites and recovery acceptance remain separate gates.

No Task 7 command pushed, ran CI, signed, deployed, modified a real target,
changed production configuration, or contacted a real payment provider. No local
pass authorizes a customer charge or release.

The retained final raw-log SHA256 is
`0cbb69693c7d7f455ece6fba5e4e130f5820d66db8eb3afb34604fd3ab134bb0`
(`task-7-journey-owner5.log`); the earlier actual-run log SHA256 is
`035fdd78d0cd1e9b8a989d35b056a804751c3d0d840d709ce03f6ca60872271c`
(`task-7-journey-owner4.log`).
