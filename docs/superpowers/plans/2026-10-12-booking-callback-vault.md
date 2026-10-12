# Booking callback vault implementation plan

T3 pure encryption prerequisite of spec-booking-notification-delivery.md.
Coordinator owns only integrations/telegram/booking-callback-vault.ts and test;
Tesla retains all DB/migration files. No configuration/key provisioning or export
changes. This does not implement callback issuance, DB consumption or API routing.

Use Node AES-256-GCM, random12byte nonce,16byte tag. Store versioned opaque
ciphertext and key ID separately. Authenticate a fixed JSON tuple containing
deliveryId, notificationId, reservationId, expertId, botKey, private chatId,
action, reservation version and expiry epoch. All bind fields are validated;
canonical tuple order ignores caller property insertion order. Use domain prefix.
Only syntactically canonical ct2 tokens (version2,33byte payload) may be sealed.
Actual HMAC verification/one-use consumption remains existing callback authority.

Factory createBookingCallbackVault({activeKeyId,keys:ReadonlyMap<string,Uint8Array>})
validates1–8keys of32bytes and copies key material; active key must exist.
seal(token,binding) returns {keyId,ciphertext}; open(envelope,binding) decrypts
with identified key. Old retained keys allow rotation; unknown keys, tampered
envelopes or mismatched binding fail with one generic error, without raw input.
Only active key used for new seals. No time eligibility in crypto layer: DB fresh
post-lock time remains T3 consumption authority, not a caller-supplied clock.

Review focus: ciphertext/tag/nonce/key-ID substitution; every AAD field; opaque
tokens never stored as plaintext; distinct ciphertext on repeat seal; key mutation;
retained-old-key rotation; bounded malformed inputs; accidental expiry enforcement.

- [x] Tests first, observed34behavioralRED with compiling scaffold.
- [x] Actual implementation, focused34/34GREEN; final36/36 after coverage review.
- [x] Type/lint/format and independent review before integration.

Use existing test budget rules; no PG/concurrency/full-suite tests, provider calls,
commit/push/deploy. Any follow-up run count is recorded in evidence, not hidden.
