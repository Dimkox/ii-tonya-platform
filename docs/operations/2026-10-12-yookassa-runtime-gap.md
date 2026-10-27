# YooKassa runtime and receipt activation gap — 2026-10-12

Read-only credential discovery and source trace for the commercial-product goal.
No credential values, provider payloads or customer records were printed. No
merchant request, payment, refund, flag change or production deployment occurred.

## Configuration evidence

The repository-local .env contains merchant shop/key/reference, mode, HTTPS return
URL and fiscal VAT/subject/mode values. A pure loadEnv check with activation flags
set only in an in-memory object accepted their schema and reported mode=live.
This proves configuration shape, not merchant authentication, legal approval or
provider readiness. Do not create synthetic test payments with these live inputs.
No alternate test-shop credential was established.

The dedicated server's runtime.env has none of those YooKassa inputs populated.
Parsing it in memory reported presence/absence only. This is a deployment gap,
not evidence that the owner has supplied no merchant credentials.

Both inspected locations lack YOOKASSA_RECEIPT_CONTACT_CONSENT_PURPOSE and
YOOKASSA_RECEIPT_CONTACT_POLICY_VERSION. The inspected recovery encryption
reference is also empty. The approved contact source, purpose/policy, key resolver
and capture mechanism cannot be inferred from the shop secret. Owner was asked
for the governing document/source, not for a password. Keep example values empty.

## Receipt authority correction verified locally

Before correction, PostgresYooKassaReceiptContactAuthority.latestForOrder joined
only the contact's original consent row; a later withdrawal/policy replacement
was invisible. It also followed the expert's current owner even for a campaign
order whose saved quote identifies its original payer. The bounded correction is
specified in spec-receipt-contact-authority-fix.md under implementation-artifacts.
This is required by existing YKP-015, not a new written-consent entrance gate.

Final reader correction: coordinator session89476 passed26/26 after independent
source review and final input-validation correction. Three-run budget exhausted.
This checks current authority at read time, not outbound admission linearization.

Contact capture/verification and encryption remain separate missing functions.
No existing reader, non-null verified_at, shop secret, owner email or Telegram
account identity proves a verified receipt address. Legacy orders lack an
immutable historical payer snapshot; do not silently invent one on activation.

## Ordinary process composition remains incomplete

1. API default lifecycle now composes expert saved-quote commands but supplies no
   checkout provider. It correctly returns503 before creating an order/reservation.
2. Default API still does not construct YooKassa client, operation repository,
   consent-bound decryptor/source, payment adapter, verifier, webhook capability
   and canonical settlement/reversal delivery. app.ts requires exact agreement
   among feature flag, payments flag, provider config and webhook capability.
   Retain that guard; do not insert a stub merely to start the process.
3. Trusted peer extraction is required behind nginx. The route accepts a trusted
   effectivePeerAddress dependency; a public caller's forwarded header is not
   provider authentication. Provider GET verification remains mandatory.
4. Worker default factory now constructs the real client/verifier/inbox and bound
   recovery runner without an injected reader. Optional terminal auditing uses a
   guarded-client factory; unsafe enabled legacy reader injection is rejected.
5. Bound pending/unknown recovery now claims at most25 operations per cycle,
   filters mode before LIMIT, verifies exact objects and commits canonical events
   before resolving operations. Coordinator final tests passed17/17 unit and30/30
   PostgreSQL after independent review; see yookassa-bound-runtime-2026-10-12.md.
   This is candidate-local evidence, not deployment or fresh checkout authority.
   The unbound recovery path remains separately default-off and requires exact-body
   encryption/policy inputs.
6. API readiness currently regards adapters as ready only when integrations are
   all disabled. Real provider composition must supply truthful capability
   readiness while retaining unrelated fail-closed ceilings; do not return a
   blanket true or equate construction with a successful merchant exercise.

## Required integration proof

With synthetic credentials and an injected recording transport only: saved quote
to immutable order; stored cash to provider request; verified contact and policy;
exact idempotent replay; authoritative GET to canonical settlement; duplicate
webhook/worker interleaving; unavailable/revoked contact gives zero provider I/O;
pending/unknown outcomes survive restart and are not guessed as failure/success.
Verify the ordinary API and worker factories, not only standalone adapters.

Real test-shop/receipt/webhook evidence, current fiscal/contact policy and a
reviewed target configuration remain activation inputs. Existing financial87,
auth PG/browser and campaign API corrected assertions remain separately unrun
pending explicit extra-run permission. This source trace does not close them.

## Default composition preconditions confirmed after reader correction

RuntimeConfig carries the YooKassa secret reference, not its value. The standard
runtime must resolve only that approved reference from process environment, with
synthetic injection for tests and no logging. Current loadEnv validates merchant
and fiscal shape but only validates/returns contact purpose/policy inside enabled
UNBOUND recovery; ordinary checkout must not mistakenly treat that recovery object
as its contact configuration. Receipt selection and key resolution need their own
explicit runtime capability independent of unbound replay.

The existing adapter reads/decrypts contact before claiming an operation and then
performs POST. That does not fence revocation between lookup and network admission.
Its unbound operation path also needs exact-body replay admission/expiry review
before live checkout; worker bound-GET recovery does not authorize a fresh POST.
The current source decryptor contract carries ciphertext and keyReference only;
new capture encryption must bind the authoritative subject/contact context and
must not mark an unverified browser email as verified automatically.

Current expert browser account only exposes session login/logout, not a saved-quote
purchase UI. The bearer campaign API exists but no browser-cookie/CSRF checkout
facade is composed. Ordinary Telegram expert composition remains injection-only.
These are actual product gaps, not resolved by a web bundle compiling.

The private imported source tab named OФЕРТА - заменить на сайте!! was inspected
for a receipt policy; it describes payments but does not supply the missing explicit
receipt-contact purpose/version or verified source. Existing public policy only
mentions contact data for contract execution. No approval was inferred from that.
The published offer also retains older tariff/month-only wording; reconcile it
with accepted decisions before offering current one/three-month paid checkout.
