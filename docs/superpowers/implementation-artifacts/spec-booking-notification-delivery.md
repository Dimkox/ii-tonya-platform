---
id: SPEC-booking-notification-delivery
title: "Production booking notification delivery"
type: "feature"
created: "2026-10-12"
status: "in-progress"
baseline_commit: "690797db64fd80aa1aeccea8003543de470d8c16"
implementation_dependency: "Uncommitted calendar0043 candidate; coordinator/Hubble closure required"
context:
  - "{project-root}/docs/superpowers/implementation-artifacts/spec-planerka-booking-workflow.md"
  - "{project-root}/docs/runbooks/planerka-api-client.md"
  - "{project-root}/_bmad-output/specs/spec-production-completion-2026-10-12/update-4-reconciliation.md"
  - "{project-root}/_bmad-output/specs/spec-owner-update-2026-09-16/decision-register.md"
  - "{project-root}/_bmad-output/specs/spec-owner-update-2026-09-16/evidence/DEC-PLT-004-rule.md"
companions: []
---

# Booking notification delivery — design and implementation plan

> Coordinator accepted the dedicated-ledger architecture for incremental development,
> not human acceptance or activation. T1 presentation is reviewed. Current assignment
> is T2 plus the T1 DB resolver, as specified below. No commit/deploy or exhausted-test reruns.

## Current execution assignment — coordinator2026-10-12

**Continuation override at17:16UTC:** T2firstfixbatch passed scoped independent
re-review(P1–P8/V1–V4), then coordinator finalPG run3 passed70/70 at17:15:32UTC.
T2logicalfile now3/3EXHAUSTED. T2implementation assignment below is historical,
not permission to repeat it. Next is T3atomic issuance/consumption/API integration.
Pure callback vault and TelegramHTTP transport have separate local reviewed tests;
neither is wired into production. Parent spec remains in-progress. Cross-task
findings stay in docs/test-evidence/booking-notification-t2-review-2026-10-12.md.

Calendar legacy P2 is fixed, reviewed and behaviorally verified7/7 in existing
migration-state test run2/3. Both design findings (immutable destination tuple;
fresh post-lock callback clock) were corrected and independently accepted in spec.

Current work is the P1–P8/V1–V4 fix batch from
`docs/test-evidence/booking-notification-t2-review-2026-10-12.md`, on the same T2
candidate and owned files. Add assertions before code; no tests or nested agents.
Run3 is exclusively coordinator-owned after scoped review. Reconstruction on
isolated PostgreSQL17.5 and scoped static checks are allowed. T2 is not accepted.
The initial assignment was T2 plus T1 database recipient resolver; migration0044
was reserved when the journal ended43 and no0044files existed. Own the new DB
ledger/resolver/schema/test, migration/journal/state, necessary DB exports and
existing reservation/expiry/Planerka producer/privacy capture changes. Preserve
all prior SQL and unrelated edits. Do not edit integrations/selarti or its barrel:
another agent owns isolated Selarti regression/documentation preparation.

No T3 callback, HTTP sender or runtime activation yet; these are subsequent tasks,
not removed requirements. No commit/push/deploy/provider calls. New genuine
tests/integration/booking-notification-delivery.test.ts: maximum3focused runs,
Initial behavioral RED was observed; current file budget is2/3, with run3 reserved.
Compileable scaffolds are allowed to avoid missing-import collection failures.
Existing exhausted calendarworkflow3/3 and transport6runs must not run. Existing
renderer2/3 and migration-state2/3 remain unchanged unless separately assigned.
No full/multi-path suite. Return actual implementation/evidence, not interface stubs.

**Goal:** Deliver real expert approval requests and truthful booking lifecycle
notifications without leaking consultation/contact data or duplicating uncertain sends.

**Architecture:** PostgreSQL records recipient-bound notification intents alongside
booking events. A dedicated bounded worker owns their delivery attempts; authenticated
expert callbacks feed the existing transactional booking service. The calendar worker
alone establishes external booking success. Neither outbox publication nor Telegram
acceptance is evidence that the human read a message.

**Tech stack:** Existing TypeScript, Node24, pnpm11.9.0, PostgreSQL17.5,
hand-authored SQL migrations, existing Telegram transport interfaces and Fastify.
No new broker, LLM, Make/Sheets authority, or payment dependency.

## Why

The calendar candidate publishes durable booking events but no production component
delivers them. Its expert approval cannot be reached through a working production
inline-button flow: `apps/api/src/server.ts` still installs disabled booking ingress
and callback services. Adding a text sender alone would not close this gap.

## Capabilities

- **CAP-1 — Expert decision.** Intent: the assigned expert receives a minimal request
  with confirm/cancel buttons. Success: only the bound expert, private chat and bot
  can consume one current callback; confirm records calendar-pending, never booked.
- **CAP-2 — Lifecycle delivery.** Intent: each entitled recipient receives the relevant
  current booking state. Success: all eight reservation lifecycle topics below have
  real consumers with durable delivered/suppressed/failed/unknown evidence.
- **CAP-3 — Safe authority.** Intent: personal information reaches only authorized
  recipients. Success: DB identity, consent and current-state checks precede every
  network attempt; no diagnosis, note, contact, early meeting URL or cross-bot leak.
- **CAP-4 — Uncertain outcomes.** Intent: recovery does not duplicate a possibly sent
  notification. Success: after-write timeout/crash never schedules another send;
  definite non-delivery can retry within durable bounds; unknown work reaches an operator.
- **CAP-5 — Real composition.** Intent: production runs these paths with recoverable
  shutdown/rollback. Success: the actual API/worker entrypoints instantiate the real
  transport, authenticated callback handler and repositories, or fail closed at startup.

## Constraints and non-goals

- Preserve the calendar order: local request → expert approval → external creation →
  verified UID/booked commit → client notification. Notification failure must not undo
  a genuine external booking or cause a second calendar POST.
- Ordinary explicit, purpose-specific consent stays in place. No written signing,
  signature provider, blanket “continue means consent”, or new start-route gate.
- Update4 reiterates direct payment to experts, minimum handoff data, no diagnosis
  or raw-dialogue retention. This feature neither collects payments nor determines
  prices/refunds/coupons. `charge:0` in existing events is not evidence of payment,
  a zero-priced consultation, or a refund. DEC-FIN010/floor5000 are outside scope.
- Keep real inventory empty until genuine inventory is supplied. No demo conversion.
- Do not reuse Telegram `idempotencyKey` as a claimed provider deduplication guarantee.
- No clinical follow-up/feedback campaign, manager-meeting reminders, marketing,
  contact exchange, arbitrary expert notes, or platform checkout in these templates.
- All new names below are **proposed**, not assertions that columns/capabilities exist.
  No calendar/reviewer-owned code is changed by this design.
- No tests, provider calls, commits or deployment in this planning turn. Calendar
  workflow3/3 and the current multi-path budget are exhausted; no renamed substitutes.

## Existing code and authority — verified by source inspection

| Source                              | Actual fields/capability                                                                                                                                                                                | Limitation relevant to this design                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema/booking.ts` | `reservations.id,user_id,expert_id,expert_service_id,slot_id,status,version,reserved_until,meeting_url`                                                                                                 | No recipient, bot, consent snapshot, delivery status or Telegram message ID on reservation                                               |
| Same file                           | `notifications.reservation_id,idempotency_key,callback_token_hash,callback_claims,callback_expires_at,callback_expert_id,callback_action,callback_version,callback_consumed_at`                         | Callback registry, not a delivery ledger; no bot/chat binding or recoverable raw token                                                   |
| `schema/catalog.ts`                 | `experts.user_id,active,verified`; service ownership; `slots.starts_at,ends_at,observed_at`                                                                                                             | No `experts.telegram_id`, `slots.timezone`, or `expert_services.format` column                                                           |
| `schema/identity.ts`                | `users.active`; `channel_identities.id,user_id,provider,external_id,bot_key,external_chat_id,status`                                                                                                    | Bot/chat nullable for legacy identities; uniqueness does not establish a single destination per user/bot                                 |
| Same file                           | `client_profiles.display_name,timezone,expert_note`                                                                                                                                                     | Do not select these for minimal notification text; notes are forbidden in Telegram even with a grant                                     |
| Same file                           | `consents.id,user_id,consent_type,decision,policy_version,sequence,channel,scope_fields,document_version_id,presentation_id,prior_decision_id,recipient_id,reservation_id,text_sha256,basis,created_at` | No `decided_at`, `evidence_uri`, `recipient_disclosed_name`, or `withdrawn_at` column; policy prose listing these is not schema evidence |
| Same file                           | `consent_states(user_id,purpose).last_decision_id,revision,decision,document_version_id`; document/presentation evidence tables                                                                         | Projection is a fence, not the sole consent oracle; handoff projection is per user/purpose, not per reservation                          |
| `schema/integration.ts`             | `integration_outbox` topic/payload/hash, idempotency key, dispatch/reconciliation claims, leases, attempts; `delivery_attempts`                                                                         | Generic attempts have no durable `provider_operation_id`; runner ignores `DispatchOutcome.providerOperationId` when calling `succeed`    |
| Same file                           | `dialogues.user_id,provider,bot_key,external_chat_id,tenant_key,next_delivery_sequence`; `outbox_operator_alerts`                                                                                       | Dialogue sequencing exists for `telegram.send_text.v1`, not booking topics                                                               |
| Calendar0043                        | `planerka_booking_operations.reservation_id,provider_uid,state,cancel_requested,request_fingerprint`; `planerka_legacy_booking_reviews`                                                                 | Bound provider completion is the confirmation authority; unresolved legacy review is not proof of cancellation                           |

Relevant implementations read:

- `packages/integrations/src/telegram/callback-token.ts`: `ct2.` opaque tokens,
  random128-bit nonce, truncated128-bit HMAC, max64 UTF-8 bytes, minimum32-byte secret;
  `issueCallback`, `authenticateCallback`, and separately consuming `verifyCallback`.
- `packages/db/src/repositories/telegram-callback-repository.ts`: issuance bounds
  confirm expiry to `reserved_until`; checks ownership, version, active/verified
  expert, future/fresh slot and active service. Token hash alone cannot reconstruct
  the wire token after a crash.
- `booking-repository.ts::transitionFromTelegramCallback` consumes callback and
  changes reservation/publishes in one transaction. Use it through
  `createBookingService`; do not consume via `verifyCallback` before transitioning.
- `client-consent-authority.ts`: document-table/subject barriers,
  `captureClientConsentAuthority`, `validateClientConsentAuthority`, one-use dispatch
  receipt. `originalClientConsentSql` validates original decision+revision against
  journal, approved document and consumed presentation. A later grant cannot revive
  old work. Existing authority type supports `client_messaging` and optional
  `selarti_ai_processing`, not `expert_handoff`.
- `outbox-repository.ts`, `worker/outbox-runner.ts`, `telegram-send-text-dispatcher.ts`:
  topic allowlists, metric enums, dialogue/source validation and admission only know
  the existing local/catalog/client-async groups. Booking JSON is not a valid
  `telegram.send_text.v1` payload. Its current reconciler returns `still_unknown`.
- `apps/worker/src/main.ts`: actual factory supplies local/catalog registry only;
  no real Telegram HTTP transport is instantiated there for booking. Runtime has
  `clientAsyncOutboxRunner` and `planerkaBookingRunner`, no booking delivery job.
- `apps/api/src/routes/telegram-webhook.ts`: shared-secret verification and inbox
  exist, but generic callbacks are verified before final inbox claim; missing
  callback chat is currently tolerated. New booking callbacks require explicit
  private chat and bot-scoped replay handling, not this permissive fallback.
- `privacy-repository.ts`: `booking.handoff_revoked` has subject+consent decision,
  not reservation/expert/chat. Follow-up withdrawal deletes specific callback rows;
  this is not a general notification cancellation/erasure mechanism.

## Architecture choice

1. **Recommended: separate booking intent/attempt tables and bounded runner.** Reuse
   proven fencing, consent barrier and transport patterns, but keep event processing
   and external delivery distinct. Supports approval buttons and state-bound sends
   without weakening generic chat authority or serializing unrelated conversations.
2. Extend `telegram.send_text.v1`/`dialogue_deliveries` with booking variants. This
   requires widening source validation, sequencing, consent types and payloads used
   by existing chat; a message-only patch would bypass necessary booking checks.
3. Send directly inside booking transactions/webhooks. Rejected: network side effects
   cannot roll back with SQL, and webhook retries would duplicate messages.

The selected runner owns only an explicit booking topic set. It does not install a
no-op dispatcher or broaden `PostgresOutboxRepository` to claim every topic. A source
event may be marked processed only with persisted delivery intents or an explicit
suppression/quarantine reason in the same transaction. “Processed” is not “delivered”.

## Topic and current-state matrix

Never trust payload recipients, arbitrary text, URLs, consent assertions or charges.
Accept only the exact known producer shape; resolve source reservation and related
rows again. Normal booking events contain `reservationId,action,decision,version,charge`;
expiry-worker events contain `reservationId,version,charge`; Planerka completion/rejection
contains only `reservationId,charge`. Preserve this distinction; do not invent an
event version for provider events. Bind those to the operation ID in the durable
source idempotency key and verify that operation belongs to the reservation.

| Existing topic                 | Recipient and factual template                                                                                                                      | Required state at last admission                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `telegram.reservation_request` | Assigned expert: “Новая заявка на {UTC time}. Клиент. Подтвердить / Отказать.” Two inline buttons                                                   | `reserved`, exact event version, unexpired hold, slot future/fresh, service/expert eligible, no provider operation yet                                                                                |
| `client.booking_confirmed`     | Reservation client: “Запись подтверждена на {UTC time}.” No payment claim or meeting URL                                                            | `booked`, matching verified operation in `booked`, non-null UID, `cancel_requested=false`, event tied to that operation                                                                               |
| `telegram.booking_cancelled`   | Assigned expert: client cancelled locally; distinguish pending external cancellation                                                                | `cancelled_by_client`; matching source version; never treat completed/no_show as cancellation                                                                                                         |
| `client.booking_cancelled`     | Reservation client: expert cancelled locally; distinguish pending external cancellation                                                             | `cancelled_by_expert`; matching source version                                                                                                                                                        |
| `client.reservation_expired`   | Client: local reservation expired; choose another slot through authenticated catalogue                                                              | `expired`; worker/domain version must match or provider rejection must be bound to its operation                                                                                                      |
| `expert.reservation_expired`   | Assigned expert: request expired; old buttons unavailable                                                                                           | `expired`, matching source version                                                                                                                                                                    |
| `client.booking_completed`     | Client: “Встреча отмечена как завершённая.” No feedback/promo/refund promise                                                                        | `completed`, matching source version; this is a local status, not newly proved provider success                                                                                                       |
| `client.booking_no_show`       | Client: “Встреча отмечена как несостоявшаяся.” No penalty/payment/medical inference                                                                 | `no_show`, matching source version                                                                                                                                                                    |
| `booking.handoff_revoked`      | Local control: invalidate optional disclosure intents; notify only previously recorded actual recipient where a scoped disclosure requires deletion | Validate `userId,consentDecisionId,purpose` against journal; enumerate delivery evidence, never guess recipient from latest expert                                                                    |
| `booking.start`                | Local navigation intent, not a booked/reserved fact; no lifecycle notification                                                                      | Existing conversation payload has only `expertId`; no authenticated subject/reservation binding. Keep outside sender allowlist; navigation owner must supply a separate authority-preserving consumer |

For pending/unknown/manual provider cancellation or unresolved legacy cancellation,
say “Локальная запись отменена; отмена в календаре ещё не подтверждена”, not “отменено
везде”. On completion of provider compensation, existing code emits no separate
confirmation event: a polling wake-up may deliver the unsent cancellation using the
new state, but do not invent a second “external cancellation complete” notification.
Provider rejection currently publishes client expiry only. Mirror expert expiry
would require an explicit producer change; do not silently fabricate its event.

Stale requests/confirmations are `suppressed:state_superseded`, not successful sends.
Terminal completed/no_show rows retain their real meaning even with unresolved legacy
review. A cancellation request that commits after send admission cannot unsend a
message already in flight: subsequent authoritative cancellation must still be
delivered. Do not claim cross-system atomicity or zero in-flight race window.

## Recipient, bot and consent authority

### Identity

Resolve client from `reservations.user_id`; expert from
`reservations.expert_id → experts.user_id`. Join active `users` and exactly one active
Telegram `channel_identities` row for the configured bot, with non-null positive
private `external_chat_id=external_id`. Reject zero/multiple matches, legacy null bot,
blocked/unresolved identity, inactive client, and inactive/unverified expert. No
payload chat ID, username lookup, default bot or arbitrary first-row fallback.

New reservation notification context freezes both client and expert recipient tuples
at reserve time for the configured bot. A web `ClientPrincipal` supplies only `userId`,
not an authenticated Telegram origin: resolve exactly one eligible identity under the
authority locks, or use a separately authenticated origin with the same DB checks.
Persist original user, identity, bot, external user and private chat values, not just
an identity FK whose row can change. All later events revalidate
the captured tuple `(identity id,user id,bot key,external id,chat id)` and ownership.
An account relink or different bot does not retarget existing work. Missing expert
binding records unavailability; it does not substitute an operator's chat or invent
a Telegram identity. Mapping/provisioning remains a release input.

One configured bot is the first implementation boundary, using existing
`CLIENT_TELEGRAM_BOT_KEY` and `TELEGRAM_BOT_TOKEN`. Add an explicit expected numeric
bot ID and verify token-to-bot identity during a separately authorized activation
preflight; do not derive that proof from an arbitrary botKey string. Multi-bot
routing requires separate per-bot configuration, secrets and inbox namespaces.

### Consent and minimum payload

- Capture original `ClientConsentAuthority` with only `client_messaging` when the
  originating notification context is admitted, under the existing subject barrier.
  Validate exact decision/revision and current approved document at every client
  delivery admission. Null authority means suppressed, not capture-a-later-grant.
- The client's reservation creation must remain usable under its existing ordinary
  consent/booking policy. Missing Telegram notification consent/binding does not
  invent a signing gate or cancel a valid reservation; authenticated web remains
  the status surface and the undeliverable reason is explicit.
- Expert operational messages disclose only neutral `Клиент`, slot UTC time and
  opaque actions. Their recipient authorization is the active verified expert plus
  authenticated bot identity. Do not invent an `expert_messaging` consent column,
  or misapply the client's grant to the expert's identity.
- Do not read or send `client_profiles.expert_note`, diagnosis, free-text service
  descriptions, names, phone, email, documents, payment details or conversation text.
  Use fixed Russian templates and deterministic timestamps, no Markdown/HTML parse mode.
- This minimal handoff uses the accepted neutral branch in DEC-PLT-004§3, not an
  inferred grant for personal disclosure. Optional named/scoped handoff is **not
  implemented here**: existing `recipient_id/reservation_id/scope_fields` can store
  some facts, but presentation binding and per-reservation current authority must
  be proved first. Keep ordinary handoff confirmation UI intact; no written signing.
- No URL appears in these lifecycle templates, including `/account` links. Existing
  expert read disclosure is bounded at
  `starts_at - 30 minutes`; do not copy its result into a queued payload.
  Automatic30-minute meeting-link/reminder delivery is an explicit gap, not an
  implemented capability. A later approved extension must reread current `booked`,
  verified UID and allowlisted HTTPS link at send time; tests must cover -30min-1ms,
  exact -30min, cancellation and retry crossing the boundary. A field named
  `meeting_url` alone is not evidence of provider-bound provenance.

### Admission serialization

Use lock order: approved-document table → subject advisory barrier(s), ordered UUIDs →
user/identity authority → reservation → provider operation → intent → attempt. Keep
all SQL transactions short; no Telegram call while holding DB locks. Calendar
producer entrypoints must acquire the barrier before their existing reservation
locks when adding notification capture; avoid a trigger that reverses this order.

An intent lease is not send authority. `admitAndConsume` revalidates current state,
identity, original consent, deadline and clock after any lock wait, then commits a
unique consumed attempt bound to claim token and request digest. Exactly one process
gets the in-memory send grant. It can invoke the transport once, immediately, with
a15-second deadline inside a60-second lease. If cancellation/withdrawal wins before
this transaction, zero calls; if admission wins, the single in-flight call may finish.
After crash, unknown is mandatory even if the process might not have reached HTTP.

## Required schema changes — proposed, not existing

Allocate the next migration only after coordinator settles the shared journal.
`0044_booking_notification_delivery.sql` is a **provisional** name after0043, not a
reserved number. Add journal entry, linked snapshot and SQL-object supplement using
the repository's hand-authored/reconstructed process; never `drizzle-kit generate`.

1. **`booking_notification_contexts` (new):** `reservation_id` PK/FK; immutable
   `bot_key`, `client_user_id` FK, `expert_user_id` FK; for each `client_`/`expert_`
   prefix, nullable `identity_id` FK, `external_user_id`, `external_chat_id`, and
   closed `unavailable_reason`. Each identity/external pair is all present or all
   absent with a reason; private chat must equal the positive external user ID.
   Nullable `client_consent_authority` JSONB with strict existing authority shape,
   `created_at`. Capture in the reservation transaction before its event, under
   identity locks; no late consent upgrade or late identity resolution. Delivery
   rows copy the frozen tuple and revalidate exact equality against live authority.
   If either original recipient was unavailable, later provisioning/rebinding cannot
   retarget later lifecycle events from this reservation; record suppression instead.
2. **`booking_notification_deliveries` (new):** `id` UUID PK; `source_outbox_id` FK;
   `reservation_id` FK; `recipient_role` (`client`/`expert`); `recipient_user_id` FK;
   nullable `recipient_identity_id` FK; `bot_key`; nullable captured
   `external_user_id/external_chat_id`; `kind`; `source_version` nullable for the
   provider-event shape; nullable `provider_operation_id` FK to calendar ledger;
   `template_version`; `state`; `reason_code`; `attempt_count`; `next_attempt_at`;
   `lease_token/lease_until`; `created_at/updated_at`; nullable `expires_at` for
   request buttons. Unique `(source_outbox_id,recipient_role)`; valid tuple/nullability
   checks and source/reservation/recipient ownership enforced transactionally.
3. **`booking_notification_attempts` (new):** `id` UUID PK; `delivery_id` FK;
   `ordinal`; `claim_token`; `request_digest`; `admitted_at`; outcome
   (`started`,`not_applied`,`applied`,`unknown`); nullable `telegram_message_id`,
   `response_chat_id`, `reason_code`, `retry_after_seconds`, `resolved_at`,
   `resolution_evidence_ref`. Unique `(delivery_id,ordinal)` and unique accepted
   `(bot_key,chat_id,message_id)` through the delivery binding (store bot/chat in
   the receipt if needed for an enforceable composite key; do not claim a cross-table
   unique index). Append immutable outcome facts rather than overwriting uncertainty.
4. **`booking_notification_callbacks` (new):** `delivery_id`, action, FK to
   `notifications.id`, `callback_token_ciphertext`, `encryption_key_id`, and expiry;
   unique `(delivery_id,action)`. DB remains sole durable store. Encrypt the two
   generated wire tokens; existing hash/claims cannot reproduce them. Keep encryption
   keys server-side and separate from callback HMAC secret. On known retry reuse the
   same pair; on unknown never mint a replacement pair or send again.
5. Link existing callback rows to delivery via this table to enforce bot/recipient
   checks during issuance **and consumption**. Do not rewrite legacy callback claims
   into authoritative bot-bound claims. Old unbound tokens are rejected by this new
   production booking callback route, not silently upgraded.

Delivery states: `pending`, `retry_wait`, `sending`, `delivered`, `suppressed`,
`unknown`, `manual`, `failed`. Only an attempt with bound valid Telegram receipt may
lead to `delivered`. `suppressed` has explicit state/authority/no-recipient reasons.
Failure/manual alerts reuse content-free `outbox_operator_alerts` with the real
source outbox FK and existing `delivery_failure` case type; do not add message text
or recipient identifiers to alert metadata/metric labels.

Atomic capture helper is required at each producer, not only a later queue scan:
reserve, expert/client cancellation, explicit completion/no_show, expiry batch and
Planerka completion/rejection. Capture immutable context/delivery intents with the
event in the same transaction. Old events without context are quarantined for review;
no mass replay, no later grant attached to an old request, no invented booking version.

Retention: callback ciphertext is removed on consumption/expiry/suppression and after
confirmed delivery (Telegram holds the actual buttons); hash/claims remain until
existing callback lifecycle permits cleanup. Do not delete needed callback hash rows
merely because ciphertext is gone. Retain content-free delivery metadata under the
existing message-metadata schedule, not full text/URLs. Add privacy cleanup that
stops unstarted sends under the subject barrier and preserves minimal unresolved
attempt/receipt evidence; unknown must not become proof of remote erasure. Review
restrict/cascade FKs against actual identity cleanup before migration acceptance.

## Delivery and callback algorithms

### Delivery attempts

1. Bounded scanner accounts for the exact lifecycle topic set; source completion and
   validated intent insertion/accounting are atomic. Never claim `booking.start` as
   a Telegram send. Revocation is a separately named local-control path.
2. Claim at most20 eligible intents with `FOR UPDATE SKIP LOCKED`,60-second leases.
   Serialize per reservation/recipient. Earlier pending/sending lifecycle messages
   block overtaking; superseded unstarted messages are suppressed. Unknown earlier
   request/confirmation does not block a newer authoritative cancellation forever:
   move it to operator attention without resending, then permit the terminal message.
   No ordering guarantee is asserted across unrelated conversational chat messages.
3. Build one of the fixed templates from authorized current DB facts. Request buttons
   use one persisted `ct2.` token per action, current reservation version and expiry
   `min(reserved_until, starts_at)`. Confirm/cancel must both expire for that request.
4. Commit admission/consumption, then perform one HTTPS `sendMessage` with redirects
   rejected, bounded body/read deadline and no automatic transport retries. Never log
   URL/token, message body, callback data, chat ID or raw provider errors.
5. Success requires validated `ok:true`, positive message ID, matching response private
   chat ID and expected bot endpoint. Atomically persist the receipt and delivery state.
   Do not reuse the old sender's loose `ok:true` check or discard the returned ID.
6. On DB completion failure after success, retry only saving that same authenticated
   receipt; never HTTP. A late matching receipt can resolve its exact admitted attempt
   after lease expiry without granting the stale worker a new send or state mutation.
   Conflicting receipt/bot/chat/attempt becomes an operator incident.

### Outcome policy

| Evidence                                                                                             | Durable outcome and next step                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Local validation/admission denied, transport not invoked                                             | Suppress or fail with reason; no delivery claim                                                                                   |
| Proven `TransportFailure.phase=before_write`                                                         | `not_applied`; bounded retry with fresh authority/state validation                                                                |
| Valid Telegram429 rejection                                                                          | `not_applied`; honor full valid `retry_after` as a minimum, with jitter; do not shorten it to the existing adapter's60-second cap |
| Definite valid400/403 recipient rejection                                                            | Failed, content-free operator alert; never retry a blocked recipient blindly                                                      |
| 401/bot mismatch/invalid configuration                                                               | Fail closed, pause new admissions for that bot; alert                                                                             |
| Timeout/disconnect after invocation,408/5xx, malformed success, redirect, oversized/stalled response | `unknown`; no resend                                                                                                              |
| Lease expires before admitted attempt exists                                                         | Safe re-claim; revalidate all authority                                                                                           |
| Lease expires with admitted attempt, process crashes before durable receipt                          | `unknown`; absence of message ID is not evidence of non-delivery                                                                  |
| Matching persisted success receipt                                                                   | Reconcile locally to delivered, zero provider calls                                                                               |
| Unknown with no receipt                                                                              | `manual`, content-free alert; no invented Telegram GET/history lookup or text/time matching                                       |

Proposal: max5 actual network attempts for **definite non-delivery only**, full-jitter
backoff base1s/cap60s, additionally `not_before ≥ retry_after`. Slot/hold deadlines
win over retries. Paused flags/lock contention consume no attempt. Unknown consumes
no further send budget; one bounded local receipt check then manual attention.
An operator may record independently obtained matching message evidence; lack of
evidence cannot authorize resend. No “retry unknown” button in this increment.

### Expert callback consumption

New scoped callback service authenticates `ct2.` without consuming it, then joins its
notification→delivery→identity and checks reservation/expert/version/expiry. Require
webhook shared-secret authenticity, configured bot, `from.id`, explicit private
`message.chat.id=from.id`, captured target identity, and where available the known
delivered Telegram message ID. Unknown-send callback can establish visibility of
its unique token but cannot alone invent a provider message receipt.

Invoke `createBookingService.confirmByExpert/cancelByExpert`, which calls the existing
atomic `transitionFromTelegramCallback`. Extend the latter's DB predicate with the
new bot-bound delivery link, or introduce a narrowly scoped wrapper holding the
same identity locks through transition; checking only before a separate transaction
leaves a rebind race. Confirm consumes one token and invalidates the sibling by
version change. No separate `verifyCallback` consumption and no callback-generated
client confirmation before calendar success.

After acquiring all authority/reservation/callback locks in that same consume-and-
transition transaction, read PostgreSQL `clock_timestamp()` (not transaction-start
`now()` or caller `command.now`). Use this single fresh value for callback expiry,
hold/slot eligibility and the domain transition. A lock wait crossing expiry must
reject without consuming the callback or mutating the reservation/provider operation.

Add an explicit booking branch to webhook routing, leaving `cv1.`/`xr1.` and other
flows unchanged. Inbox namespace includes bot identity. Authenticate before serving
duplicate status, but classify an already consumed token with a matching committed
transition as a replay, not a new mutation. A lost response between SQL commit and
inbox completion must be recoverable from that fact. Callback acknowledgement is
best-effort `answerCallbackQuery`, separate from booking transition; its timeout
must not rerun the transition or trigger another request notification.

## Production composition and rollback

Proposed default-off controls (new, not existing env):
`BOOKING_NOTIFICATIONS_ADMISSION_ENABLED`, `BOOKING_NOTIFICATIONS_SEND_ENABLED`,
`BOOKING_NOTIFICATIONS_RECOVERY_ENABLED`, `BOOKING_CALLBACKS_ENABLED`.
Send requires configured capture capabilities and enabled recovery, not an enabled
admission flag (existing work must be drainable). Turning admission off stops new
intents without dropping existing ones. Send-off stops new HTTP attempts, not receipt
reconciliation. Callback ingestion remains available for outstanding valid buttons
and has its own emergency kill switch.

`apps/worker/src/main.ts` must construct `PostgresBookingNotificationRepository`, a
real bounded Telegram HTTP transport, renderer/dispatcher, metrics and local recovery
from config. Inject an explicit `bookingNotificationRunner` into `runtime.ts` and
schedule it in the real loop, alongside—not replacing—Planerka recovery. Do not leave
the implementation accessible only through a test-injected factory. Keep generic
outbox recovery from concurrently owning these rows; source ingestion is a local
atomic operation, and delivery leases live in the dedicated ledger.

`apps/api/src/server.ts` and `app.ts` must compose the scoped callback service and
real booking service when enabled; remove only the booking callback stub under that
capability. Missing bot secret/identity/transport/migration/callback keys aborts
startup when enabled. Existing `TELEGRAM_ENABLED=false` legacy switch is not repurposed
to enable unrelated residency/query/payment routes. Worker-only deployment is invalid.

Cutover: migrations/context capture first with send disabled; capture a exact source
SHA and real bot binding evidence; inventory remains empty. Quarantine legacy backlog,
prove API+worker readiness and callback route composition; only then consider an
explicitly authorized synthetic-recipient live probe. No such call is authorized here.

Rollback: disable new admission/send, keep compatible API callback consumer and
notification receipt recovery plus Planerka reconciliation. Retain schema, attempts,
token hashes and keys needed for already sent buttons. Never reset unknown to pending,
clear source events, or roll back to code that confirms on expert approval. Record
current native/web rollback targets and backup/isolated-restore evidence before any
production migration. A release without those checks is not activation-ready.

## Actionable tasks

T1 is implemented and T2 ownership is assigned above; T3–T5 paths remain future
ownership requests, not authority to edit their files. The coordinator separately
owns the pure T4 HTTP transport only; composition awaits T2/T3 and review.

### T1 — Strict contracts and fixed templates (CAP-2/3; assigned)

Files: create `packages/contracts/src/booking-notifications.ts`,
`packages/worker/src/booking-notification-renderer.ts`; update necessary barrel exports.
Tests: new `packages/worker/src/booking-notification-renderer.test.ts`.

- [x] Define exact nine classified topics (eight lifecycle + local revocation), producer
      payload variants and discriminated suppression/failure reasons; exclude booking.start.
- [x] Write renderer RED assertions: generic client label, correct state/cancel wording,
      no forbidden text fields/contact/URL, neutral terminal states, no medical/payment inference.
- [x] Implement `renderBookingNotification(view)` from a strict discriminated view:
      ready views encode the exact topic/status and calendar evidence; suppressed views
      encode a closed reason. Return rendered text/recipient role/inline keyboard or a
      content-free suppression, never interpret raw producer JSON as send authority.
      Malformed views fail closed; unknown/superseded confirmation cannot claim success.
      Follow with focused RED/GREEN (new logical file, maximum3 invocations).

### T2 — Transactional intent capture, ledger and recovery (CAP-2/3/4)

Files: new migration/journal/state artifacts, `packages/db/src/schema/booking-notifications.ts`,
`packages/db/src/repositories/booking-notification-repository.ts`,
`packages/db/src/repositories/booking-notification-authority.ts`; targeted future changes
to booking, expiry and Planerka producers plus privacy cleanup. Test: new
`tests/integration/booking-notification-delivery.test.ts` (new delivery behavior, not a
renamed calendar test). Existing calendar regressions retain their consumed counts.

- [ ] Implement `captureBookingNotificationContext(tx, reservationId, origin)` at
      reservation admission and `captureBookingNotificationIntents(tx, sourceOutboxId)`
      in each producer transaction; barrier order and no later-consent capture are mandatory.
- [ ] Implement recipient resolution at reserve and exact frozen-tuple revalidation
      at later capture/admission; identity FK alone is insufficient. Do not infer a
      Telegram origin from web `ClientPrincipal.userId`.
- [ ] Implement `claimDeliveries(limit, workerId)`, `admitAndConsume(claim)`,
      `recordOutcome(attemptId, outcome)`, `recoverExpired(limit)`, and
      `resolveReceipt(attemptId, receipt)`; use DB time, fenced attempts and atomic source accounting.
- [ ] Assert atomic rollback, recipient ambiguity, stale state, revoke/regrant,
      unknown/no resend, late receipt, strict source ownership and erasure retention.
- [ ] Verify hand-authored migration on isolated17.5; unchanged prior SQL hashes,
      callback/consent fixtures genuine and valid; no fake approval/provider facts.

### T3 — Persisted buttons and real API callback route (CAP-1/3)

Files: targeted `telegram-callback-repository.ts`, `callback-token.ts` transaction-aware
store boundary, booking service/repository consumption predicate;
new `apps/api/src/booking-callback-service.ts`; `server.ts`, `app.ts`,
`routes/telegram-webhook.ts`. Tests: new
`apps/api/src/routes/booking-notification-callback.test.ts` plus T2 DB cases.

- [ ] Generate and encrypt one confirm/cancel pair atomically with callback rows and
      delivery link. Expose no raw tokens in logs, metrics or source event payloads.
- [ ] Authenticate bot/private chat/expert/link before the atomic existing transition.
      Confirm result is calendar-pending; duplicate/opposite/foreign/stale tokens cause zero new operation.
- [ ] Read DB fresh clock after authority locks and use it for consumption and domain
      transition in the same transaction; caller time cannot authorize an expired token.
- [ ] Compose actual enabled API ingress; assert callback+inbox commit/replay and
      acknowledge-only failures do not repeat domain mutation. Retain other callback namespaces.

### T4 — Telegram sender and bounded production worker (CAP-4/5)

Files: new `packages/integrations/src/telegram/booking-notification-transport.ts`,
`packages/worker/src/booking-notification-runner.ts`,
`apps/worker/src/booking-notifications.ts`; modify worker `main.ts`, `runtime.ts`,
config/env and exports. Tests: new
`packages/worker/src/booking-notification-runner.test.ts`,
`packages/integrations/src/telegram/booking-notification-transport.test.ts`,
`apps/worker/src/booking-notification-composition.test.ts`.

- [ ] Real transport factory accepts existing bot credentials; HTTPS fixed host,
      no redirects/logging/retries,15s deadline,64KiB response limit. Unknown network
      phase stays unknown; injected transport doubles are test-only.
- [ ] Implement success receipt binding and durable429 scheduling; invoke exactly
      once per consumed admission; preserve receipt on DB failure and stale lease.
- [ ] Test actual runtime factory and loop call the runner with production dependencies;
      enabled-but-missing capabilities fail startup. Add bounded, identifier-free metrics.
- [ ] Separate disabled admission/send from local recovery; retain callback consumption
      and Planerka drain during shutdown/rollback. No no-op enabled capability.

### T5 — Revocation, recovery operations and release acceptance (CAP-3/4/5)

Files: future changes to privacy repository/worker cleanup, notification repository,
operator-case projection and `docs/runbooks/planerka-api-client.md` only after ownership
handoff; extend this spec with actual verification evidence.

- [ ] Consume handoff revocation as local invalidation with real journal evidence;
      if no optional disclosure was ever delivered, record zero recipients, not a fake send.
      Historical untracked disclosure needs an explicit operator case, not guessed fan-out.
- [ ] Expose delivered/unknown/manual/failed distinctions through existing operator cases;
      write the evidence-bound receipt-resolution procedure with no unknown resend operation.
- [ ] Review fixed templates, full matrix, migration compatibility, exact-candidate
      build, restore evidence and API/worker rollout together. Request real probe target
      separately. Do not infer readiness from local transport tests or manufactured CI.

## Test matrix and bounded execution plan

The initial planning pass ran no tests. T1's subsequently authorized evidence is
recorded below. The Current execution assignment authorizes T2 and the T1 database
resolver; T3–T5 remain subsequent assignments. T2 has consumed two of three focused
invocations; the coordinator exclusively owns run3 after independent review.
For each **new logical file**,
collect RED cases before implementation, one focused RED then GREEN, retain the third
invocation for review corrections. Run files singly; no multi-path/full suite. Use
`pnpm exec vitest run <exact-file>` only after implementation/test authority. Adding
new files is justified by new notification behavior, never to repeat exhausted
calendar/transport/payment coverage. Existing file counts remain in the calendar report.

| Case                                                                                                          | Assertions                                                                                                                                               | Owner task/test                            |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Every eight lifecycle topics and three producer payload shapes                                                | Exact recipient/type; missing/extra/malformed fields rejected; no dropped topic                                                                          | T1/T2                                      |
| Bot mismatch, identity relink, ambiguous identities, null bot, group chat, inactive user/expert               | Zero sends/zero callbacks; explicit suppression reason                                                                                                   | T2/T3                                      |
| Rebind client or expert identity after reserve, before a later lifecycle event; web principal has only userId | Frozen original user/identity/bot/external_user/chat remains unchanged; later event is suppressed, never retargeted or silently repaired by provisioning | T2                                         |
| Original client consent revoked, regranted or document superseded after enqueue                               | Old intent never borrows later grant; normal ordinary-consent UI unchanged                                                                               | T2                                         |
| Withdrawal/cancellation before and after admission                                                            | Before: zero HTTP; after: at most admitted call, new terminal state delivered, no false atomicity claim                                                  | T2/T4                                      |
| Foreign reservation/source ID, forged UID/status, legacy booked without verified operation                    | No confirmation; operator/suppression evidence                                                                                                           | T2                                         |
| Approval pair issuance rollback/retry                                                                         | No orphan usable button; same pair on proven retry; ≤64-byte tokens                                                                                      | T2/T3                                      |
| Confirm/cancel duplicate, concurrent opposite buttons, expiry, stale version, lost webhook response           | One domain transition/provider operation; idempotent replay; no premature confirmation                                                                   | T2/T3                                      |
| Callback starts before expiry but waits on authority lock until after expiry                                  | DB fresh post-lock time used in consumption AND domain; zero consumption/transition/provider operation despite earlier caller time                       | T2/T3                                      |
| Known delivery, SQL completion rollback, late receipt after stale lease                                       | Message ID/chat/bot persisted exactly; zero HTTP resends                                                                                                 | T2/T4                                      |
| Before-write, validated429 retry_after>60s,403,5xx,408, malformed/oversized/redirect response                 | Exact retry/failed/unknown classification, capped attempts, no short429 retry                                                                            | T4                                         |
| Crash before admission versus after consumed admission                                                        | Only unadmitted work re-claimed for send; ambiguous work manual, never pending                                                                           | T2/T4                                      |
| Stale confirmation followed by cancellation/expiry                                                            | Suppress unsent confirmation; truthful local/provider distinction; terminal message not stuck behind manual unknown                                      | T2/T4                                      |
| Legacy completed/no_show with unresolved review                                                               | Completion/no-show not converted to cancellation; no false cancel template                                                                               | T1/T2; calendar P2 fixed independently     |
| Privacy payload scan; URL at -30min-1ms/exact boundary/later                                                  | Lifecycle templates contain no meeting URL at any time, no notes/contact/diagnosis; future URL attachment remains gated/out of scope                     | T1                                         |
| Handoff revocation with no delivered disclosure / unknown / evidence-bound historical recipient               | No invented grant or recipient; local invalidation; historical uncertainty operator-visible                                                              | T2/T5                                      |
| Erasure or identity removal during pending/unknown send                                                       | Stop unstarted work, no orphan-FK deadlock, preserve minimal uncertainty without claiming Telegram deletion                                              | T2/T5                                      |
| Two workers, bounded batch, bot throttling, shutdown, flags off                                               | Fenced exactly-one attempt; no starvation/lease replay; recovery stays composed                                                                          | T2/T4                                      |
| Actual API/server + worker main/runtime with missing and real mocked capabilities                             | Fail-closed startup versus scheduled delivery/real callback transaction; no production stub                                                              | T3/T4                                      |
| Real integration walkthrough, local fixtures only                                                             | Reserve → delivered buttons → authentic-bound callback → calendar completion → one delivered confirmation; cancel/expiry branches                        | T2/T3/T4; explicit bounded file accounting |

Relevant typechecks/lint/format/diff checks and independent adversarial review are
required for each assigned increment. They do not reset test budgets. There have
been zero provider invocations, live messages or production mutations in this work.

## Concrete unresolved gaps / review decisions

1. **Bot provisioning:** existing local schema supports bot-scoped identities but
   no supplied real expert bindings are established. Confirm the single-bot initial
   scope, expected numeric bot ID, webhook ownership and separate callback/encryption
   keys before activation. No actual token/API call was inspected or made here.
2. **Scoped optional disclosure:** ordinary consent infrastructure exists, but it
   does not by itself prove a reservation/expert-bound presentation. This design
   deliberately sends only neutral handoff; no contact/name/note expansion. Owner
   policy contains older conflicting “all bookings granted” wording versus denied
   minimal handoff; current user direction and minimum branch are preserved, not a
   legal rewrite. Coordinator must settle any richer disclosure separately.
3. **Meeting access/reminders:** no calendar completion code here persists a verified
   meeting URL, and no30-minute delivery scheduler exists. Lifecycle notifications
   omit links. If proactive meeting-link delivery is required for this increment,
   add a separately assigned provider-bound URL source and scheduled-intent task;
   do not derive a URL from a UID or release it at confirmation time.
   These capabilities remain mandatory full-goal backlog, not waived by T1 scope.
4. **Missing non-notification consumers:** `booking.start` needs a subject-bound
   navigation consumer. Expert expiry after definite provider rejection is now
   emitted by the T2 P5 candidate; its new assertion still awaits coordinator run3.
5. **Unknown delivery:** Telegram-independent receipt lookup is not implemented or
   promised. Manual/operator resolution means uncertainty remains visible, not that
   someone can safely press “resend”. External delivery cannot be exactly-once proven
   from an outbox hash. Coordinator accepted this architecture for incremental
   development, not human/product acceptance or production enablement.
6. **Release coordination:**0043 closure includes the separate legacy-terminal P2;
   the coordinator assigned0044 and the overlapping T2 files in Current execution assignment.
   No rollout until exact candidate/backup/restore and safe live-recipient evidence.

## Design self-review and preservation record

The requested single-file ownership overrides BMad's default folder/memlog/companion
layout and Superpowers' default plan path/commit step. BMad customization/config were
resolved; configured `project-context.md` is absent, so AGENTS.md, live status, source
code and the named owner decisions supplied the context. No extra artifact was made.

Historical design coherence: capability→task→matrix mapping present; existing fields separated from
proposed schema; recipient and original-consent binding explicit; uncertainty is never
a retry authorization. Hubble's design review does not block T1. Its P1 original-tuple
capture and P2 post-lock DB-clock corrections are incorporated above with regression
matrix entries. At that design checkpoint ledger/API code was unassigned; the
Current execution assignment subsequently authorized the ledger, not the API.
Preservation: all booking topics classified, real approval buttons/API composition
included, minimum-data/ordinary-consent/30-minute/no-demo constraints retained,
financial/legal conflicts excluded from runtime authority, no-test/no-deploy respected.
Open decisions are bounded above; they are not permission to expand implementation.

## Bounded implementation evidence — 2026-10-12

### Historical T2 RED checkpoint — 16:24 UTC (superseded by terminal handoff)

Environment check with `-RequireDocker` passed (Node24.21.0, pnpm11.9.0).
Dedicated Compose project `ii-tonya-notification-t2-20261012` was created for
this assignment; its PostgreSQL17.5 container is
`ii-tonya-notification-t2-20261012-postgres-1`, bridge address192.168.112.2.
Only this newly created synthetic project may be cleaned up after verification.
Use its compose.yaml placeholder credentials with the existing
`II_TONYA_TEST_POSTGRES_ADMIN_URL` testkit; do not use production credentials.

New logical `tests/integration/booking-notification-delivery.test.ts` consumed
**run1/3 at16:24:46UTC**: behavioral RED,1failed/7passed. The positive recipient
resolution assertion failed against a compileable returning-undefined scaffold;
the seven rejection assertions passed. Actual server_version_num170005 asserted.
At this historical checkpoint only the initial DB recipient resolver had replaced
the scaffold; ledger/migration/producer/privacy work had not yet been implemented.
The later candidate and terminal handoff below supersede that implementation status.
The same test file was expanded before run2; run3 remains coordinator-owned.
No existing test file was rerun. No runtime activation or provider call occurred.

### Historical T1 evidence (current T1/P2 closure is in Current execution assignment)

At the original T1 handoff, implementation review was pending. New contracts
strictly classify all eight lifecycle topics, eleven real producer variants and the
separate handoff-revocation control event. Rendering accepts exact topic/status views,
requires `verified_booked` for confirmation, emits only fixed neutral text and two
opaque approval callbacks, and preserves unknown/superseded suppression. It has no
DB/network/clock side effects and is not a dispatcher or authorization mechanism.
Source operation, identity, consent and fresh-state authority remain T2/T3 duties.

| Logical test file                                           | Fresh invocations | Result                                                                       | Budget after this increment                              |
| ----------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/worker/src/booking-notification-renderer.test.ts` | 2                 | 16:07:44 UTC RED:31 failed/30 passed; 16:09:23 UTC GREEN:61/61               | 2/3; third reserved for review corrections               |
| `tests/integration/planerka-migration-state.test.ts`        | 0                 | Five P2 legacy projection cases added, NOT executed; prior2/2 predates patch | Historical1/3, but current P2 runtime permission pending |
| `tests/integration/planerka-booking-workflow.test.ts`       | 0                 | Not rerun; prior16/16 is historical                                          | 3/3 exhausted                                            |

RED used compileable rejecting contract/function scaffolds, not an import failure;
those scaffolds were replaced by the actual renderer before GREEN. Negative guards
already passed on the rejecting scaffold; RED is not claimed for every guard.
The61 tests cover topic/action/decision/version variants, strict payload/view rejection,
all templates/roles/buttons, four external-cancellation evidence states for both
recipients/expiry, unknown confirmation rejection and content-free suppression.
They do not prove DB revalidation, race handling, retry/unknown transport semantics,
callback authentication or actual delivery; those remain the T2–T5 matrix above.

Static evidence: contracts build (including declarations), worker typecheck, tests
typecheck, scoped ESLint and whitespace checks passed. P2 projection SQL and its
regression file also passed scoped lint/test typecheck; coordinator independently
reported DB typecheck exit0. P2 excludes completed/no_show from the active client
list, retains cancelled/expired uncertain cases as cancellation_pending, and leaves
legacy investigations/terminal receipt pagination intact. P2 behavioral closure is
pending; old green results are not acceptance of the changed test file.

No multi-path/full test command, exhausted test, provider call, DB resolver/migration,
runtime wiring, commit or deploy was performed in this increment. Production booking
notification delivery is still absent: atomic outbox events and a pure renderer do
not deliver Telegram messages. Reminders/meeting access remain full-goal backlog.

### Historical T2 candidate handoff — 2026-10-12, after run2

At that handoff T2 implementation was present and ready for independent review;
all three reviews subsequently returned and the fix batch below supersedes that
candidate. **Verification remains incomplete**, and T2 remains in-review. No T3 callback issuer,
HTTP sender, worker/API composition, configuration activation or production change
was implemented. T2 provides real SQL operations, not successful delivery stubs.

Implemented in the assigned file set:

- Hand-authored0044 contexts/deliveries/attempts/callback-link tables plus append-only
  attempt outcome facts. An unknown fact remains after a later matching receipt.
  Nullable live identity FKs use ON DELETE SET NULL; separate original identity UUIDs
  and external user/chat snapshots prevent FK deletion/rebinding from retargeting.
  Context updates allow only FK removal or privacy redaction, never consent upgrades.
- Explicit `BookingRepositoryOptions.notificationOrigin` captures both recipients
  and original client-messaging evidence at reserve time. There is no runtime default
  bot or inferred Telegram origin from a web user. Existing composition does not
  supply this option; activation remains a later task. Sources without original
  context are quarantined with an operator alert rather than replayed.
- Reservation transition, batch-expiry and Planerka completion/rejection producers
  capture delivery intents in their source transaction. Document/ordered-subject,
  identity-table/user and expert/service authority locks precede reservation locks.
  The identity table SHARE lock fences writers outside the subject advisory protocol.
- Bounded claims, source accounting, exact tuple/current-consent/current-state checks,
  consumed attempts, fresh post-lock lease/deadline checks, five definite-nondelivery
  attempts, full retry_after minimum, append-only unknown outcomes, local recovery and
  bound late receipt resolution. Uncertain sends are never reset to pending.
  Request admission fails closed until T3 supplies the persisted callback pair.
- Privacy withdrawal stops unstarted messaging. Erasure suppresses unstarted work,
  preserves admitted uncertainty and receipt bindings, removes queued addresses and
  context recipient snapshots, and permits actual channel-identity deletion. No
  remote deletion, recipient reading or historical optional disclosure is claimed.

Migration reconstruction: isolated PostgreSQL17.5 (`server_version_num=170005`),
all0000–0043 SQL hashes matched the0043 manifest, then SQL replay through0044 and
fresh-directory introspection normalized with positional catalogue constraints/indexes.
Committed0044 snapshot links to0043; SQL-only supplement and input-hash manifest
were produced. Initial reconstruction found a JSON operator-precedence error in new
SQL and a catalogue alias typo in the temporary reconstruction script; both were
corrected before the successful reconstruction. These were migration artifact
reconstruction commands, not Vitest invocations or behavioral suite substitutes.

**Focused run2/3:**
`II_TONYA_TEST_POSTGRES_ADMIN_URL=<owned synthetic Compose database> pnpm exec vitest run tests/integration/booking-notification-delivery.test.ts`
started **16:42:40UTC**, duration16.66s: **36passed /3failed /39total**.
The failures and corrections are:

1. Later-grant case changed consent before claim; claim correctly suppressed the
   delivery, so the test passed undefined to admission. The corrected test claims
   first, records the subsequent genuine grant, then tests admission rejection.
2. Expiry fixture set reserved_until earlier than created_at. It now ages created_at
   as well, preserving `reservations_deadline_after_creation` and all guards.
3. Document supersession attempted UPDATE on append-only document facts. It now
   appends an approved higher version, using the real current-document predicate.

These three corrections have **not been run**. **Run3 remains reserved** for the
coordinator after independent review. No other logical test file was invoked here.
Run1/3 remains the earlier8-case behavioral RED at16:24:46UTC; the expanded31cases
were added before implementation/run2 but do not each have separate observed RED.
The36passes include recipient cases, frozen relinks/late-grant suppression, actual
producer rollback, provider-bound complete/reject intents, terminal completion/no-show,
post-lock lease race, concurrent identity insertion, consumed-attempt concurrency,
unknown/no-resend, late receipts, retry-after/cap, erasure identity deletion, strict
NULL/schema guards, and fresh snapshot/constraint/index reconstruction.

Migration compatibility fixture adjustment (**unexecuted**):
`planerka-migration-state.test.ts` retains its through0043 reconstruction assertions,
then applies0044 only before the legacy cases invoking the current booking repository.
Its existing2/3 budget is unchanged. Repository metadata guards now expect0044 and
include its provenance; those existing test files were not rerun.

Historical static checks: DB typecheck, tests typecheck, scoped ESLint, Prettier and
`git diff --check` passed before run2. After fixture/review corrections DB/tests
typechecks and scoped ESLint passed; coordinator then passed scoped Prettier12files
and `git diff --check`. These results precede the fix batch below.
No full suite, multi-path Vitest command, exhausted test, provider invocation, live
message, commit, push or deployment. Owned Compose project is retained for review's
final focused run; do not remove pre-existing containers or data.

Remaining: independent T2 review and final focused verification; T3 authenticated
callback issuance/consumption; T4 actual HTTP transport/worker composition; T5 retention,
optional-disclosure revocation evidence, operator procedure and release integration.
Meeting links/reminders remain mandatory full-goal work outside this assignment.

### T2 first review-fix batch — 2026-10-12 (ready for scoped review, not accepted)

Input: all three independent reviews, coordinator-triaged P1–P8/V1–V4 in
`docs/test-evidence/booking-notification-t2-review-2026-10-12.md`. No new agents,
reviewers, provider calls, tests, commits, pushes or deployments in this batch.
Existing edits were preserved. Assertions were added before implementation patches;
there is **no observed RED/GREEN for these new assertions**.

Candidate changes:

- P1: bounded20-candidate keyset scan with per-repository continuation across polls;
  contended/predecessor-blocked rows cannot monopolize every poll. The cursor is
  ephemeral scheduling state, not authority; a repository restart repeats scanning.
  Actual reservation-lock regression covers an entire blocked oldest page.
- P2: callback-link stores its original token hash; admission locks registry/link
  rows, then checks both actions, exact reservation/expert/version/hash/claims,
  unused credentials, ciphertext/key presence and fresh matching bounded expiry.
  Positive fixture uses the real callback registry repository. Ciphertext is a
  synthetic envelope: cryptographic issuance/decryption remains separately owned T3.
- P3/P4: source version2147483648 is quarantined before SQL integer insertion;
  later sources continue. A cancelled operation without UID projects `not_created`,
  while unknown external outcomes remain `unknown`.
- P5: definite provider rejection publishes/captures expert expiry in the same
  transaction, using the newly committed reservation version and stable source key.
  Client provider-rejection intent retains its existing operation-bound shape.
- P6/P7: context deletion and delivery binding mutation/deletion are prohibited;
  live-FK removal and terminal queue-address redaction remain permitted. SQL lease
  shape/legal transitions plus deferred delivery/attempt/fact constraints validate
  final cross-table attempt count, latest attempt/lease binding and receipt/unknown
  evidence without rejecting valid transaction intermediate states.
- P8: matching late receipt closes only this source's uncertainty alerts; conflicting
  receipt alerts remain open, and unknown/applied facts remain append-only.
- V1–V4: real privacy withdrawal/erasure and both admission barrier orders, sending
  predecessor ordering, contradictory late receipts with a newer active attempt,
  immutable facts, and complete SQL supplement comparison (functions, trigger
  definitions/enabled state, exclusions, extensions, constraints, indexes) added.

Exact changed files in this batch (not the entire dirty worktree):

1. `packages/db/migrations/0044_booking_notification_delivery.sql`
2. `packages/db/migrations/meta/0044_snapshot.json`
3. `packages/db/migrations/state/0044_manifest.json`
4. `packages/db/migrations/state/0044_sql_objects.json`
5. `packages/db/src/repositories/booking-notification-repository.ts`
6. `packages/db/src/repositories/planerka-booking-repository.ts`
7. `packages/db/src/schema/booking-notifications.ts`
8. `tests/integration/booking-notification-delivery.test.ts`
9. `tests/repo/migration-history-integrity.test.ts`
10. `docs/superpowers/implementation-artifacts/spec-booking-notification-delivery.md`

Verification evidence for this batch:

- Environment check with `-RequireDocker`: exit0, Node24.21.0, pnpm11.9.0,
  Docker/Compose available, no warnings/failures.
- One reconstruction invocation, existing ignored
  `.cache/notification-t2/reconstruct.ts`: exit0. New isolated synthetic database,
  exact PostgreSQL17.5/170005, unchanged44 prior migration hashes, SQL replay and
  fresh-directory introspection, normalized0044 snapshot/supplement/manifest.
  It migrated/reconstructed schema only, not behavioral tests. The isolated database
  was removed by its finally block; the owned Compose container remains for run3.
- Independent static hash check:45 migration hashes and both generated artifact
  hashes match the0044 manifest; exit0.
- `pnpm --filter @ii-tonya/db typecheck`: two invocations, both exit0; final handle55543.
- `pnpm exec tsc -p tsconfig.tests.json --noEmit`: two invocations, both exit0;
  final handle49114, after the final fixture corrections.
- Scoped ESLint over the five changed TypeScript files: two invocations, both exit0;
  final handle37576. Scoped Prettier writes over those five files: two, both exit0.
- Final scoped Prettier check covers the five changed TS files and three0044 JSON
  artifacts. First check(handle23328) exited1 for snapshot/supplement formatting;
  one Prettier write corrected those two files, and manifest artifact hashes were
  updated. Second check(handle71257) exited0: all8 files formatted. Both static
  hash-check invocations exited0, the second after formatting/manifest correction.
- `git diff --check` passed for tracked changes. The9 untracked owned paths were
  additionally checked against `/dev/null` with `--no-index --check`: no whitespace
  diagnostics. Plain no-index returns1 for a new-file diff; that is not a whitespace
  failure. The final wrapper accepts that code only with empty diagnostic output.
- All reconstruction/static command handles completed; no child agent or background
  test process was started. No unresolved static error remains. A failed spec patch
  context match made no change and was corrected; a read-only probe used a nonexistent
  privacy test filename before locating `privacy-workflow.test.ts`. Neither was a
  test invocation. SQL/deferred-trigger behavior and concurrency remain unverified.

Test accounting is unchanged: delivery file **2/3**. Run1 at16:24:46UTC:
1failed/7passed (behavioral RED); run2 at16:42:40UTC:36passed/3fixturefailed/39total.
Those fixture fixes and this review-fix batch remain unexecuted. Static AST inventory
now finds37 test definitions/70 expanded cases (31 additional cases), not a test run.
Run3 is coordinator-owned. Renderer2/3, Planerka migration-state2/3, calendarworkflow3/3
exhausted, prior calendar transport6 invocations exhausted; no other file was run here.

Remaining before T2 acceptance: scoped independent review of this patch, coordinator
final focused execution and any resulting corrections within authorized budgets.
No active release approval follows from static success. Production read-only evidence
is PostgreSQL16.15/160015; isolated PG16 compatibility/restore remains an additional
release gate. Local evidence pin stays17.5; no PG17-only construct is intentionally used.

Mandatory cross-task work remains unchanged: calendar post-lock hold/slot/lease
validity; exact rendered-wire digest binding and terminal completion/no-show mapping
in T4; T3 authenticated issuance/consumption; admitted-chat evidence retention/erasure
lifecycle and operating procedures in T5; global-lock contention/throughput evidence,
eventual sub15-second suppression, actual API/worker composition, meeting access and
reminders, backup/restore and authorized live acceptance. Coordinator's separate pure
T4 transport and pure T3 callback vault do not activate any of these paths. Real
catalogue remains empty; no staging/production mutation occurred.
