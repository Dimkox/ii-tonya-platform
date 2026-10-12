# Booking callback composition implementation plan

Parent: spec-booking-notification-delivery.md T3. Continue after reviewed T2
70/70PG run3 and reviewed vault36/36. These files are not to be rerun. Goal is
actual persistent buttons and authenticated API consumption, not a test-only facade.
No live activation, real messages, catalogue data, key provisioning or deployment.

## Ownership and exact cross-task interfaces

DB implementer owns new `packages/db/src/repositories/booking-notification-callback-repository.ts`,
targeted `booking-repository.ts`, application `booking-service.ts`, necessary DB
exports, and new `tests/integration/booking-notification-callbacks.test.ts`.
No API, config, integrations or vault/transport edits. No new migration expected;
0044already contains callback links/hashes/ciphertext. If unavoidable, report the
schema need before changing the shared journal or0044verified metadata.

Coordinator owns API service/routes/server/app/config and API focused test. No
concurrent DB edits. Notify implementer before changing any shared interface.

`TelegramBookingCallbackContext` (structurally shared application/DB type):
`{botKey:string; telegramUserId:string; chatId:string; messageId:number; deliveryId:string}`.
Add optional `telegramContext` to ExpertDecisionCommand and repository callback
command; preserve existing callers. New linked notification callbacks MUST have
context, and callback rows for context-bound reservations cannot fall through to
legacy unbound authorization. Legacy behavior applies only to genuinely legacy
reservations lacking notification context; never a missing-link bypass.

New DB repository constructor `(db, botKey, crypto)`; crypto is a trusted local
port, not DB import of integrations. Expose:

- `findLinkedCallback(tokenHash:string):Promise<{deliveryId:string;reservationId:string;
  expertId:string;action:'confirm'|'cancel';version:number}|null>`: selector only,
  includes consumed rows for authenticated replay; no authorization claim.
- `issueApprovalPair(deliveryId:string):Promise<{confirm:string;cancel:string}|null>`:
  atomic creation or exact persisted reuse. No network, partial pair or token logs.

Crypto port signatures:
`issue(claims:{reservationId;expertId;action;version;expiresAtEpochSeconds}):Promise<{token:string;tokenHash:string}>`;
`seal(token,binding):{keyId:string;ciphertext:string}`;
`open(envelope,binding):string`. Binding exactly matches reviewed
integrations/telegram/booking-callback-vault.ts. Composition builds issue using
existing issueCallback and an in-memory capturing store; PostgreSQL persists
claims/hash and ciphertext inside one transaction. No store-global db call inside
that transaction. Token hashes must be the same nonce hash used by ct2 authentication.

## DB task: issuance, authorization and replay

- [ ] Add genuine new callbackintegration assertions before behavior changes.
- [ ] Under established document/subject/identity/reservation/provider/delivery
  lock order, validate original frozen expert identity, active verified expert,
  service, fresh future slot, reserved/no-provider-operation, current version and
  original callback linkage. Derive common pair expiry as floor of
  min(reserved_until,starts_at) epoch; must remain future after all locks.
- [ ] Create both notifications and their delivery links with matching token hash,
  exact claims, action/version/expiry and encrypted tokens atomically. On failure,
  neither row/token link survives. Reissue reuses same pair; no partial repair or
  regeneration after one member invalidated/redacted/consumed.
- [ ] Extend existing transactional callback transition, not a second domain engine.
  Lock all authority/reservation/provider/delivery/callback rows before reading one
  fresh DB clock_timestamp. Use that time for expiry, hold/slot freshness and domain
  transition; caller now is not authority. Recheck frozen bot/user/chat/identity,
  action/hash/version/link and recipient role. Matching known delivered receipt
  requires the webhook message ID; unknown send permits only the existing unique
  token, never invents a message receipt. Unadmitted or definitely unsent request
  cannot authorize a callback. Preserve original uncertainty facts.
- [ ] Confirm remains calendar_pending/reserved with exactly one provider operation;
  client confirmation only follows verified provider completion. Cancel keeps existing
  cancellation semantics. Same transaction consumes callback and performs transition.
- [ ] Authenticated replay after commit/lost HTTP response causes zero mutation.
  Prove consumption AND matching committed audit transition, not consumed flag alone.
  Existing BookingResult may add `replayed?:true`; replay returns original action's
  transition result, not a fabricated current booking state. Opposite/stale/foreign
  buttons fail without consuming; current identity authorization still applies.
- [ ] Tests cover actual issuer+real ct2/vault, atomic rollback, stable reissue,
  bot/chat/user/message mismatch, relink, inactive expert, stale and opposite action,
  concurrent opposite buttons, replay, and expiry crossed while waiting for a lock.

New PG file maximum3focused runs: gather cases before RED, GREEN second, reserve
third for review. First RED should be behavioral with compiling scaffolds, not
missing module. No old integration, renderer, vault or calendar test reruns.
Use retained synthetic Compose17.5 only; all metadata/priorSQL stay unchanged.
Run environmentRequireDocker, scoped types/lint/format/diff and independent review.
Return exact file ownership, test counts/results and any interface mismatch.

## API task (coordinator)

MAC-only ct2 authenticator exposes hash without prematurely enforcing expiry or
consuming; existing authenticateCallback paths remain unchanged. Service resolves
selector then uses createBookingService with telegramContext, so final authority
is the transaction above. Require configured bot, explicit private message chat
equal to safe positive from.id, safe positive message ID and webhook secret.
Route ct2 separately; bot-scoped inbox key, authenticate before duplicate response.
Lost response/inbox completion replay must still reach DB replay logic. ACK is
best effort and never repeats booking transition. Do not change cv1/xr1 behavior.
Default-off BOOKING_CALLBACKS_ENABLED must compose real DB/service/crypto in actual
server; missing identity/HMAC/vault key capability aborts startup when enabled.
Do not use the legacy TELEGRAM_ENABLED flag to enable unrelated financial flows.

## Boundary decisions

Optional context preserves legacy interfaces, not weaker new-flow authorization.
Crypto helper handles opaque persistence only; no caller-side clock determines
transaction eligibility. SQL predicate and domain share the post-lock DB instant.
Key provisioning/retention and live callbacks during rollback remain release gates.
T4 exact wire digest, runner and admission/send/recovery flags remain separate work.
