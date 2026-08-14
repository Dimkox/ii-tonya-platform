# Adversarial interface/security review — MVP-CLIENT-BOOKING-001

## Verdict

**FAIL — zero Critical, five Important, five Minor findings.** Authority separation, handle entropy, atomic receipt/reservation intent, default-off flags, provider/payment non-authority, lock topology, and approval boundaries are directionally sound. The package is not implementation-ready until the external HTTP/error contract, cancellation projection, erasure resumption, and provider-dispatch verification gaps below are frozen.

Scope reviewed: canonical SPEC and CBK-001–018/AC-01–12; booking, catalog-amendment, catalog-base, and local principal contracts; architecture spine; design; implementation plan; traceability; progress ledger; activation gate; base reservation, booking repository, config, worker allowlist, catalog retention, and privacy job contracts at `3db7ad1`.

## Important findings

### I-1 — Reserve/DELETE HTTP media and framing grammar is not actually frozen

**Evidence:** CBK-005 says “JSON only,” maximum 1 KiB, and maps wrong media/framing to `400` (`docs/spec/mvp-client-booking-001.md:41-45`); the wire contract repeats an “exact JSON body” and one catch-all malformed-media/framing row (`docs/contracts/client-booking.md:31-39`, `75-85`). It does not decide accepted `Content-Type` parameters, content encoding, byte-count stage, duplicate JSON keys, duplicate/ambiguous `Content-Length`, simultaneous `Content-Length`/`Transfer-Encoding`, malformed UTF-8, trailing bytes, or what “no body” means for DELETE. The plan only names “exact 1-KiB JSON” and “bodyless DELETE” (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:322-326`) and therefore cannot derive exact negative tests. The base Fastify app has a broad 64,000-byte limit (`apps/api/src/app.ts:141`), so route-local enforcement is material.

**Consequence:** independently implemented parsers/proxies can accept different ambiguous requests; request smuggling, duplicate-key interpretation, or oversized/decode-stage drift may reach authority/repository code.

**Concrete fix:** add a byte-level HTTP grammar comparable to the principal contract: allowed media type/charset, no content encoding, de-framed 1,024-octet limit before UTF-8/JSON parsing, duplicate-key/trailing-byte rejection, explicit CL/TE rules, and exact DELETE framing. Add table-driven raw injection tests proving rejection before resolver/repository access.

### I-2 — Missing and foreign choice handles have no single enumeration-safe status

**Evidence:** the reserve contract defines `404` only for a foreign/missing **booking** handle and assigns expired/stale/ineligible/full choice to `409` (`docs/contracts/client-booking.md:75-84`). CBK-AC-05 permits a foreign choice to return either `404` or `409` rather than freezing one behavior (`docs/spec/mvp-client-booking-001.md:133-136`). CBK-007 requires owner/request/choice rechecks (`docs/spec/mvp-client-booking-001.md:52-57`), but neither spec nor plan says whether a nonexistent digest and an existing digest owned by another principal are indistinguishable.

**Consequence:** different repository/route implementations can expose whether a captured `ch1` exists or belongs to another account, violating the owner-only/non-enumeration boundary.

**Concrete fix:** freeze absent, erased, malformed-after-auth, and foreign choice lookup to the same `404 not_found`; reserve `409` for an owned choice whose public eligibility changed. Require equal body/status and zero side effects/repository-detail leakage in paired missing-vs-foreign tests.

### I-3 — Owner DELETE can reveal which actor cancelled the reservation

**Evidence:** the contract says `cancelled_by_client` and `cancelled_by_expert` both project to public `cancelled` (`docs/contracts/client-booking.md:69-73`), while CBK-008 returns `200 cancelled` only for client-cancel replay and sends “other terminal states” to `409` (`docs/spec/mvp-client-booking-001.md:58-67`). The error table likewise maps a non-cancellable owner state to `409` (`docs/contracts/client-booking.md:81-84`). Thus DELETE after expert cancellation can be `409`, while DELETE after client cancellation is `200`, despite both states supposedly having the same public projection.

**Consequence:** the API leaks internal cancellation actor and two builders can choose incompatible replay semantics.

**Concrete fix:** decide one public rule. Prefer returning stable `200 {state:"cancelled"}` for either internal cancellation terminal without a new durable effect; otherwise explicitly approve actor inference and remove the claim that the states collapse. Add both internal cancellation origins to route/repository replay tests.

### I-4 — Pending erasure has no durable resumption owner or completion protocol

**Evidence:** CBK-013 says a transition race/failure leaves erasure pending and retains handles, then a later phase removes them (`docs/spec/mvp-client-booking-001.md:91-101`). AD-9 and the booking contract repeat the two phases (`ARCHITECTURE-SPINE.md:126-136`; `docs/contracts/client-booking.md:109-119`). Task 4 says “persist pending erasure” and use a retryable cleanup phase (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:358-364`), but no task assigns a worker/claim lease, retry trigger, idempotency key, exhaustion behavior, or recovery procedure. The base privacy API only starts an atomic job with statuses `pending|processor_complete|backup_verified` (`packages/application/src/privacy-service.ts:42-61`), and the current repository performs destructive local erasure inside `startErasureAtomically` (`packages/db/src/repositories/privacy-repository.ts:205-228`, `275-343`); merely returning pending does not create a new booking-transition runner.

**Consequence:** one transition race can strand privacy erasure indefinitely, or an implementer can keep the current atomic deletion path and bypass the required cancellation/handle-retention invariant.

**Concrete fix:** define the durable booking-erasure phase machine and owner: claim/fence/lease, per-reservation idempotent cancellation, retry/recovery, terminal cleanup predicate, interaction with existing processor/backup states, and operator-visible bounded failure. Add crash-between-phases, lease-expiry, partial-owner-set, and repeated-worker tests on real PostgreSQL.

### I-5 — The plan proves outbox creation but not continued absence of booking-topic dispatch authority

**Evidence:** CBK-012 permits existing `planerka.reserve`, `telegram.reservation_request`, `planerka.cancel`, and `telegram.booking_cancelled` rows while forbidding live delivery (`docs/spec/mvp-client-booking-001.md:85-90`). Task 3 asserts exact created rows and zero provider attempts in the reserve transaction (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:255-273`); Task 4 only says provider schemas remain false (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:353-356`). At the base, the worker's only accepted allowlists are local operator topics or those plus `catalog.show` (`packages/contracts/src/worker-outbox.ts:1-15`; `apps/worker/src/main.ts:79-91`, `119-138`). The plan does not require a regression test that these booking/provider topics remain absent from registry, claim, reconciliation, and handler composition after booking changes.

**Consequence:** a seemingly convenient worker-registry expansion can turn already-created internal-ID outbox rows into live provider attempts despite false provider flags, and the planned transaction-count tests would still pass.

**Concrete fix:** add an exact worker allowlist/claim/reconciliation boundary test asserting all four booking topics remain unclaimable and have no handler/export under every booking/catalog flag matrix; retain literal-false Planerka/Telegram config tests and assert zero provider network adapters are constructed.

## Minor findings

### M-1 — Sensitive response cache policy is only explicit for first reserve

**Evidence:** only the `201` example carries `Cache-Control: no-store` (`docs/contracts/client-booking.md:46-55`). Replay and DELETE echo `bk1` but do not freeze cache headers (`docs/contracts/client-booking.md:55-67`); the plan says “on booking receipts” without defining success/error coverage (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:348-351`).

**Fix:** require `Cache-Control: no-store` on every reserve/cancel success and authenticated error response; test `201`, replay `200`, cancel `200`, `404`, and `409`.

### M-2 — Random handle collision behavior is unspecified

**Evidence:** both handles use 32 CSPRNG bytes and exact 43-character base64url (`docs/spec/mvp-client-booking-001.md:30-33`, `46-51`), and receipt uniqueness is required, but neither contract nor plan defines bounded retry versus sanitized failure on a unique collision (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:108-121`, `285-288`).

**Fix:** freeze collision handling as a bounded server-side regeneration inside the owning transaction (or a sanitized terminal `500` with no partial effects) and test it with an injected deterministic generator.

### M-3 — Metric verification example allows forbidden extra labels

**Evidence:** CBK-014 defines exact finite operation/outcome sets and forbids all other dimensions (`docs/spec/mvp-client-booking-001.md:102-106`), but the plan's only concrete assertion uses `arrayContaining` on two label objects (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:322-338`). That passes with high-cardinality labels or unexpected operations present.

**Fix:** assert exact label-key sets and enum values for every branch, inject sentinel handles/UUIDs/timestamps/reasons, and scan rendered metric text plus trace attributes for absence.

### M-4 — Public timestamp grammar is example-driven, not contractual

**Evidence:** `reservedUntil` and `startsAt` appear as examples (`docs/contracts/client-booking.md:46-55`; `docs/contracts/client-catalog-booking-amendment.md:36-45`), while canonical requirements say database time but do not freeze UTC serialization precision or rejection of invalid/non-finite dates.

**Fix:** bind public instants to canonical UTC RFC 3339/ISO format with millisecond precision and `Z`, define invalid-date failure as sanitized `500` before serialization, and add boundary tests.

### M-5 — Traceability overstates named proof for every acceptance criterion

**Evidence:** the plan self-review claims every CBK-AC has a named proof (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:407-410`), but the explicit Task 4 command omits the listed integration privacy and E2E boundary files (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:304-320`, `341-346`), and the one terminal Claw step names file classes rather than an exact manifest (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:391-400`).

**Fix:** give each AC an exact test file/case/assertion mapping and freeze the final Claw file manifest before its single allowed invocation; include the two listed-but-omitted files in the Task 4 first-PASS command or explicitly defer them to the immutable final manifest.

## Lens summary

- **Adversarial:** ten concrete contract/verification weaknesses are listed above.
- **Edge-case:** unhandled paths remain for ambiguous HTTP framing, foreign-vs-missing choice, expert-vs-client cancelled DELETE, handle collision, and erasure crash/resume.
- **Verification-gap:** provider-topic non-dispatch, exact metric label closure, sensitive cache headers, and exact AC-to-test/Claw manifest are not reliably proven by the current plan.

## Gate

Do not mark the interface/security gate closed until I-1 through I-5 are resolved in the frozen package and re-reviewed. Product approval must cover any change to public error/cancellation/cache semantics; Security must cover raw framing, authority, privacy phase recovery, telemetry, and provider non-dispatch. Implementation/Claw evidence remains separate from activation and deployment authorization.

## Closure — 2026-08-14

### Closure verdict

**PASS — zero Critical and zero Important findings remain.** I-1 through I-5 are closed in the current documentation package. M-1 through M-5 are also closed. This is documentation/interface/security readiness only; implementation, tests, Claw evidence, Product/Security approval, activation, and deployment remain separate gates.

### Important findings

- **I-1 CLOSED — byte-exact HTTP grammar.** CBK-005 now freezes media type/charset, no encoding/BOM, the de-framed 1,024-octet boundary, strict UTF-8/JSON with unique key and no trailing bytes, CL/TE ambiguity rejection, and exact zero-body DELETE framing before resolver/repository access (`docs/spec/mvp-client-booking-001.md:41-54`; `docs/contracts/client-booking.md:59-72`). Task 4 names raw-injection coverage for every branch (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:341-347`).
- **I-2 CLOSED — enumeration-safe choice errors.** Syntactically valid absent, erased, and foreign choices are uniformly `404`; `409` is restricted to an owned choice whose eligibility changed (`docs/spec/mvp-client-booking-001.md:53-54`, `159-160`; `docs/contracts/client-booking.md:88-96`). The plan requires paired equality and zero-effect tests (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:266-271`, `463-464`).
- **I-3 CLOSED — cancellation actor projection.** DELETE of either `cancelled_by_client` or `cancelled_by_expert` now returns the same stable `200 cancelled` without a durable effect (`docs/spec/mvp-client-booking-001.md:69-80`; `docs/contracts/client-booking.md:103-105`). Repository and route proof points explicitly cover both origins (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:266-271`, `304-309`, `465-466`).
- **I-4 CLOSED — durable erasure resumption.** CBK-013 now assigns the existing privacy worker a persisted `cancel_active -> cleanup_public -> complete|dead_letter` phase with DB lease, fencing, reclaim, job/reservation idempotency, zero-active proof, five-claim dead letter, and approved operator requeue (`docs/spec/mvp-client-booking-001.md:104-120`; `docs/contracts/client-booking.md:144-159`). The plan adds the work relation, worker, phase implementation, and crash/lease/partial/replay real-PG tests (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:111-129`, `330-339`, `384-394`).
- **I-5 CLOSED — booking topics remain undispatchable.** The contract now forbids all four booking topics from handler exports, registry, claim/reconciliation allowlists, and adapter construction under every flag matrix (`docs/contracts/client-booking.md:124-128`; `ARCHITECTURE-SPINE.md:113-120`). Task 4 binds exact worker boundary files/tests and the final proof manifest (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:330-347`, `376-382`, `469-470`).

### Minor findings

- **M-1 CLOSED — cache policy.** Every reserve/cancel success and authenticated `400|404|409|500|503` response is `Cache-Control: no-store` (`docs/contracts/client-booking.md:103-105`; `docs/spec/mvp-client-booking-001.md:128-131`), with route/E2E proof assigned in the plan (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:341-347`, `468-469`).
- **M-2 CLOSED — handle collision.** Choice and booking generators retry unique collisions at most three times inside the owning transaction; exhaustion is sanitized and atomic (`docs/contracts/client-catalog-booking-amendment.md:47-51`; `docs/contracts/client-booking.md:109-117`; `docs/spec/mvp-client-booking-001.md:55-62`). The plan requires injected collision retry/exhaustion coverage (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:266-271`, `298-302`).
- **M-3 CLOSED — exact metric cardinality/privacy proof.** The plan replaces the permissive example with exact array/key assertions and requires every rendered metric to contain only `operation,outcome` from the frozen enums plus sentinel scans across metrics/traces (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:341-360`, `392-394`).
- **M-4 CLOSED — public time grammar.** Booking and catalog contracts freeze finite PostgreSQL `timestamptz` to UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, with sanitized failure before response/snapshot (`docs/contracts/client-booking.md:140-142`; `docs/contracts/client-catalog-booking-amendment.md:47-51`; `docs/spec/mvp-client-booking-001.md:128-131`).
- **M-5 CLOSED — exact acceptance proof manifest.** The plan now freezes the single Claw file manifest (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:421-443`) and maps CBK-AC-01 through CBK-AC-12 to exact files/assertion purposes (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:455-470`). The previously omitted privacy/E2E files are explicitly included in the immutable final manifest (`docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md:428-434`).

### Residuals

- Critical: none.
- Important: none.
- Minor: none from this review set.
