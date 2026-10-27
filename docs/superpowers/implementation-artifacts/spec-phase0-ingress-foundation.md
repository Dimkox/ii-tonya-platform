---
title: Phase 0 ingress safety and payment notification foundation
type: feature
created: 2026-10-23
status: in-review
baseline_commit: d32da25dcdaf54ceb2039049ab348b3b54e9e2d4
review_loop_iteration: 0
context:
  - AGENTS.md
  - docs/agents/expert-residency-team.md
---

<frozen-after-approval reason="owner approved Phase 0 and autonomous execution">

## Intent

Implement locally testable P0.3/P0.4 gaps by reusing existing authenticated Telegram,
erasure-request and real YooKassa connector boundaries. No physical-erasure or
external-webhook completion claim without execution/provider evidence.

## Boundaries & Constraints

Always: private owner-bound deletion initiation, fail-closed capabilities, no LLM
routing of deletion command; immutable financial evidence stays intact. Suspicious
request logging must protect personal data with keyed fingerprints; raw IP/UA,
headers, tokens, payloads and arbitrary error messages must not reach telemetry.
Never: provider calls, live configuration changes, deployment, plaintext secret
storage, tests beyond repo limits, editing the DB task's files. No push.

## I/O & Edge-Case Matrix

| Scenario         | Input / State                                            | Expected                                                              | Error                                           |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Delete           | Authenticated private exact /delete_data                 | Resolve server-owned identity, request erasure; no completion promise | Unavailable if disabled                         |
| Forged delete    | Group, forwarded, bot sender, foreign chat/from          | No erasure call                                                       | Reject/ignore                                   |
| Replay           | Same Telegram update                                     | Same durable request, no repeated destructive action                  | Retry-safe                                      |
| Suspicious HTTP  | Rejected auth or rate limit                              | Bounded reason + keyed IP/UA fingerprints                             | No raw data leak                                |
| Capture wait     | payment.waiting_for_capture, authoritative GET agrees    | Acknowledge without settlement/resolution/capture                     | Retryable if GET unavailable or binding differs |
| Capture mismatch | Spoofed body status or foreign payment/mode/amount/order | No effect                                                             | Reject/retry                                    |
| Existing events  | succeeded/canceled                                       | Existing verified behavior unchanged                                  | Existing semantics                              |

</frozen-after-approval>

## Code Map

Worktree: /home/pall/projects/ii-tonya-base/work/ii-tonya-platform/.worktrees/phase1-owner-plan-20261023.

- `apps/api/src/routes/telegram-webhook.ts`: authenticate before parsing; two ingress
  routes; place exact command handling before conversation/promo/expert AI routing.
- `packages/application/src/erasure-request-service.ts`: owner-bound request/status,
  receipt digest, accepted/denied/conflict/unavailable; reuse for request initiation.
- `apps/api/src/app.ts` / `server.ts`: pass optional capability, fail-closed default;
  physical erasure is intentionally not exposed. Existing feature ceilings remain.
- `packages/observability/src/telemetry-schema.ts`: strict event allowlist; raw IP/UA
  currently discarded. Add only narrow safe schema for security fingerprints.
- `apps/api/src/routes/yookassa-webhook.ts`: peer allowlist, inbox dedup, retryable
  verification, deliver/resolve only for non-null canonical event.
- `packages/integrations/src/yookassa/contracts.ts`: waiting_for_capture payment
  object valid but notification enum omits it.
- `packages/integrations/src/yookassa/verifier.ts`: GET verifies bindings; pending and
  waiting return null, canceled durable update, succeeded returns branded event.
- `packages/integrations/src/yookassa/webhook-capability.ts`: null allowed only on
  canceled. Add explicit authoritative waiting acknowledgment; no automatic capture.
- Official process and webhook docs: https://yookassa.ru/developers/using-api/webhooks
  and https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process.

## Tasks & Acceptance

Owned files: API Telegram/webhook/composition and tests, new narrow Telegram deletion
adapter/tests, observability security event helper/schema/tests, YooKassa contracts,
verifier, capability/tests; `docs/operations/phase0-local-readiness.md`; optional local
test environment example. Do not edit DB/schema/migrations or web cleanup files.

- [ ] Write meaningful failing tests first for deletion and waiting events; implement
      then prove GREEN. Separate focused files, no aggregate/multi-path Vitest command.
- [ ] Prepare real wired Telegram deletion handler with optional owner resolver and
      existing request service. Strict exact command, private human chat ownership, no
      target from text, no forwards, no raw data forwarded to manager/LLM. Retries must
      not mint unbounded receipt tokens or conflict with existing user-owned requests.
      Wire capability through app dependencies. Default runtime remains unavailable
      unless required authenticated identity and erasure request capabilities exist.
- [ ] Add security event fingerprints via per-process random HMAC key or explicit
      injected key (no new secret configuration required); normalize trusted request.ip,
      bound UA before hashing, ignore forwarded headers. Emit on suspicious Telegram
      authentication/rate-limit failures; strict enum reasons. Never echo fingerprints
      to user. Test actual logger serialization and secret-marker absence.
- [ ] Support payment.waiting_for_capture only after authoritative GET verifies full
      binding. Null from generic verifier alone cannot distinguish waiting from pending;
      add explicit verifier path/result without weakening succeeded/canceled verification.
      Tests include pending, mismatch, terminal stale notifications, failures and replay;
      ensure zero deliver/resolve on capture wait. Do not auto-capture held money.
- [ ] Provide placeholder-only local YooKassa test profile with mode=test and all
      flags disabled; explicit external activation steps and owner-supplied protected
      merchant settings. No .env copied from primary checkout. Check .env location
      occurrences without printing values. No network calls to merchant/provider APIs.
- [ ] Document existing manager masking/authorization reuse and remaining external
      erasure/backup and provider verification gates honestly; no legal compliance claim.
- [ ] Lint/typecheck/format/diff relevant files. Report failures and exact commands.
      Do not commit; coordinator commits after review. No full-suite execution.

Acceptance: Given unknown/unavailable identity, deletion fails closed before LLM.
Given a valid private command, an owner-bound request is accepted idempotently with
pending wording. Given waiting webhook, no paid entitlement appears. Given suspicious
requests, logs contain only bounded event data and keyed fingerprints. Existing
succeeded/canceled paths remain covered by focused regression tests.

## Verification

Dependencies are frozen-installed. Build only package dependencies required by tests.
Run each affected focused test file once RED and once GREEN as applicable; no PG test
owned here. No multi-path/full-suite Vitest command. If an earlier baseline failure
occurs, report it before repeated runs. Maximum three focused runs per file.

## P0.3 review correction — 2026-10-23

The Telegram adapter now accepts only `TelegramDeletionCapability.request` as an
atomic authority. `apps/api/src/telegram-deletion-composition.ts` combines
`PostgresErasureRequestRepository.acceptTelegram` with the existing verified
request projection. No separate owner lookup authorizes an erasure request.

The existing `integration_inbox` stores a domain-separated stable bot-ID/update-ID
SHA-256 key, command/identity digest and pinned user UUID or denial marker under
`telegram_erasure_v1`. The transaction locks event, user and identity in that order,
revalidates active private binding and serializes request creation. Retained
anti-replay tombstones survive identity changes and key/path rotations. No schema
or migration is introduced for this correction. Removal/retention policy changes
for these authority records require separate review.

A protected webhook key (minimum 32 bytes) derives an `er1` receipt with a dedicated
HMAC domain and stable bot/user binding. A receipt is returned privately only when
its digest matches the unrevoked stored request digest; browser-issued/revoked/key-
rotated receipts are not replaced. Replies render verified request stage; unavailable
proof cannot claim completion. Wrong-bot path rejection also emits the bounded
security event, even when HTTP response remains 200.

- [x] Prove corrected PostgreSQL admission, concurrency, rebinding, identity
      revocation, gate forwarding, receipt recovery/privacy and key/path rotation
      in `tests/integration/telegram-deletion-atomic.test.ts` within its 3-run budget.
- [x] Review corrected exact source before final PG invocation, then complete
      scoped typechecks, lint, formatting and whitespace checks.

Verification: PG invocation 1 failed import collection; invocation 2 produced
8 expected failures/1 pass against the previous repository; reviewed final
invocation 3 passed 10/10 on PostgreSQL 17.5. No further invocation of that file is
permitted without explicit owner authorization. Remediation units 10/10, revised
adapter 13/13 and revised non-PG ingress units 4/4 passed. API/DB typechecks, tests
TypeScript, scoped lint/format and whitespace checks passed. No commit or external
activation is included in this implementer handoff.
