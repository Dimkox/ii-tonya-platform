# Booking notification delivery composition gaps

Read-only source audit after T3 callback composition, 2026-10-12.
This is implementation input, not a release approval or completed T4 plan.

1. `PostgresBookingNotificationRepository.admitAndConsume(claim, requestDigest)`
   validates only digest syntax. The locked facts it returns are later rendered.
   Therefore the stored digest currently does not prove the exact authorized
   HTTP body. Admission must bind serialized chat/text/buttons to the locked
   recipient, state and persisted callback pair before committing the attempt.
2. `booking-notification-transport.ts` serializes its own JSON object at fetch.
   A future independent digest serializer could diverge in field ordering or
   omission of null markup. Use one exact-byte serialization boundary and prove
   admission digest equals bytes passed to fetch; do not merely hash a view.
3. Migration0044 has no shared bot-pause control. HTTP401 and bot mismatch require
   durable bot-wide admission shutdown, not just process-local state. Already
   admitted calls may finish; do not claim remote sends can be recalled.
4. `resolveReceipt` already accepts matching late receipts, rejects conflicts and
   redacts callback ciphertext. Worker SQL failure after authenticated success must
   retain and retry only this receipt, never sendMessage. If the process dies before
   persistence, recovery must remain unknown/manual, not claim guaranteed delivery.
5. API client booking composition still constructs PostgresBookingRepository without
   notificationOrigin. New reservation context capture must be configured under its
   explicit admission capability; historical events must not gain a later consent.
6. Sender runtime/main and admission/send/recovery separation are not composed.
   A green callback endpoint does not imply users receive request buttons.

T4 design is assigned read-only to existing Tesla handle. No sender implementation
or migration assignment yet. Preserve T2/T3 focused PG budgets, both3/3 exhausted;
new tests must cover genuine new wire/control/runtime behavior, not renamed old
tests. Catalogue stays empty. No production flag or provider call in this audit.
