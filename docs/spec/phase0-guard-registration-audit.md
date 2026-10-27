# Phase0 guard registration audit — 2026-10-23

Baseline: `ece006aa03b035db770a04dbea1e843a96cb10cc`.
This reconciles named, already committed features with stale scope inventories.
Registration grants no provider, financial, migration or deployment authority.
The helper stores literal normalized SHA256 values; it never learns approvals
from scanned paths or content. CRLF/CR normalizes to LF before hashing.

## Migration inventory

Each row registers the named SQL, `meta/NNNN_snapshot.json`,
`state/NNNN_manifest.json` and `state/NNNN_sql_objects.json`: 36 exact artifacts.
SQL and reconstructed snapshot/state bytes are unchanged. Existing frozen missing
snapshot and bigint-default inventories remain unchanged.

| SQL                                        | Added relations                                                                                                                                                             | Canonical contract and evidence                                                                                                                                                                  | Preserved invariant / evidence limit                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0042_client_paid_orders.sql`              | `client_paid_orders`, `client_paid_payment_bindings`, `client_coupon_grants`, `client_paid_settlements`                                                                     | [spec](../superpowers/implementation-artifacts/spec-client-paid-settlement.md), [evidence](../test-evidence/client-paid-settlement-2026-10-10.md)                                                | Immutable client purchase terms and atomic grants; repository evidence does not authenticate provider truth or implement client checkout.            |
| `0043_planerka_booking_operations.sql`     | `planerka_service_mappings`, `planerka_booking_operations`, `planerka_account_requests`, `planerka_legacy_booking_reviews`                                                  | [spec](../superpowers/implementation-artifacts/spec-planerka-booking-workflow.md), [evidence](../test-evidence/planerka-booking-workflow-2026-10-12.md)                                          | Durable unknown outcomes; only bound provider completion confirms booking. No real inventory/provider acceptance follows.                            |
| `0044_booking_notification_delivery.sql`   | `booking_notification_contexts`, `booking_notification_deliveries`, `booking_notification_attempts`, `booking_notification_attempt_facts`, `booking_notification_callbacks` | [spec](../superpowers/implementation-artifacts/spec-booking-notification-delivery.md), [review evidence](../test-evidence/booking-notification-t2-review-2026-10-12.md)                          | Original recipient/consent binding, immutable attempt facts, no automatic uncertain resend; historical fixture changes remain explicitly unexecuted. |
| `0045_booking_notification_controls.sql`   | `booking_notification_bot_controls`                                                                                                                                         | Same booking delivery spec; [wire evidence](../test-evidence/booking-notification-wire-admission-2026-10-12.md), [runtime evidence](../test-evidence/booking-notification-runtime-2026-10-12.md) | Exact admitted wire and shared pause/throttle; synthetic journey is not independent live end-to-end acceptance.                                      |
| `0046_booking_handoff_revocation.sql`      | `booking_handoff_revocation_receipts`                                                                                                                                       | Same booking delivery spec; [revocation evidence](../test-evidence/booking-handoff-revocation-2026-10-12.md), [runtime evidence](../test-evidence/booking-handoff-runtime-2026-10-12.md)         | Append-only revocation accounting; no claim of remote deletion or recipient reading.                                                                 |
| `0047_expert_campaign_quotes.sql`          | `expert_campaign_anchors`, `expert_campaign_quotes`                                                                                                                         | [API spec](../superpowers/implementation-artifacts/spec-expert-campaign-api.md), [API evidence](../test-evidence/expert-campaign-api-2026-10-12.md)                                              | Saved server-owned quotes, immutable source and no caller pricing authority; provider-absent checkout remains unavailable.                           |
| `0048_expert_campaign_orders.sql`          | No new relations                                                                                                                                                            | [checkout spec](../superpowers/implementation-artifacts/spec-expert-campaign-checkout.md), [evidence](../test-evidence/expert-campaign-checkout-2026-10-12.md)                                   | Unique quote consumption, frozen price/split/term, legacy history preserved; local storage verification is not activation.                           |
| `0049_expert_sessions.sql`                 | `expert_sessions`, `expert_identity_proof_receipts`                                                                                                                         | [entry spec](../superpowers/implementation-artifacts/spec-expert-authenticated-entry.md), [evidence](../test-evidence/expert-authenticated-entry-2026-10-12.md)                                  | Separate expert proof/session purpose and revocation; no expert creation or client-token promotion.                                                  |
| `0050_expert_receipt_contact_bindings.sql` | `payer_receipt_contacts`, `payer_receipt_order_bindings`                                                                                                                    | [capture spec](../superpowers/implementation-artifacts/spec-payer-receipt-capture.md), [evidence](../test-evidence/payer-receipt-capture-2026-10-12.md)                                          | Purchase-bound encrypted receipt contact, controlled redaction, immutable binding; no invented verification or consent.                              |

Total: 21 named relations. SQL0050's exact function inventory gains
`payer_receipt_redaction_due`, `protect_payer_receipt_binding`,
`protect_payer_receipt_contact`; exact trigger inventory gains
`payer_receipt_binding_guard`, `payer_receipt_contact_guard`. Equality assertions,
not subset tests, remain in force.

## Authenticated routes and receipt modules

Eight literal routes are registered:

- `/v1/expert/browser/session`
- `/v1/expert/session`
- `/v1/expert/sessions`
- `/v1/expert/sessions/current`
- `/v1/expert/browser/residency/tariffs`
- `/v1/expert/browser/residency/quotes`
- `/v1/expert/browser/residency/checkouts`
- `/v1/expert/browser/residency/receipt-contacts`

Entry, campaign API and capture contracts/evidence linked above govern these
routes: distinct expert sessions, cookie/CSRF/origin fences, no-store, strict
request schemas and server-owned identity/amounts. Registering route names does
not replace authentication tests or enable provider composition.

The two new exact integration paths are
`packages/integrations/src/yookassa/payer-receipt-source.ts` and
`packages/integrations/src/yookassa/payer-receipt-vault.ts`, governed by the capture
contract. Source maps exceptions to absent contact; the vault authenticates the
capture/quote/payer/basis/timestamps as AES-GCM AAD using dedicated bounded keyrings.
Their exact hashes are pinned; sibling modules remain forbidden.

## Previously registered content changes

Five stale content hashes are replaced with literal hashes of reviewed source:

| Path                                                    | Canonical source of change                                                                                                                                                           | Invariant and limit                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `packages/integrations/src/index.ts`                    | Capture spec/evidence                                                                                                                                                                | Explicit receipt vault/source exports; no internal mint export.                                                  |
| `packages/integrations/src/yookassa/operation-port.ts`  | Capture and [first-send spec](../superpowers/implementation-artifacts/spec-payment-first-send-admission.md), [evidence](../test-evidence/payment-first-send-admission-2026-10-13.md) | Opaque receipt authority and durable first-send capability; interfaces do not prove production execution.        |
| `packages/integrations/src/yookassa/payment-adapter.ts` | Same first-send and capture contracts/evidence                                                                                                                                       | Consume initial-send authority before POST, preserve unknown outcomes; no blind unbound retry.                   |
| `scripts/deploy-native-remote.sh`                       | [recovery spec](../superpowers/implementation-artifacts/spec-native-cutover-recovery.md), [evidence](../test-evidence/native-cutover-recovery-2026-10-13.md)                         | Quiescent bounded cutover/recovery, preserve uncertain artifacts; local shims are not target release acceptance. |
| `scripts/migrate-native.mjs`                            | Same recovery contract/evidence                                                                                                                                                      | Migration-only timeout bounds and sanitized failure; no SQL rollback claim from process exit.                    |

## Internal verifier authority

[Authority companion](../superpowers/implementation-artifacts/spec-phase0-verifier-authority.md)
separates the shared WeakSet/validated mint implementation into
`packages/integrations/src/expert-residency/verified-event-internal.ts`.
Only public `expert-residency/verified-event.ts` and authoritative
`yookassa/verifier.ts` may import it. Internal/public implementation content is
pinned. The verifier hash is updated only after independent review of stable source.
The worker receives no generic mint exception. Existing canonical factory
production ban and sandbox exceptions remain intact.

The recursive production classifier rejects internal module imports/reexports,
dynamic import/require, primitive imports/aliases, namespace property/element
access and barrel exposure outside trusted implementations. Unknown relation,
route and provider sibling probes and modified approved-content probes remain
negative. Local static checks and focused probes do not certify provider execution,
Database Gate, hosted CI, a release SHA or deployment readiness.

## Local verification

Environment preflight passed Node24.22.0/pnpm11.9.0. New focused probe file first
ran RED (10 failed/6 passed), then GREEN16/16. Expanded focused final GREEN passed25/25 at13:53UTC.
Constant/concatenated/template module names resolve before classification; unresolved
runtime module imports fail closed. Production source inspection found no executable
dynamic imports/require calls, so this adds no known production false positive.
Literal safe public runtime imports remain accepted. Additional alias-path RED
was5failed/20skipped. Scoped ESLint, tests TypeScript and whitespace checks passed;
final checks are reported to the coordinator. A reviewer-requested ImportEquals probe reproduced an additional focused RED
(1 failed/18 skipped), followed by explicit external-module-reference detection.
Existing scope/history REDs are owned
by the coordinator; final stable-tree scope/history execution remains theirs.
No PostgreSQL, exhausted provider test, migration generation, push or deployment.

Review also reproduced six Node loader alias bypasses (focused RED6failed/25skipped).
Recursive loader classification now follows `require`, `module.require`,
`globalThis.require`/`global.require`, `createRequire` named/default/namespace imports,
constant/chained aliases, destructured factory bindings, namespace module loads and
immediately invoked factory returns. The first loader GREEN attempt retained the
six failures because its call-site hookup was missing; after correction GREEN31/31
passed. Expanded destructuring/shadow support then passed32/32. The final standard
Node forms and current source are covered by the stable37-case focused check.
Literal safe public loads remain accepted. No generic worker mint exception exists.

A final edge review found nested destructured factories were absent from the
former top-level binding lookup. The nested function probe reproduced RED
(1failed/38skipped; the targeted pattern selected the function case). Binding
collection now uses the recursive walk, retaining every potential factory
initializer conservatively instead of accepting a shadowed binding as safe.
Both nested function and block probes are included in the final39-case check.

The coordinator's recursive scan identified two legitimate unresolved imports
outside application/package source: `scripts/verify-client-web-account-browser.mjs`
and `scripts/verify-public-client-catalog-browser.mjs`. They run real DOM/fetch
checks against loopback synthetic data and load an existing Playwright installation
using `PLAYWRIGHT_MODULE_PATH` through `pathToFileURL(resolve(...,"index.mjs"))`.
No dependency installation or script change is made. Exactly these two paths and
literal normalized content hashes permit unresolved runtime loader arguments;
all internal-module/primitive checks still run. The same hashes participate in
approved-content verification. Original-source positive probes, modified-source
and injected-internal-import negatives, and an unknown-sibling negative are in
the focused file. Initial harness probes were RED2failed/39skipped.
