# Notification privacy completion gap

Status: source inspection, not release evidence. Production unchanged.

## Verified current behavior

- `PostgresPrivacyRepository.withdrawConsent` records the consent decision and
  enqueues `booking.handoff_revoked` in the same transaction. Withdrawal of the
  expert note also records a cascaded handoff decision.
- `bookingHandoffRevokedEventSchema` defines a strict local-control event. The
  lifecycle renderer does not treat it as a send.
- The notification runner calls recovery, capture, claim, callback issuance and
  prepared admission. It does not consume handoff revocations. The generic outbox
  repository's explicit topic allowlists do not include this event either.
- `eraseBookingNotificationRecipients` stops unstarted delivery and clears queue
  addresses and frozen identity bindings. It deliberately retains attempt chat
  bindings. Applied receipt facts can also contain the response chat identifier.
- In-flight uncertainty becomes manual/operator-visible. It is not evidence that
  Telegram deleted a message, nor permission to send it again.

## Next implementation boundary

Implement a separately named local revocation consumer. Validate the source event
against the actual consent journal, including subject, purpose and revocation or
denial decision. Persist idempotent accounting in the same transaction as source
completion. Do not infer a recipient from the current reservation expert, invent
a disclosure grant, or report a Telegram deletion from a local transition.

New minimal lifecycle templates do not disclose optional expert-note content.
Zero optional recipients must be an evidence-backed result, not a default for
untracked historical disclosure. Historical uncertainty needs an operator case.
Review lock ordering and generic outbox ownership before enabling the consumer.

## Retention decision is not approved

`docs/operations/data-retention.md` explicitly marks its schedule as not approved
for live data. Its proposed three-year metadata period and five-year reservation
period are subject to legal approval. Do not silently activate these periods.

Separate anonymization of resolved facts from the minimal binding required for
late receipts on unresolved attempts. Existing append-only constraints and foreign
keys must be inspected before choosing a schema change. Do not erase uncertainty
to make an erasure job appear complete. Backup expiry alone is not deletion proof.

## Verification boundary

This inspection ran no tests and changed no product code. Existing exhausted
notification delivery, callback and wire-admission test files remain exhausted.
A new local-control test file is justified only for genuinely new revocation
behavior, not to rerun existing suites under another name. Production activation,
provider deletion evidence and human acceptance remain separate requirements.
