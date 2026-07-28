# Threat Model and Go-Live Gates

Status: **required pre-production control**

Last updated: 2026-07-28

Owners: Platform, Security, Privacy, Clinical Safety, Payments, Operations

## 1. Purpose and decision

This document defines the security, privacy, safety, financial-integrity, and
operational controls that must exist before ии-Тоня handles real users.

The authoritative product source is
`docs/source/ii-tonya-expert-full-source-2026-07-28.txt` (SHA-256
`0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`).
That source contains product intent, prompts, repeated drafts, and pseudo-JSON.
It is a traceability baseline, not executable configuration and not a security
boundary.

The release decision is **NO-GO by default**. Staging or production becomes
eligible only when every applicable gate in this document has current evidence
and the named owner has signed it.

## 2. Non-negotiable architecture rules

1. PostgreSQL is the only source of truth for bookings, capacity, payments,
   message packages, coupons, consent, identities, and audit state.
2. Make and Google Sheets may consume projections or perform non-critical
   automation. They must not authorize, price, debit, reserve capacity, or
   decide crisis policy.
3. LLM output is untrusted text or a typed intent. It cannot directly mutate
   money, bookings, permissions, consent, or safety state.
4. Every inbound provider event is authenticated, schema-validated, deduplicated,
   and replay-safe.
5. Every outbound provider side effect is created through a transactional
   outbox and is idempotent.
6. Authorization is enforced by the backend for every object. Prompt
   instructions such as "do not show other clients" are not access control.
7. Safety, opt-out, error, receipt, refund, and cancellation messages bypass
   paid-message billing.
8. Secrets never appear in prompts, repositories, Sheets, Make exports,
   callback payloads, logs, fixtures, support messages, or URLs that are logged.
9. All timestamps are timezone-aware UTC internally. The source timezone is
   retained only for display and audit.
10. A release that cannot prove these rules is not a reduced MVP; it is blocked.

## 3. Source-risk traceability

The controls below intentionally replace unsafe or incomplete mechanics in the
source:

| Source area | Relevant source lines | Security concern |
| --- | ---: | --- |
| Progressive client profile | 66-107, 194-218 | Inferred sensitive data, profiling, and no consent model |
| Crisis behavior | 514-532, 641-664 | Keyword-only triage, paid-message dependency, and unsupported monitoring promise |
| Message billing | 788-842, 1509-1632 | Duplicate charging, recursion, and non-atomic counters |
| Booking and waitlist | 296-395, 848-992, 1639-2109 | Read-check-write races, stale callbacks, and partial failures |
| Expert access | 1155-1178, 1361-1377, 4372-4395 | Global name lookup and unnecessary financial/profile disclosure |
| Raw dialog and event logging | 2205-2460, 3120-3145 | Sensitive indefinite logs and Telegram disclosure |
| Credentials and webhooks | 2162-2189, 2655-2686, 3336-3375, 3842-3852 | Plaintext secret substitution and token-bearing URLs |

## 4. Protected assets

| Asset | Examples | Required protection |
| --- | --- | --- |
| Identity and contact data | Name, phone, email, Telegram numeric ID | Purpose limitation, encryption, object-level authorization, deletion workflow |
| Sensitive profile data | Health, mental state, sexuality, family, location, budget | Explicit approved basis, separate consent where required, strict minimization |
| Conversations and crisis signals | Raw messages, inferred risk, human-escalation notes | Restricted access, redaction, short approved retention, safety audit |
| Consent evidence | Consent type, version, source, grant/withdrawal timestamps | Append-only evidence, current-state derivation, exportability |
| Booking state | Slot, expert, client, capacity, status, version, expiry | Transactional state machine, concurrency control, immutable event history |
| Financial state | Payments, package units, coupon grants/holds/redemptions | Append-only ledgers, provider reconciliation, exactly-once commands |
| Provider credentials | API keys, bot tokens, webhook secrets, service accounts | Managed secret storage, minimum scope, rotation, access audit |
| Meeting and media links | Meeting URL, address, audio URL | Authorization, expiry where possible, allowlist, no public logs |
| Audit and security evidence | Actor, action, target, result, correlation ID | Tamper evidence, redaction, controlled retention, searchable incident trail |
| Availability and safety routing | Crisis classifier, contact directory, on-call queue | Fail-safe behavior, monitoring, tested fallback, named operational owner |

## 5. Actors and trust boundaries

### 5.1 Actors

- Client using Selarti.
- Expert using the Telegram bot.
- Administrator or support operator.
- Clinical-safety operator handling escalations.
- Platform backend and workers.
- LLM provider and retrieval layer.
- Selarti, Telegram, Planerka, payment provider, Make, and Google Sheets.
- External attacker, compromised user, malicious expert, compromised provider
  account, and authorized insider acting outside need-to-know.
- Untrusted content embedded in user messages, expert descriptions, reviews,
  links, meeting data, or imported documents.

### 5.2 Trust-boundary flow

| Boundary | Data crossing it | Required enforcement |
| --- | --- | --- |
| Client -> Selarti -> webhook ingress | Client identity, message, event ID | Provider authentication, signature/secret verification, freshness, dedupe, schema limits |
| Expert -> Telegram -> webhook ingress | Numeric user/chat ID, command, callback | Telegram webhook secret, immutable identity binding, signed callback context, RBAC |
| Admin -> back office | Search, overrides, refunds, safety actions | MFA, least privilege, reason codes, dual control for high-risk actions, audit |
| Ingress -> application services | Normalized command and actor context | Server-derived identity, authorization, rate limit, idempotency |
| Application -> PostgreSQL | Consent, ledger, booking, audit mutations | Transaction, constraints, version checks, encryption, append-only records where required |
| Application -> LLM | Minimized conversation and catalog context | Tenant scoping, redaction, untrusted-content markers, no credentials |
| LLM -> application | Text or typed intent | Schema validation, policy check, authorization, deterministic calculation |
| Application -> provider adapters | Outbound message, slot sync, payment action | Transactional outbox, idempotency key, timeout, retry policy, response validation |
| Backend -> Make/Sheets | Non-authoritative projection | One-way scoped credentials, redaction, reconciliation, no reverse authority |
| Production -> logs/backups | Operational evidence and snapshots | Redaction, encryption, access audit, retention and tested destruction |

No provider-supplied `client_id`, `expert_id`, price, balance, role, or booking
status is trusted without resolving it against server-owned identity and state.

## 6. Privacy, consent, and data retention

### 6.1 Threats

- Covert collection or inference of age, gender, family, health, sexuality,
  location, or economic status.
- Reuse of support or safety data for expert marketing.
- Disclosure of client profile, package balance, or coupon balance to an expert
  without need-to-know.
- Raw sensitive conversations copied to Sheets, Telegram channels, logs,
  analytics, or LLM traces.
- Missing deletion across provider systems and backups.
- Processing of minors without an approved age and guardian flow.
- Insider browsing, bulk export, or accidental cross-client retrieval.

### 6.2 Required controls

1. Maintain a versioned data inventory mapping each field to purpose, owner,
   recipients, retention class, and approved processing basis.
2. Record consent as an append-only event with subject, consent type, policy
   version, source, proof, grant time, withdrawal time, and actor.
3. Keep marketing, daily checkups, sensitive profiling, expert sharing, and
   optional conversation memory disabled by default and separately controllable.
4. Withdrawal must stop future processing immediately and initiate deletion or
   restriction across all processors within the approved SLA.
5. Do not infer protected or sensitive attributes when the service can function
   without them. Ask only at the point of need and explain why.
6. Until an age-verification and guardian-consent design is approved, the
   production service must not intentionally onboard minors.
7. An expert receives only the minimum appointment context for clients currently
   assigned to that expert. Package usage, coupon balance, and unrelated history
   are excluded.
8. Raw conversation logging is off by default. Approved diagnostic logging is
   redacted, access-controlled, and sampled.
9. Retention durations must be approved before production. "Indefinite" and
   "until storage is full" are invalid values.
10. Backups inherit deletion and expiry requirements. Restore procedures must
    not silently resurrect deleted profiles.

### 6.3 Retention classes required before production

| Class | Examples | Gate requirement |
| --- | --- | --- |
| Active service data | Contact and current booking data | Documented purpose and deletion trigger |
| Optional profile memory | Preferences and self-reported context | Separate consent and user-visible edit/delete |
| Sensitive/safety data | Crisis signal and escalation record | Clinical/privacy-approved scope and retention |
| Financial records | Payments, refunds, coupon and package ledgers | Statutory period documented by legal owner |
| Security/audit logs | Authentication and authorization evidence | Redacted retention with restricted access |
| Provider evidence | Raw webhook evidence | PII-minimized, encrypted, short retention |
| Backups | Database and configuration snapshots | Expiry schedule and verified purge behavior |

If a class has no approved duration and deletion owner, production is blocked.

## 7. Crisis and clinical safety

### 7.1 Threats

- Crisis content is rejected because the message package is empty.
- Keyword matching misses imminent harm or misclassifies negation, quotation,
  slang, spelling errors, audio, or another language.
- A panic-like symptom is treated as psychological when urgent medical care may
  be needed.
- The assistant promises to remain present or follow up without staffed
  monitoring and a delivery SLA.
- A stale, age-inappropriate, or wrong-country contact is presented.
- Vulnerable users are routed to unverified or unsuitable experts.
- Crisis data is later used for marketing or recommendation profiling.

### 7.2 Required controls

1. Safety screening runs before billing, marketing, recommendation, and normal
   LLM response generation.
2. Safety responses, opt-out, and human-escalation traffic are free and available
   when packages or providers are degraded.
3. The safety flow uses a clinically approved decision policy with deterministic
   high-risk guards, contextual classification, and a human escalation path.
4. The assistant must not promise synchronous presence or future outreach unless
   the staffed operation can meet and monitor that exact SLA.
5. The contact directory is keyed by country/region, age group, and risk type,
   and stores source, owner, and `last_verified_at`.
6. Somatic symptoms with possible acute medical risk follow the approved medical
   escalation path before optional calming exercises.
7. Expert eligibility is verified outside the LLM and includes credentials,
   service scope, age eligibility, method limitations, and suspension status.
8. Crisis records are excluded from marketing, ranking, coupon, and cross-sell
   features.
9. A kill switch can disable normal assistant behavior while preserving the
   safety fallback and provider-independent emergency information.

Clinical Safety must approve the policy, evaluation set, contact directory, and
human operating model. An LLM prompt alone cannot satisfy this gate.

## 8. Billing, payments, and coupon integrity

### 8.1 Message-package invariants

For every package:

- `available_units = granted_units - committed_debits + reversals`.
- `available_units >= 0`.
- A billable provider event has one stable internal event ID.
- `debit_count(event_id) <= 1`, regardless of retry, replay, or delivery order.
- The selected package is the non-expired package with the earliest expiry,
  chosen and debited in one transaction.
- Failed or rejected delivery is handled by the published tariff and cannot be
  charged twice.
- Safety, consent withdrawal, opt-out, error, receipt, refund, cancellation,
  and zero-balance notices are explicitly non-billable.
- A non-billable notice cannot re-enter the billing pipeline.
- The LLM cannot choose message count, unit price, package, or debit amount.

Balances are derived from an append-only ledger. Mutable `used` and `available`
counters may exist only as rebuildable projections.

### 8.2 Coupon invariants

For every coupon account:

- `available = grants - active_holds - redeemed - expired - reversed`.
- `available >= 0`.
- A hold, redemption, release, expiry, or reversal is idempotent.
- Applied coupons do not exceed both the eligible service price and available
  balance.
- A hold has an explicit expiry and cannot outlive the booking/payment decision.
- Expert cancellation, reservation timeout, failed payment, and failed booking
  release the hold according to the published terms.
- Chargeback and refund behavior is defined for both inviter and invitee.
- Promo codes are high-entropy, rate-limited, single-owner, and protected from
  self-referral and circular referral.
- Coupon expiry and package expiry are computed from server time, not Sheets
  locale or a client clock.

### 8.3 Payment controls

- The payment provider, not a client payload, LLM, Make, or Sheet, confirms
  payment state and amount.
- Payment commands and webhooks are idempotent and reconciled.
- Price, currency, discount, coupon allocation, tax/receipt data, refund, and
  chargeback state are stored as immutable financial events.
- An expert is never told that an amount is paid until the backend has confirmed
  the corresponding provider state.
- Manual financial adjustments require authorization, a reason, and immutable
  audit evidence.

## 9. Booking and waitlist concurrency

### 9.1 Booking invariants

For every event instance:

- `0 <= active_reserved + booked <= capacity`.
- Capacity is derived from authoritative reservation rows; cached counters are
  projections and are reconciled.
- Reservation creation uses a transaction and database constraint or an
  equivalent serializable compare-and-set.
- A reservation has a version. State changes require the expected current
  version and status.
- Allowed core transitions are `Reserved -> Booked` and
  `Reserved -> Cancelled/Expired`. Repeated terminal actions are no-ops.
- Confirmation requires the correct expert, an unexpired reservation, a future
  slot, and current eligibility.
- `reserved_until <= slot_start - confirmation_buffer`.
- A stale Telegram callback cannot confirm an expired, cancelled, reassigned,
  or version-mismatched reservation.
- A client cannot hold duplicate active reservations for the same service and
  time unless an explicit business rule permits it.
- One expert cannot be booked into overlapping slots.
- All event instances have stable IDs, explicit start/end timestamps, timezone,
  capacity, and expert ownership.

### 9.2 Waitlist and reschedule invariants

- A client has at most one active waitlist entry per event instance.
- Waitlist order uses a stable server sequence, not a calculated spreadsheet
  row position.
- Promotion claims one entry and one capacity unit in the same transaction.
- Waitlist promotion never charges money or coupons without the required client
  authorization.
- Replayed promotion produces no second reservation or notification.
- Reschedule is atomic from the user's perspective: either the new slot is
  committed and the old booking is released, or the old booking remains.
- Cancellation and reschedule trigger the correct coupon/payment compensation
  exactly once.

## 10. Webhooks, IAM, and object authorization

### 10.1 Provider webhook controls

- Verify the provider signature or configured webhook secret before parsing
  business fields.
- Enforce timestamp freshness, nonce or provider event-ID uniqueness, body-size
  limits, strict content type, schema validation, and rate limits.
- Retain only redacted raw evidence needed for incident response.
- Reject unknown event types and unknown state transitions.
- Derive the internal actor and object from server mappings; do not trust
  provider-supplied role, balance, price, or ownership.
- Return retry-safe responses and process side effects asynchronously.

### 10.2 Telegram expert authorization

- Bind experts to immutable numeric Telegram user and chat IDs, never usernames.
- On every command and callback, verify actor, role, expert status, chat context,
  reservation ownership, and object version.
- Callback data is opaque or signed and binds action, reservation, expert,
  version, and expiry. It contains no PII or secret.
- `/client` and schedule queries are scoped by expert assignment and use stable
  IDs; global name search is prohibited.
- Expert deactivation immediately revokes access and invalidates outstanding
  callback capabilities.

### 10.3 Administrative access

- MFA is mandatory.
- Roles separate support, privacy, clinical safety, finance, expert management,
  and platform operations.
- High-impact refund, consent override, identity merge, or data export actions
  require a reason and, where designated, dual control.
- All successful and denied object-access attempts are auditable.

## 11. Prompt injection and unsafe content

### 11.1 Threats

- User or expert text instructs the model to reveal other clients or system
  instructions.
- An expert description or imported document installs persistent malicious
  instructions in retrieval.
- A forged price, balance, slot, or role in conversation is treated as state.
- A malicious meeting/audio URL is rendered as a trusted service link.
- Model-generated tool arguments target another client or expert.
- Sensitive retrieval context leaks into a response or provider trace.

### 11.2 Required controls

1. Mark user, expert, catalog, review, link, and imported content as untrusted
   data and keep it structurally separate from system policy.
2. Give the model only tenant- and object-scoped, minimized context.
3. Accept model output only through versioned typed-intent schemas.
4. Recalculate price, authorization, consent, capacity, and safety decisions in
   deterministic backend code.
5. Apply object authorization after intent parsing and immediately before every
   read or mutation.
6. Allowlist destinations and validate/escape URLs and Telegram/Selarti markup.
7. Prevent the model from seeing credentials, raw access tokens, unrestricted
   data stores, or arbitrary network tools.
8. Red-team direct, indirect, multilingual, encoded, multi-turn, and
   retrieval-persistence injection.
9. Treat refusal text as user experience only; backend controls must still hold
   if the model complies with the malicious instruction.

## 12. Secret handling

- Store provider credentials only in the approved secret manager or managed
  provider connection store.
- Separate development, staging, and production credentials and accounts.
- Grant each adapter the minimum scopes and data set required.
- Never ask a developer to paste real secrets into JSON, Markdown, Sheets,
  prompts, or support chat.
- Prevent full webhook URLs containing Telegram bot tokens from appearing in
  command history, application logs, proxy logs, or screenshots.
- Use the Telegram webhook secret-token mechanism and verify it at ingress.
- Redact authorization headers, query parameters, meeting links, and tokens from
  logs and traces.
- Define rotation, revocation, break-glass, and provider-compromise procedures.
- Run a secret scan over tracked files, build artifacts, Make exports, fixtures,
  and logs before each release.
- A suspected secret exposure triggers immediate revocation and incident
  handling; deleting it from the latest commit is not sufficient.

## 13. Resilience, reconciliation, and observability

### 13.1 Required patterns

- Provider inbox with dedupe and durable processing state.
- Transactional outbox for every external side effect.
- Bounded retries with exponential backoff and jitter.
- Dead-letter queue with alerting, safe replay, and ownership.
- Correlation ID across ingress, transaction, outbox, provider response, and
  audit record.
- Compensation or explicit manual-recovery state for partial workflows.
- Reconciliation jobs for payment, ledger, booking/capacity, provider status,
  and projections.
- Circuit breakers and rate limits that preserve safety and cancellation paths.
- Encrypted backups, point-in-time recovery where required, and periodic restore
  drills.
- Defined and tested RPO/RTO for database, ingress, messaging, and safety routing.

### 13.2 Required alerts

- Any cross-client or cross-expert authorization denial anomaly.
- Duplicate financial command or ledger invariant violation.
- Negative balance or booking capacity violation.
- Accepted stale/unsigned webhook.
- Outbox or DLQ age above threshold.
- Reconciliation mismatch above zero for financial state and above the approved
  tolerance for provider projections.
- Crisis route failure, unacknowledged human escalation, or stale contact data.
- Secret-scanner finding or abnormal credential use.
- Backup failure or missed restore drill.

## 14. Mandatory security and safety test cases

| ID | Test | Expected result |
| --- | --- | --- |
| PRIV-01 | User declines optional profile memory | No optional or sensitive profile field is persisted |
| PRIV-02 | User withdraws marketing and checkup consent | No later marketing/checkup is scheduled or sent |
| PRIV-03 | Expert requests an unrelated client by name | Request is denied and audited without existence disclosure |
| PRIV-04 | End-to-end deletion request | Data is deleted/restricted across all processors and expires from backups per policy |
| PRIV-05 | Raw health/crisis message reaches logging pipeline | Approved redaction and retention class are applied; no Sheets/Telegram copy |
| SAFE-01 | Crisis message arrives with zero package balance | Safety response and escalation run; no debit is created |
| SAFE-02 | Negation, quotation, typo, slang, and multilingual crisis corpus | Clinically approved behavior meets the release evaluation thresholds |
| SAFE-03 | Selarti or LLM is unavailable during a high-risk event | Provider-independent safety fallback is returned and alerted |
| SAFE-04 | Human escalation is not acknowledged within SLA | Escalation alert and documented fallback execute |
| SAFE-05 | Contact record is stale or wrong for age/region | It is not presented; fallback policy executes |
| BILL-01 | Same billable webhook is delivered 100 times | Exactly one debit exists |
| BILL-02 | 100 concurrent debits target the last package unit | At most one succeeds; balance remains nonnegative |
| BILL-03 | Zero-balance notice is emitted | It creates no recursive event and no debit |
| BILL-04 | Crash occurs after ledger commit but before provider send | Retry sends once and does not debit again |
| COUP-01 | Same coupon redemption is replayed | Exactly one redemption exists |
| COUP-02 | Coupon expires while held | Approved expiry/hold policy executes without negative balance |
| COUP-03 | Expert cancels or reservation expires | Hold is released or reversed exactly once |
| PAY-01 | Client forges price or `payment_succeeded` | Backend rejects it and trusts only verified provider state |
| BOOK-01 | 100 clients request one remaining seat concurrently | Exactly one active reservation is created |
| BOOK-02 | Expired reservation callback is replayed | Confirmation is rejected/no-op and capacity is unchanged |
| BOOK-03 | Cancel callback is delivered repeatedly | One transition and one compensation occur |
| BOOK-04 | Failure occurs at every reschedule step | Either old booking remains or new booking is fully committed |
| BOOK-05 | Two workers promote the same waitlist head | One reservation and one notification are produced |
| BOOK-06 | Client selects a stale or too-near slot directly | Server-side recheck rejects it |
| WH-01 | Webhook signature is missing or invalid | Request is rejected before business parsing |
| WH-02 | Valid webhook is replayed outside freshness window | No business state changes |
| IAM-01 | Callback comes from another expert or chat | Request is denied and audited |
| IAM-02 | Deactivated expert replays an old signed callback | Request is denied |
| LLM-01 | User asks model to reveal another client's record | No data is retrieved or disclosed |
| LLM-02 | Catalog text contains persistent tool instructions | Text remains data and cannot cause a tool mutation |
| LLM-03 | Model emits a valid-looking unauthorized intent | Backend authorization rejects it |
| LLM-04 | Meeting/audio link uses an unapproved destination | Link is rejected or rendered non-actionable |
| SEC-01 | Secret scan runs over repository and artifacts | Zero live credentials are found |
| RES-01 | Each provider call is fault-injected before and after send | State is consistent or recoverable through outbox/DLQ |
| RES-02 | Projection is manually corrupted in Sheets | Reconciliation repairs projection without changing authority |
| RES-03 | Database restore drill runs | RPO/RTO are met and deleted data is not improperly resurrected |

Concurrency tests must run repeatedly with randomized ordering and provider
retries. A single happy-path pass is not evidence.

## 15. Staging gates

Staging may be enabled only when all of the following are true:

- [ ] Staging uses synthetic identities, conversations, bookings, balances, and
      payment instruments only.
- [ ] Staging has separate provider accounts, bot, secrets, databases, buckets,
      queues, and callback URLs.
- [ ] The authoritative source is normalized into versioned requirements with
      traceability to this document.
- [ ] Database constraints, ledgers, state transitions, inbox/outbox, and audit
      records are implemented and reviewed.
- [ ] Webhook authentication, replay protection, immutable Telegram identity,
      and object-level authorization pass `WH-*` and `IAM-*`.
- [ ] Crisis bypass and human-escalation simulations pass `SAFE-*`.
- [ ] Billing, coupon, payment, booking, and waitlist property/concurrency tests
      pass with no invariant violation.
- [ ] Prompt-injection and cross-client/cross-expert red-team suites pass.
- [ ] Logs and traces are redacted; staging secret scan is clean.
- [ ] Failure injection, DLQ replay, reconciliation, backup, and restore tests
      pass.
- [ ] No Make or Sheets flow can mutate authoritative financial, booking,
      consent, identity, or crisis state.
- [ ] Monitoring dashboards and alerts exist for every item in section 13.2.

Failure of any staging gate blocks provider-connected end-to-end testing.

## 16. Production go-live gates

Production requires current evidence and explicit sign-off for every gate:

| Gate | Required evidence | Sign-off owner |
| --- | --- | --- |
| PROD-01 Requirements and architecture | Versioned normalized requirements, approved trust boundaries, no unresolved security-critical ambiguity | Platform owner |
| PROD-02 Privacy and consent | Data inventory, consent UX/evidence, vendor assessment, retention/deletion test, minor policy, privacy review | Privacy/legal owner |
| PROD-03 Clinical safety | Approved decision policy, evaluation results, verified contact directory, human operating model, crisis drills | Clinical Safety owner |
| PROD-04 Billing and payments | Ledger invariants, provider sandbox reconciliation, refund/chargeback/receipt tests, tariff approval | Payments owner |
| PROD-05 Coupons | Hold/redemption/release/expiry/reversal tests and published terms | Payments/Product owners |
| PROD-06 Booking concurrency | Repeated load/property tests, state-machine review, waitlist/reschedule failure tests | Booking/Platform owner |
| PROD-07 Webhook and IAM | Provider auth, replay tests, RBAC/ABAC review, expert/admin lifecycle, penetration test | Security owner |
| PROD-08 LLM safety | Prompt-injection red team, scoped retrieval tests, typed-intent enforcement, no direct mutation path | Security/AI owner |
| PROD-09 Secrets | Clean scans, managed storage, minimum scopes, rotation and compromise drill | Security/Operations owner |
| PROD-10 Resilience | Fault injection, reconciliation, alerting, DLQ replay, restore drill, RPO/RTO evidence | Operations owner |
| PROD-11 Operational readiness | On-call roster, runbooks, incident classification, kill switches, support and rollback drill | Operations/Product owners |
| PROD-12 Limited pilot | Synthetic staging complete, approved small cohort, live monitoring, daily reconciliation, rollback criteria | Release authority |

Checkboxes in a document are not sign-off evidence. Each approval must link to a
dated test result, review record, or drill artifact for the exact release.

## 17. Non-waivable NO-GO conditions

Production must not start, and an affected live capability must be disabled, if
any of the following is true:

- A client or expert can read another subject's data.
- Crisis handling depends on paid balance or an unstaffed promise.
- A webhook can mutate state without authenticated actor and replay protection.
- Message, payment, coupon, or booking operations are not idempotent.
- Financial balance or booking capacity can become negative or exceed capacity.
- Google Sheets, Make, or the LLM is authoritative for money, bookings, consent,
  identity, or safety.
- Real credentials appear in repository content, exports, prompts, logs, or
  support material.
- Retention, deletion, minor handling, or provider data flows lack approval.
- Reconciliation, alerts, rollback, or incident ownership are absent.
- Any required production sign-off is missing or stale.

Cross-tenant disclosure, crisis-route failure, accepted forged webhook,
double-debit, capacity corruption, or credential exposure triggers the incident
runbook and immediate pause of the affected channel. Resuming requires root
cause, remediation, replay/reconciliation, and owner re-approval.

## 18. Evidence and review cadence

- Re-run the mandatory test suite for every release that changes identity,
  consent, prompts, safety policy, billing, coupons, bookings, provider adapters,
  or data retention.
- Re-verify crisis contacts on the owner-defined cadence and immediately after a
  reported failure.
- Review service-account scopes and rotate provider credentials on the approved
  schedule.
- Perform access reviews, restore drills, and prompt-injection regression tests
  on the documented cadence.
- Treat a changed provider contract, API authentication method, data residency,
  or webhook behavior as a new threat-model review trigger.

The release record must preserve the commit, configuration version, policy
versions, test evidence, sign-offs, known limitations, and rollback target.
