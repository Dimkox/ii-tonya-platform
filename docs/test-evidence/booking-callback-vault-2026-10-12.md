# Booking callback vault local evidence

Isolated T3 encryption prerequisite; coordinator-owned integrations/telegram/
booking-callback-vault.ts and same-name test. No database/API/worker/exports or
key provisioning changes. Parent full product and callback consumption remain open.

Focused unit evidence on2026-10-12:
- Run1 at17:10:20UTC:34/34behavioral failures against compiling empty scaffold.
- Run2 at17:11:05UTC:34/34passed,552ms total. No existing test rerun.
- Synthetic32byte keys only; no real secret, external call or production mutation.

Coverage: exact roundtrip, random nonce, every recipient/action/expiry AAD field,
nonce/cipher/tag mutation, retained-old-key rotation, defensive key copying,
invalid key lengths/key selection, canonical token/envelope, bounded malformed
input and independence from local expiry eligibility. Expiry authority belongs
to fresh DB time at callback consumption, not encryption.

Independent reviewer Locke01a13118-f2a4-7f63-a699-4e0abab0bff4 completed: no
implementation defect found in isolated scope. Two coverage suggestions added:
same key bytes under different IDs must not permit AAD key-ID substitution;
noncanonical base64url pad-bit alias must be rejected despite identical decoded
bytes. No production change for either. Run3 at17:12:51UTC:36/36GREEN,562ms.
Integrations/tests typechecks, scoped ESLint, Prettier and git diff --check passed.
Follow-up tests typecheck/lint after coverage additions also passed. Total3runs.
T3 atomic pair persistence/issuance, original tuple/HMAC validation, transactional
one-use consumption, live API composition and callback acknowledgements remain.
