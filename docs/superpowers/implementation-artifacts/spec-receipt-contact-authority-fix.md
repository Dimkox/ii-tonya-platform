---
title: Current receipt-contact authority for payment activation
type: bugfix
created: 2026-10-12
status: in-progress
baseline_commit: 690797db64fd80aa1aeccea8003543de470d8c16
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/agents/expert-residency-team.md"
  - "{project-root}/docs/superpowers/specs/2026-08-14-yookassa-provider-design.md"
---

## Intent and evidence

Before composing YooKassa, enforce existing YKP-015: a stored contact cannot
authorize receipt disclosure after purpose withdrawal or policy supersession.
Current latestForOrder joins only the contact's original consent row, then filters
purpose/policy and returns it. A later denied/revoked decision is invisible.
Campaign orders also carry immutable payer identity in their saved quote, while
this reader currently follows the expert's mutable current owner.

The owner delegated implementation choices for the commercial product. This is a
bounded correction to existing authority, not a new legal/contact policy or
approval to activate payments. Local merchant/fiscal keys are present; purpose,
policy and receipt encryption reference are empty. No secret values were exposed.

## Constraints and interface

Keep PostgresYooKassaReceiptContactAuthority.latestForOrder(orderId,purpose,policy)
and its encrypted-only result interface. Do not decrypt, write contacts, mint
consent, choose policy values, restore an entrance signing gate or call a provider.
No migration, financial repository change, old exhausted-suite rerun or deployment.
Use existing currentConsentSatisfiedSql/currentConsentGrantedSql, not a new
latest-decision formula. Latest timestamp ties containing any non-grant or a
different policy deny. Unrelated purposes do not revoke this purpose.

Require the contact's linked consent to be current (at the latest purpose
timestamp), all original subject/purpose/policy/decision bindings, a granted
current decision under the configured policy, and an active subject. A later
regrant must not resurrect a contact linked to an older consent; require fresh
contact evidence. A new denial must never fall back to an older contact.

For expert_campaign_v1, resolve payer through campaign_quote_id and the quote's
immutable user_id. A missing/mismatched campaign quote fails closed; do not fall
back to expert.user_id. Current expert ownership changes must not redirect receipt
disclosure to another user. Keep the existing expert-owner path for historical
non-campaign policies, and explicitly record its lack of an immutable historical
payer snapshot as a remaining legacy activation limitation.

## Tasks & Acceptance

- [ ] Given an active original payer, matching current grant and verified encrypted
      contact, return that contact without decrypting it or making any write.
- [ ] Given a later denial/revocation, same-time grant/deny tie, newer policy,
      missing grant, mismatched source evidence or inactive subject, return null.
- [ ] Given revoke then regrant, reject old contact; accept only a new contact
      linked to the new current grant. A later unrelated-purpose decision changes
      nothing. A newer denied contact cannot reveal an older granted contact.
- [ ] Given a campaign order and subsequent expert-owner reassignment, return only
      the original quote payer's eligible contact, never the new owner's contact;
      original payer withdrawal/inactivation still denies. No fallback on missing
      quote. Leave financial order/quote snapshots unchanged.
- [ ] Prove these cases on real isolated PostgreSQL17.5 using the existing authority
      reader and receipt source boundary, not source-string inspection or mocks.
      Include malformed input zero-query behavior and historical happy-path
      compatibility without claiming immutable legacy payer proof.
- [ ] Build/typecheck DB/tests; scoped lint/format/diff checks; record bounded runs
      and stable handoff for independent review. No commit/push or remote mutation.

## Ownership and execution

One implementer owns packages/db/src/repositories/yookassa-receipt-contact-repository.ts,
new tests/integration/yookassa-receipt-current-authority.test.ts and
docs/test-evidence/yookassa-receipt-current-authority-2026-10-12.md only. Existing
consent oracle, schema, financial repositories and old tests are read-only.
No nested agent. Main owns status/shared runbooks. If necessary authority cannot
be preserved within this boundary, report the concrete dependency first.

Run RequireDocker environment preflight. Read testkit/consent constraints and use
actual canonical fixture names/timestamps. TYPECHECK the new tests before their
first execution to avoid wasting the bounded RED run on collection errors.
New file3 total: author RED1/GREEN2, coordinator3 after review. The existing reader
provides the real baseline; add failing withdrawal/payer tests before changing it.
Use retained synthetic PG17.5, random isolated database only; no other suite or
real provider. Record fixture/collection failures as consumed runs and never
invent behavioral RED. No new dependency or policy decision is permitted.
