# Booking Delivery Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Deliver real booking lifecycle messages through the production worker,
with transaction-authorized exact bytes and no resend of ambiguous attempts.

**Architecture:** Extend the reviewed delivery ledger rather than add another queue.
Prepare the exact Telegram request under database authority locks; commit its digest
and one consumed attempt before sending. Recovery persists known receipts only.

**Tech Stack:** Node24, pnpm11.9.0, TypeScript, PostgreSQL17.5 testkit, hand SQL.

**Spec:** docs/superpowers/implementation-artifacts/spec-booking-notification-delivery.md

Status: design handoff received; coordinator decisions below define implementation.
Owner delegated development process decisions; no production activation implied.

## Locked interfaces and decisions

`PreparedBookingSend = Readonly<{attemptId:string;deliveryId:string;botKey:string;
chatId:string;deadline:string;wireVersion:1;body:string;bodySha256:string}>`.
Add `admitPrepared(claim):Promise<PreparedBookingSend|undefined>` using injected
synchronous renderer and vault-open/MAC-hash ports under the existing authority
locks. Preserve the old admitAndConsume signature for historical callers/tests;
it is legacy evidence only and NEVER used by the new production runner. Share
validation internally rather than copy a second authority engine. New attempts
have wire_version1; existing attempts remain null, never retroactively upgraded.

Shared serializer `serializeBookingNotificationWire(input:unknown):string` lives
in contracts/booking-notification-wire.ts, coordinator-owned. It canonicalizes
chat_id,text,optional reply_markup, rejects extra fields and malformed text. Database
hashes its output; transport sendPrepared validates digest/binding and passes body
unchanged to fetch. No second rendering or serialization after grant commit.

0045 adds bot control: bot_key primary key, admission_enabled defaultfalse,
paused_at, bounded pause_reason, not_before, updated_at and wire_version marker.
Missing control denies new prepared admission/capture. Explicit provisioning must
not clear pauses; restarting a worker must never overwrite an operator disable.
Capture consults durable admission_enabled for ALL lifecycle producers, not only
reserve. Preserve contexts, existing deliveries and callback consumption when off.
Lock control last after existing authority/domain/delivery/callback/attempt locks;
every mutator must follow that order. Already committed sends may finish once.

Outcome port gains bounded reasonCode/pauseBot and full retryAfterSeconds. Persist
outcome, shared pause/throttle and alert atomically. Other workers observe pause
after commit, NOT during a DB outage. On persistence failure runner stops new
sends and retains one completion slot, retrying only the original receipt/outcome.
Do not claim global immediate blocking during DB failure or durable local spool.

Runner exposes runOnce(), stopAccepting(), drain(deadline:number). Claim ONE new
send just-in-time per cycle; process pending completion/recovery first. This avoids
20 sequential15-second requests outrunning60-second leases. Shutdown immediately
stops admission, waits bounded current call/completion, then closes DB. Crash before
receipt persistence yields unknown/manual without resend. Callback and Planerka
recovery flags remain independent. Terminal completed/no_show views omit calendar
cancellation evidence; confirmation requires verified bound provider completion.

## Global Constraints

- Preserve original recipient/consent and fresh post-lock time authority.
- Maximum20 claimed intents,60-second leases,15-second HTTP deadline,64KiB response.
- At most5 actual sends for proven non-delivery; unknown never returns to pending.
- Do not regenerate buttons, infer receipts or replay historical unbound events.
- Do not print credentials, message bodies, callback data or recipient identifiers.
- Keep callback consumption and local recovery available when new admission stops.
- T2/T3 PG files have exhausted3/3 runs. Do not rename or duplicate them to reset limits.
- No real provider calls, seeded catalogue or production changes during implementation.

## Review Focus

- A renderer or serializer mismatch must prevent HTTP, not store an unrelated digest.
- An admission that wins just before revocation may finish once; no stronger claim.
- Receipt SQL failure must not cause another sendMessage, including after lease expiry.
- Two processes must observe a durable bot pause after authorization failure.
- Shutdown must stop new sends and preserve uncertainty for interrupted attempts.

## Task 1: Exact-wire transactional admission and shared bot control

Files: notification repository, a shared exact-wire contract/serializer, hand migration
0045 if required, migration journal and reconstructed state, and a genuine new focused
wire-admission PG test. Do not change historical SQL or widen existing authority.

- [ ] Finalize the port after the read-only design handoff. It must return an immutable
  exact HTTP body plus attempt ID, bot binding and deadline, not a caller-supplied digest.
- [ ] Write failing cases for rendered-body/hash equality, persisted pair substitution,
  concurrent shared pause, paused zero-attempt admission, and terminal-state projection.
- [ ] Implement rendering through a trusted synchronous injected port while locks are
  held; database layer must not import worker or integration modules. Hash exact bytes
  inside admission. Reject renderer failure before consuming an attempt.
- [ ] Store and enforce bot-wide pause under a consistent lock order. Already consumed
  attempts may complete, but a pause prevents subsequent admission across workers.
- [ ] Hand-author required migration and journal entry. Reconstruct new metadata on
  isolated17.5, preserving previous45 SQL hashes and prior evidence artifacts.
- [ ] Run new focused file RED/GREEN, reserve third run for independent review. Run
  types/lint/format/diff checks; no old exhausted-file or multipath invocation.

## Task 2: Bounded sender and receipt-only recovery

Files: packages/worker/src/booking-notification-runner.ts and focused test;
integrations exact-wire transport boundary and its genuine new boundary tests.

- [ ] Write runner assertions: exactly one HTTP call per consumed grant; no HTTP for
  denied/expired/paused grants; every transport outcome maps to ledger evidence.
- [ ] Ensure transport sends the exact admitted string. Do not independently rebuild
  markup or text after admission. Existing endpoint, timeout and response checks stay.
- [ ] Preserve matching success receipt in bounded local recovery state if SQL fails;
  retry only receipt persistence. On restart without saved receipt, leave unknown/manual.
- [ ] Apply shared pause for401/bot mismatch; preserve full429 retry_after. Test two
  sequential cycles after SQL failure and pause; assert provider call count remains one.
- [ ] Bound batch work and shutdown. Add identifier-free counts, not raw errors.
- [ ] Verify focused tests and independent review before composing runtime.

## Task 3: Actual API capture and worker loop

Files: apps/worker/src/booking-notifications.ts, main.ts, runtime.ts, config/env,
API reserve composition, exports, focused worker composition tests.

- [ ] Separate admission, send and recovery capabilities. Enabled missing dependencies
  fail startup. Configure notificationOrigin on new reservation capture only when
  admission is enabled; never retrofit historical consent.
- [ ] Compose real callback issuer, renderer, ledger and HTTP transport. Default-off
  must produce no provider call; recovery must work with admission/send disabled.
- [ ] Exercise actual worker runtime scheduling, not a standalone runner double only.
- [ ] Run a bounded genuine new end-to-end fixture: reserve, sent buttons, bound
  callback, verified calendar completion and exactly one client confirmation; cancellation
  and expiry preserve truthful local/provider distinction. No live provider calls.
- [ ] Capture scoped evidence and request independent review. Do not claim full product
  release: retention/erasure, production restore/compatibility and other spec gaps remain.

## Completion boundary

This plan implements notification T4 and capture composition only. It does not waive
T5 privacy/release requirements, paid-price policy, Selarti bridge, provider credentials,
whole-product verification, RC publication, rollback evidence or human acceptance.
