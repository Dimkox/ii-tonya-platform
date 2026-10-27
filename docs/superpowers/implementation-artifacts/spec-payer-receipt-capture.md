---
title: Purchase-bound payer receipt contact capture
type: feature
created: 2026-10-12
status: in-progress
baseline_commit: d7ec2897462947e76bc4f258398b77817fe5900a
context: []
---

## Intent and authority

Implement authenticated payer-supplied receipt contact capture, encrypted storage,
immutable order selection and generic YooKassa contact-port retrieval. Do not
require OTP or a new consent checkbox. Later accepted DEC-PLT-004 section1 places
fiscal/payment processing on a non-consent basis; older YKP-015 describes a
consent-only source. Preserve that legacy source, but do not make it universal.
Never populate verified_at or fabricate consent for a browser-supplied address.
Owner delegated technical implementation; this does not certify legal/provider
activation or replace full commercial delivery.

## Boundaries

No production/provider calls, activation, secret printing or old exhausted tests.
Do not alter price/referral algorithms, balances or historical payer ownership.
No raw contacts in URLs, metadata, localStorage, analytics or logs. No migration
generator. New keys must be dedicated, not merchant/referral/callback keys.
Retention is explicit required configuration, no default: positive integer days
at most400, anchored to capture time. This implements the accepted artifact ceiling
without selecting a deployment retention policy. Missing key/retention disables
capture truthfully; deployment value remains a release decision. Unbound captures
are redacted when their quote becomes unusable; bound contact at configured expiry.
Keep minimal immutable audit metadata, never retain plaintext or reversible data
after redaction. Financial records/outcomes are not deleted by cleanup.

## Code map

- PostgresExpertCampaignOrderRepository.createCheckoutOrder in
  packages/db/src/repositories/expert-campaign-order-repository.ts owns serializable
  subject barrier, expert, quote, replay and reservation transaction. Validate
  selected contact before reservations; insert immutable binding with order.
- New capture repository and schema in packages/db, exported through DB index.
  New hand-authored0050_expert_receipt_contact_bindings.sql and journal idx50,
  recheck numbering before editing. Preserve SQL-only migration/state rules.
- New dedicated vault/contact source under packages/integrations/src/yookassa;
  generic YooKassaReceiptContactPort in operation-port.ts is the output boundary.
  Read booking-callback-vault.ts and environment-secret-resolver.ts for crypto/key
  patterns only. Leave consent-bound receipt source/repository unchanged.
- packages/contracts/src/expert-campaign-quotes.ts and application campaign
  service: strict opaque receiptContactId selection, capture service boundary.
- apps/api/src/routes/expert-browser-session.ts: new flat receipt-contacts POST
  under existing cookie/CSRF/raw-header/body-bound/no-store hooks.
- expert-campaign-composition.ts/server.ts/config: ordinary capture wiring and
  independently validated receipt keyring/retention, not unbound-recovery config.
- apps/web/src/expert-campaign-client.ts/view.ts: email input between saved quote
  and checkout, capture-then-checkout; preserve uncertainty/session fencing.
- Connected bounded cleanup in ordinary worker composition using same DB metadata;
  identify existing cleanup scheduling seam before edits, no new scheduler service.

## Required behavior

POST /v1/expert/browser/residency/receipt-contacts accepts only quoteId, email and
idempotencyKey; returns opaque receiptContactId, quoteId, expiresAt. Server derives
payer, capture time and versioned basis from authenticated session/accepted policy.
Validate email syntax/size, no ownership claim. Capture does not require checkout
provider presence. Same capture key and changed email conflicts; compare after
authorized decryption, never randomized ciphertext equality/public email hashes.

Capture metadata binds contact, quote, payer, kind, basis and timestamps through
AES256GCM AAD; random12-byte nonce/16-byte tag, bounded envelope/version and strict
allowlisted key IDs. Current key encrypts; retained keys decrypt old captures.
DB relationships enforce matching payer/quote/order; ciphertext can only undergo
controlled redaction, not arbitrary content replacement. Multiple captures allow
correction before checkout; a submitted checkout retains its exact contact/key.

Checkout without required contact or with foreign/expired/redacted capture fails
before order/reservation writes. Existing replay uses original immutable binding;
different selected contact with same checkout key conflicts. Never choose latest
contact or expert's mutable owner. Generic port decrypts only bound valid contact.
Source gives opaque server authority reference, no invented verification status.

UI label Email для чека, no OTP/consent entrance. Clear plaintext on logout/disposal;
freeze capture ID and command after uncertain checkout. Missing capability renders
unavailable honestly. Preserve current provider-absent zero-reservation behavior.

## Execution decisions and ownership

Follow docs/superpowers/plans/2026-10-12-payer-receipt-capture.md. One implementer
owns only the code map, files below, migration artifacts and own evidence file
docs/test-evidence/payer-receipt-capture-2026-10-12.md. No nested agents, commits,
pushes, installs or unrelated edits. Coordinator owns shared status/runbooks.

Schema: packages/db/src/schema/payer-receipt-contacts.ts and schema/index.ts.
Repository: packages/db/src/repositories/payer-receipt-contact-repository.ts.
Cleanup hooks: apps/worker/src/runtime.ts processorPrivacy cycle and main.ts;
new optional payerReceiptRetention BoundedJob invokes redactExpiredBatch(100).
Include it in cycle's no-capability condition/results. Compose cleanup regardless
of capture flag/key/provider availability. Serialize cleanup/binding on contact row.

Config: PAYER_RECEIPT_CAPTURE_ENABLED=false by default; required explicit
PAYER_RECEIPT_RETENTION_DAYS integer1..400, PAYER_RECEIPT_ACTIVE_KEY_ID and
PAYER_RECEIPT_KEYRING_REF=env://PAYER_RECEIPT_KEYS_JSON. RuntimeConfig carries
only reference/id/days; raw dedicated32-byte keys stay in process environment.
Strict duplicate-free keyring IDs/canonical base64url. Missing enabled config
means unavailable; malformed supplied config sanitized error. .env.example uses
empty placeholders. Cleanup uses persisted timestamps, never runtime keys/days.

Keep legacy checkout schema/service/repository entry points for existing controlled
callers; add strict payerReceiptCheckoutRequestSchema and distinct receipt-required
service/repository createCheckoutOrderWithReceipt. Share transaction internals,
but no default bypass boolean. Ordinary real-provider API composition must select
receipt-required path for BOTH browser and bearer routes, never legacy fallback.
No-contact historical order replay must not acquire invented contact or call provider.
Synthetic legacy injections retain their tests; new tests prove ordinary no-bypass.

Additional owned files: new application capture/required-checkout service modules,
new integrations payer-receipt-vault.ts/source.ts, corresponding package exports,
new API payer-receipt-composition.ts and targeted bearer-route contract dispatch.
Read existing files before picking exact exports; preserve architecture direction.
New test files exclusively: packages/integrations/src/yookassa/payer-receipt-vault.test.ts,
packages/config/src/payer-receipt-config.test.ts, apps/api/src/payer-receipt-production.test.ts,
tests/integration/payer-receipt-capture.test.ts, apps/web/src/payer-receipt-browser.test.ts.

## Acceptance and verification

Given owned saved quote, when authenticated capture and checkout complete, then
real DB binding and generic port return the selected contact and no other payer's.
Given altered ciphertext/AAD/key, foreign payer, expired quote or redacted contact,
when selection occurs, then no provider disclosure or new financial write occurs.
Given retries/changed contact, when original order exists, then its binding remains
unchanged. Given retention expiry, bounded cleanup destroys ciphertext without
rewriting order/ledger facts. Given logout during capture, no late private state
returns. Given missing key/retention, ordinary startup stays truthful and safe.

Each new file authorRED1/GREEN2, coordinator3 after independent review. Record
every invocation immediately, including collection errors. No full/multi-path
suites or old exhausted reruns. Isolated PG17.5 only; preflight RequireDocker.
Synthetic HTTP/keys, actual DB capture/binding/cleanup and Chrome interactions;
no live credentials. Read TDD instructions; write all behavior tests first and
typecheck before RED. Build affected packages sequentially. Run focused types,
lint/format/diff. Hand-author migration metadata per repository state rules; do
not silently omit snapshot/state evidence or run exhausted guards. Report exact
remaining migration checks for coordinator. Stable handoff has hashes/results/
run allocations and explicit limits. No capture/provider activation is authorized.
