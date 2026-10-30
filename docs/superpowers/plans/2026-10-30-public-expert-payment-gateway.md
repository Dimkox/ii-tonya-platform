# Public Expert Payment Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute the tasks and independent reviews without intermediate permission requests; the owner already requested the complete payment implementation. The explicit test budget remains binding.

**Goal:** A new expert can pay onboarding and residency after public launch through the authenticated gateway, with service beginning from verified payment and the existing financial ledger preserved.

**Architecture:** Add versioned public dispatch/evidence linkage to existing onboarding and residency operations. PostgreSQL owns admission, parent-operation fencing and immutable observations; isolated gateway transport performs provider requests. Existing trusted TypeScript financial engines apply verified facts through a guarded transaction and remain the sole ledger implementation.

**Tech Stack:** Node 24, pnpm 11.9.0, TypeScript, Python gateway, PostgreSQL 17.5 development/state reconstruction and PostgreSQL 16.15 production compatibility.

**Spec:** `docs/superpowers/implementation-artifacts/spec-public-expert-payment-gateway.md`; exact SQL/API/IPC contracts are in `public-expert-payment-gateway-design-2026-10-30.md` beside it.

## Global Constraints

- Preserve every migration 0000–0083 byte; add 0084/index84, producing85 entries. Hand-author SQL/journal; never run drizzle-kit generate.
- PostgreSQL owns amounts, identity, eligibility, balances, dates and provider binding. No API/worker merchant credentials, arbitrary gateway URL/path or webhook-authoritative facts.
- Preserve wave predicates and January11 coverage. Public first coverage uses verified capture; effective DATE uses Europe/Moscow. Historical orders keep their existing semantics.
- CREATE/refund receipt disclosure uses the approved contact ACK fence. Contact-free capture/cancel requires its own financial authority and parent fence; it must not redisclose an expired/deleted contact.
- A recorded uncertain POST is never replayed. Unbound recovery requires complete bounded LIST, exactly one exact candidate, fresh GET and isolated binding; otherwise retain uncertainty.
- Preserve existing held onboarding, bank-card verification and actual capture/cancel observations. Ordinary onboarding remains300000minor; the single future10/20-ruble expert authorization is not a global price change.
- Two full CI invocations are CONSUMED and failed before financial tests. No further full invocation/push that triggers one until the pending owner authorization arrives. Focused new PostgreSQL/concurrency files have at most3 local runs; preserve all existing exhausted counters. Reviews never rerun implementer tests.
- No production writes or real provider mutations during implementation. Deployment is requested but still requires successful exact-SHA CI/Database Gate, compatible recovery artifacts and target acceptance.

## Review Focus

- Delayed capture crosses quote expiry: preserve reserved credit until a verified terminal outcome; retain paid/manual evidence on an already-inconsistent release.
- Capture and cancel target the same held parent: uncertainty must fence competing mutations even though the request IDs differ.
- A provider response is lost before its ID is stored: no fallback to legacy exact-body POST replay or partial LIST matching.
- Legacy rows intentionally share IDs with their public linkage: permit exact mapped identity and reject unrelated/cross-product collisions.
- Privacy removes a fiscal contact while financial cleanup is needed: forbid later PII sends while permitting authorized contact-free cleanup.

## Task 1: Public SQL authority and strict DTO contract

**Owned files:** new `packages/db/migrations/0084_public_expert_payment_gateway.sql`, `packages/db/migrations/meta/_journal.json`, new `packages/db/src/schema/public-expert-payments.ts`, `packages/db/src/schema/index.ts`; new `packages/integrations/src/yookassa/public-expert-gateway-contracts.ts`, `packages/integrations/src/index.ts`; new `packages/db/src/repositories/public-expert-payment-authority.integration.test.ts`.

**Interfaces:** Implement the exact three tables, function signatures, five capability roles and gateway claim result documented in the design's Implementation Contract. SQL returns strict version1 snapshots and resolution actions. Export validated `PublicExpertPaymentSnapshot`, `PublicExpertVerifiedObservation`, `PublicExpertApplyAction` DTOs for repositories and adapters; integrations must not import DB. Capture/cancel require nullable contact and the persisted exact parent. Financial application uses the canonical TS bridge, not a duplicate SQL ledger.

- [ ] Write RED cases for all five operation kinds, wrong subject/amount/mode/parent, source ambiguity, cross-kind substitution, immutable snapshots, at-most-once admission/claim and concurrent parent capture/cancel. Use real PG17.5 and new focused file only; record invocation1 before running.
- [ ] Implement SQL and DTO validation. Prepare/source transactions commit before any gateway claim. An admitted operation becomes durable uncertainty before transport; an unknown mutation cannot be reset or bypassed by another parent operation.
- [ ] Implement public apply/expiry transition guards and the exact resolve/complete bridge from the contract. Only the existing trusted processor executes legacy financial code; source/sender cannot bind or mint observations. No caller-supplied coverage/balance disposition.
- [ ] Run the new focused file within its remaining three-run budget, relevant package types/lint and whitespace. Do not reconstruct the full migration state yet; Task6 owns that.
- [ ] Commit only owned files and hand the exact range, test counters and DTO/function contracts to the independent task reviewer. Fix Important findings before Task2.

## Task 2: Typed gateway endpoints and authentic provider projections

**Owned files:** `scripts/experimental/yookassa_gateway/{ipc.py,bound_gateway.py,pg_authority.py,provider_reader.py}`, new `test_public_dispatch.py` and `test_public_provider_projection.py` there; `packages/integrations/src/yookassa/experimental-gateway-ipc.ts`, `contracts.ts`, new `public-expert-gateway.ts` and `public-expert-gateway.test.ts`, integration exports.

**Interfaces:** New authenticated `public_dispatch` packet and strict claim result follow Task1 DTOs/design. `PublicExpertGatewayTransport` exposes `dispatch(snapshot, exactBody)`, fresh payment/refund GET and bounded payment/refund LIST. Path/parent come only from PG claim. Preserve existing wave wire format. Only create/refund packets carry contact subject tokens; capture/cancel cannot contain a receipt/contact. Payment projections preserve actual `payment_method.type`; refund projections preserve strict public metadata.

- [ ] Write failing new tests for correct fixed paths, forged kind/parent/path/body, duplicate/nonces, missing contact, non-PII cleanup after revoke, real bank-card method, refund metadata and incomplete/ambiguous pagination.
- [ ] Implement four payment endpoint forms and refunds according to the design matrix. Validate claimed kind/parent and serialize request line/headers inside the gateway. Keep fixed TLS host/merchant-auth insertion and durable nonce/journal identity.
- [ ] Enforce persisted parent mutation fencing through the PG claim and existing durable operation journal. Do not turn an empty LIST or a waiting GET into permission to repeat a POST.
- [ ] Run only new focused tests, relevant types/lint/Ruff/Bandit and syntax. Existing exhausted files wait for an authorized full CI; update their fixtures when required without secretly rerunning them.
- [ ] Commit and obtain independent spec/security review of the exact diff and observed test evidence.

## Task 3: Credentialless checkout, binding and recovery repositories

**Owned files:** new `packages/db/src/repositories/public-expert-payment-gateway.ts`, new `public-expert-payment-gateway.integration.test.ts`, new `public-expert-payment-recovery.integration.test.ts`, DB exports; new `packages/integrations/src/yookassa/public-expert-recovery.ts` and `public-expert-recovery.test.ts`; narrowly modify `expert-held-onboarding-repository.ts` and `yookassa-operation-repository.ts` to segregate public dispatch/replay.

**Interfaces:** Export `PostgresPublicExpertPaymentSource` using product source/sender capability connections; `PostgresPublicExpertPaymentBinder` and `PostgresPublicExpertPaymentObservations` use their separate connections. Export `PublicHeldOnboardingCheckout` implementing existing create/recover/reconcile outputs and `PublicMainResidencyCheckout` implementing `ExpertCardMainCheckout`; refund consumes an existing authorized operation. All consume Task2 transport through ports. The new public class genuinely owns the fenced route; do not relabel the old unfenced instance as strict.

- [ ] RED tests: approved public onboarding creates a real held request; main/refund bind exact canonical records; no wrong-owner or duplicate operation; uncertainty before/after response never repeats POST; complete LIST with one exact candidate plus GET binds once.
- [ ] Implement encrypted envelopes using existing vault/replay protection and exact associated-data bindings. Preserve onboarding metadata expected by its verifier and add/validate the public main/refund identity from the design. Source facts come from DB, not the UI binding amounts.
- [ ] Separate prepare/admit transactions from network work; never hold legacy invoice/consent locks while gateway PG claim needs them. Exclude public requests from legacy uncertain POST replay at both selection and final admission. Known parent capture/cancel recovers from GET.
- [ ] Run focused new files within recorded limits, relevant types/lint and whitespace; independently review the no-repeat and cross-cohort financial boundaries.
- [ ] Commit the reviewed task and publish exact port signatures to Task4/5.

## Task 4: Canonical financial application and public expiry protection

**Owned files:** `packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`, `packages/db/src/repositories/expert-residency-repository.ts`, `packages/db/src/repositories/expert-verification-repository.ts`, `packages/db/src/repositories/expert-campaign-order-repository.ts`, `packages/db/src/repositories/expert-personal-offer-repository.ts`; narrowly extend Task3 public observation repository; `packages/integrations/src/yookassa/verifier.ts`; new `packages/db/src/repositories/public-expert-payment-period.integration.test.ts` and `packages/db/src/repositories/public-expert-payment-expiry-race.integration.test.ts`.

**Interfaces:** Use stored observation/applyAttempt returned by `public_payment_resolve`; call `public_payment_apply_guard` inside the existing trusted financial transaction, execute canonical ledger logic, then `public_payment_complete` validates committed actual facts. Repair commit-before-complete from those facts. Never pass a free-form period start or balance delta. Historical and wave paths remain explicitly separate.

- [ ] RED tests: capture before creation rejects; Moscow midnight projects correctly; capture at/before deadline processes after deadline; first/renewal coverage preserves ordering; expiry/capture races do not release reserved credit twice; canceled final outcome releases once; already-released conflict retains immutable paid/manual evidence.
- [ ] Apply verified capture origin only to durable public cohorts. Processing clock remains bookkeeping/observation time. Missing/contradictory capture cannot grant coverage.
- [ ] Protect all shared expiry callers and batch selection plus SQL direct-transition guard. Pending/unbound/ambiguous provider outcome preserves reservation; a successful fact is not an unpaid-expiry authorization. Preserve refunds/referral/credit invariants in the canonical engine.
- [ ] Run new focused PG files with explicit counters, relevant types/lint and whitespace. Request independent financial/race review, not test repetition.
- [ ] Commit reviewed changes; do not mark complete while any paid evidence can disappear or duplicate credit can be consumed.

## Task 5: API, worker, contact erasure and startup composition

**Owned files:** `apps/api/src/early-bird-gateway-bootstrap.ts`, `apps/api/src/server.ts`, `apps/api/src/expert-verification-composition.ts`, `apps/api/src/expert-card-composition.ts`, `apps/api/src/expert-residency-lifecycle-composition.ts`, `apps/api/src/receipt-disclosure-contact-fence.ts`; `apps/worker/src/gateway-worker-bootstrap.ts`, `apps/worker/src/main.ts`, `apps/worker/src/expert-separated-sales-composition.ts`; `packages/config/src/env.ts`, `.env.example`; new `apps/api/src/public-expert-gateway-wiring.test.ts`, `apps/worker/src/public-expert-gateway-wiring.test.ts` and `packages/db/src/repositories/public-expert-payment-erasure-race.integration.test.ts`.

**Interfaces:** Inject actual public held/main/refund ports from Tasks2–4 and bounded reconciliation into existing services. Configure explicit default-off `PUBLIC_EXPERT_GATEWAY_ENABLED` and five isolated capability connections; production candidate enables it only after readiness. Construct public capability independent of whether the configured phase text is WAVE or PUBLIC; PG time/source gates decide admissibility. Worker may issue only the first authorized prepared capture/cancel, never replay uncertain requests.

- [ ] RED tests: public phase new expert reaches the injected checkout, missing capabilities fail closed, before-launch public creation is refused, wave still uses its original provider operation, bounded startup/shutdown closes every dedicated pool.
- [ ] Wire phase routing and authenticated service ownership without fake sessions, optional merchant secrets or direct-provider fallback. Preserve current feature-disabled behavior.
- [ ] Prove manual revoke/privacy/TTL all include public legacy payer contacts and wait for gateway ACK before erasure. Contact cleanup removes encrypted envelopes, not financial audit evidence. Contact-free cancellation remains possible after contact removal.
- [ ] Run only new focused files within counters, relevant builds/types/lint and whitespace; independently review wiring, authority and lifecycle cleanup.
- [ ] Commit without pushing or changing production.

## Task 6: Exact capability provisioning, migration state and recovery manifest

**Owned files:** `scripts/early-bird-role-capabilities.json`, `scripts/provision-early-bird-runtime-roles.mjs`, `scripts/sql/provision-early-bird-runtime-roles.sql`, `scripts/experimental/yookassa_gateway/readiness.sql`, `packages/db/src/testkit/migration-state.ts`; new `packages/db/migrations/meta/0084_snapshot.json`, `packages/db/migrations/state/0084_manifest.json`, `packages/db/migrations/state/0084_sql_objects.json`, `tests/integration/public-expert-gateway-migration-state.test.ts`; historical `tests/integration/early-bird-launch-migration-state.test.ts` only to pin approved83 prefix; `tests/repo/support/payment-scope-boundary-core.ts` and bridge evidence.

**Interfaces:** Add the five documented public capability roles and exact functions; extend existing gateway role with its one new claim function. Real LOGINs have no table grants, broad membership, CREATE or unintended function execution. Preserve all old baseline/hash evidence; latest85-entry reconstruction is new evidence.

- [ ] Add focused ACL/reconstruction acceptance for exact function signatures, role isolation, idempotent provisioning and denied direct table access. Use a disposable PG17.5 cluster; run the required Docker environment preflight.
- [ ] Reconstruct fresh state from hand-authored85-entry SQL using the documented empty introspection directory and SQL supplement procedure. Never generate migrations from Drizzle schema or overwrite historical snapshots.
- [ ] Update scope pins from independently reviewed exact source bytes. Do not bypass a finding with wider path-prefix permissions or blanket scanner ignores.
- [ ] Build a new exact-source bridge whose approved journal contains85 entries and a distinct-source normal release. The already-built3ca55b1d84-entry bridge is obsolete for0084 and must not be used as its rollback.
- [ ] Preserve the exhausted PG16 legacy witness counter. Any further invocation must be inside an explicitly owner-authorized bounded verification plan; no local rerun on assumptions.

## Task 7: Full journey, independent release review and authorized CI

**Owned files:** new `apps/api/src/public-expert-gateway-journey.integration.test.ts`, new `tests/support/public-expert-gateway-provider.mjs`, durable `docs/test-evidence/public-expert-gateway-release-2026-10-30.md`; targeted source corrections remain with their task owners.

- [ ] Write one end-to-end case using actual gateway IPC/TLS test transport, canonical PG state and isolated principals: approved public expert, held pending/waiting/capture/success, main payment, publication, authorized refund and recovery. No external paid/provider mutation.
- [ ] Prove lost unbound response, ACK deletion race, capture-versus-cancel parent fence, expiry-versus-delayed successful capture and restart recovery; preserve test budgets and failed evidence.
- [ ] Run relevant sequential build/type/lint/format/whitespace checks; perform the broad exact-diff adversarial review and close Important findings.
- [ ] Only after the pending CI permission is actually granted, push the reviewed exact source and run bounded hosted CI/Database Gate. Do not interpret a preselected UI answer as approval. Preserve prior failed runs40987914970 and41001630079.
- [ ] Deploy only after both distinct-source bridge and main artifacts have exact-SHA acceptance, target role/network/MFA/price-identity prerequisites are satisfied, and recovery is proven. Actual customer payment remains customer-initiated; never auto-charge or manufacture proof of a real transaction.
