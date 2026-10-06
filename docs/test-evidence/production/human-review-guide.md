# Human review guide — ii-tonya.ru

Review the published product at https://ii-tonya.ru, not a local development URL.
This guide is not a product-acceptance certificate. Current release identity and
deployment checks must be read from the latest production evidence and SOURCE_SHA.

## Reviewer paths

1. Open `/`, `/catalog`, `/privacy` and `/oferta` on desktop and mobile. Public
   catalogue is intentionally empty by owner decision; no demo experts or slots
   should appear. Public browsing must not require payment, AI consent or history.
2. Open `/account`. In a regular browser follow the client-bot link, then open
   **Личный кабинет** from its Telegram menu and explicitly log in. Browser widget
   login is disabled. Record any error; do not substitute a synthetic signed proof.
3. After fresh verified login, inspect the booking section, empty catalogue and
   own-record reconciliation. Reservation creation is paused. Existing sessions
   predating booking-grant activation need logout/login; they are not promoted.
4. Open `/my-data`; download the JSON export. Each recorded consent's `document`
   should contain its original version/body/hash, not a later replacement.
   Legacy/unbound decisions have null. With no recorded decisions this is an empty
   list, not live proof of historical-document behavior.
5. Check `/account/` and back navigation. Restore from browser cache should reload
   and recheck the session; actions must not be automatically repeated.
6. Log out; private data/actions must no longer be available. Public pages remain
   available. Do not submit personal history, health information or third-party data.

## Known incompleteness — not waived by this guide

- Authentic-user Telegram login has not yet been observed by the coordinator.
- No approved purpose-specific consent documents were present at last inventory.
  Opening/accepting those documents is not a passed live scenario. Public policy
  and offer are not substitutes for separate purpose documents.
- Deletion through the cabinet is unavailable. No deletion request is sent by the
  displayed notice; processor/backup completion must not be inferred.
- The real catalogue is empty and reservation creation disabled. No live expert
  booking, confirmation, payment or provider delivery is claimed.
- Detailed special-category conversation/signing is outside the ordinary launch
  route. Removing signing from onboarding does not enable free-text processing.
- Factory completion and Trust CI integration are excluded. External acceptance
  is absent; local tests/signatures do not replace it.

For each review finding record route, visible steps, expected/observed behavior,
time and source SHA. Do not put tokens, raw personal exports or credentials into
issues/screenshots. The full goal stays open until required gaps are closed and
publication is verified; the reviewer's judgment is never automated or fabricated.
