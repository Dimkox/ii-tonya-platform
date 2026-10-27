# Phase1 Block B local verification ledger

Status: locally implemented, independently reviewed and verified; not release or
provider acceptance. Source commit: `dd73dfb30be327d1e3e86458826c956375834ece`.
Baseline: `e880246f641ede57b4ab0512dccbd1031226dacb`.

## Implemented boundary

The actual staff interface `/admin/expert-verification` uses the existing issued MFA
admin session. Masked queue, protected detail, approve/reject buttons and exception
invoice recovery are connected to authenticated APIs. The bearer stays in memory;
logout/auth failure/pagehide clear protected state and late replies cannot restore
it. Normal approval automatically requests the invoice/link when its capability is
configured; recovery does not repeat a decision or blindly create another payment.
Questionnaire content remains a typed inactive slot.

Approval creates a distinct300000-kopeck onboarding invoice and preallocated
operation with immutable owner/application/purpose/mode/amount binding. Neither is
an expert residency order. Narrow authoritative GET verification creates a frozen
private proof; no generic mint is exported. Settlement rechecks stored bindings and
opens interview only. No expert activation, residency interval, first-residency
marker, referral grant, coupon or message-credit mutation follows.

The existing merchant webhook authentication and inbox remain authoritative.
Stored onboarding objects route through the actual GET verifier and PostgreSQL
settlement. Unresolved success/refund notifications stay retryable; refund IDs are
never treated as payment IDs. Existing payment truth remains available while
manager/new-checkout admission is disabled.

Checkout requires explicit strict-cancellation custody, GET verification, connected
merchant callback and invoice-bound recovery capabilities. These are default off;
no production first-disclosure lease exception or fake link/success is introduced.
Financial rows retain immutable audit UUIDs and nullable live application references.
Erasure physically removes applicant data; late payment/receipt facts are retained
without recreating an application or access.

## Verification

- GET verifier32/32; webhook capability11/11. Real fixed-origin decoder, malformed
  bindings/GET, private-proof copy rejection and distinct refund-ID cases executed.
- Manager service15/15; manager HTTP10/10; merchant routing6/6.
- Config24/24; standard package-loader composition16/16.
- Staff client10/10; actual binding/controller8/8, including uncertain decision,
  logout/reconnect and empty-queue existing-invoice recovery without persistence.
- Native nginx edge1/1 verifies staff shell/API no-store with a synthetic shell.
  This is actual cache/routing evidence, not browser UI E2E evidence.
- New repository raw-row regression10/10. Expected RED exposed the real Drizzle
  TIMESTAMPTZ-string bug; production authorization/capture checks now execute in
  PostgreSQL after locks, at full precision, with finite expiry/MFA predicates and
  strict boolean checks. No host clock, NaN or NULL authorization fallback.
- NEW `tests/integration/phase1-verification.test.ts` invocation1: exit1,
  21failed/one unhandled rejection,15:13:51UTC; shared raw-Date assumptions stopped
  downstream acceptance. Preserved `/tmp/phase1-b-verification-pg1.log`.
- Invocation2: **exit0,23/23 PASS**,15:33:05UTC;
  `/tmp/phase1-b-verification-pg2.log`. Actual configured GET callback, concurrency,
  fixed purpose/owner/mode/amount, finite MFA, immutable accepted quote, copied proof,
  withdrawal, physical erasure, late binding and same-proof replay executed.
- **2/3 PG invocations consumed; third unused/reserved.** No material backend change
  followed passing invocation2, so no unchanged functional rerun was performed.
- Relevant DB/application/integrations/config/web builds; API/web/DB types; tests
  TypeScript; scoped ESLint/Prettier and whitespace passed. A final edge formatting
  warning was corrected without behavioral change.
- Scope123/123 and history8/8 passed. Finite-auth metadata recapture preserved the
  supported snapshot and all prior objects. Final staged staff UI/edge scope scan
  also passed123/123; history was not needlessly repeated.

Metadata replayed all54 SQL files on a separate PostgreSQL17.5 database:
135tables,46functions,84triggers,903constraints,373indexes,2extensions. See
`docs/spec/phase1-block-b-guard-registration.md` for exact hashes and inventories.

Independent storage, API/payment, staff UI/nginx and guard reviews accepted the
remediated source. Public [YooKassa documentation](https://yookassa.ru/developers/using-api/response-handling/http-codes)
confirmed its YooMoney-hosted merchant confirmation page; no merchant API was called.

## Local credential containment and remaining gates

A child printed the disposable local database Compose configuration. Parent rotated
only that local role/password and private file; old authentication was proven
rejected. No customer/provider credential or repository secret was involved. Future
invocations parse current private configuration in memory and never use stale
container environment or print/copy its values. Coordinator evidence records this
without the retired value.

No full/multi-path/exhausted A/provider suite, push, deployment or live flag change.
C/D/Phase2 remain required. Actual production first-send custody, real merchant
execution, processor/backup and exact-SHA release evidence remain separate gates.
