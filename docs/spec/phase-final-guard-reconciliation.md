# Final branch guard reconciliation — 2026-10-23

The first final branch gate on90495c48 failed six repository guard files. Shell,
formatting, whitespace, evidence integrity, changed-file lint and full tests types
passed. Root retained `/tmp/phase1-through-phase2-final-gate.log` and six
`/tmp/phase-final-*-diagnostic.log` focused reproductions. These were deterministic
failures, not timeouts. No passing branch gate is claimed until coordinator rerun.

## Exact approved inventories

`expert-referral-scope-guards.test.ts` still expected the original031ae460 inventory:
5paths,22migration paths,48relations,8routes,10flags. The independently reviewed
Phase0 guard reconciliation47e6680e already had6/23/70/16/10, and locally accepted
A–D produced6/27/102/26/14. The test's literal expected arrays are now synchronized
to those existing approved sets, with no production classifier expansion or
assertion removal. Nine denial probes remain unchanged. This is not a runtime
expected-value derivation: all expected names remain literal and exact.

- The internal verified-event module was explicitly reviewed in
  `phase0-guard-registration-audit.md`; its privileged mint remains excluded from
  barrels and exact importer restrictions remain intact.
- Phase0's application0051 and inherited approved coupon/paid-order, payer-receipt,
  booking-notification, Planerka, campaign and expert-session inventories are covered
  by that audit and `phase0-guard-reconciliation-2026-10-23.md`.
- A0052, B0053, C0054 and D0055 add the approved promo/enrollment, purpose-bound
  onboarding, card/publication/qualification and lifecycle tables respectively.
  Exact schema/state provenance and integration evidence are recorded per block.
- New routes are the protected A promo ingress and B/C staff endpoints; inherited
  browser/session/checkout routes retain their already reviewed boundaries.
- The only additional feature names are the four approved default-off D lifecycle,
  command, notice-delivery and renewal-checkout flags. No admin action was added.

The integrations barrel changed only by adding Phase2 reviewed inactive VK/MAX
ports, disabled adapters and pure request/response helpers. Its normalized SHA256
is `857ba70d19d695f08a7bd6b8e0a497a078525a6caa118a729bfc082b455e672b`.
Independent connector review plus57 focused tests and normal build were already
accepted. The exact hash pin changes; all mutation and privileged export checks
remain. No broad module exemption or active transport was added.

## Other guard findings

- Drizzle parity exact arrays acquire SQL0048 campaign binding and0054 owner/promo
  constraints already present in reviewed SQL/schema/actual PG state. Legacy code
  owner FK and all prior invariant names remain.
- Hybrid journal parity preserves the full historical0041 entry assertion and
  separately asserts the actual contiguous0055 tail; it no longer assumes0041 is
  permanently the final migration.
- `.env.example` corrects only placeholder convention for
  EXPERT_TELEGRAM_BOT_TOKEN and EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET. No values are
  recorded here; env-policy rule and runtime flags remain unchanged.
- Receipt contact current-consent moment binding was duplicated in inherited
  production SQL. That semantic fix must use the canonical consent-current helper,
  preserving latest-moment all-granted policy, tied-denial and exact old contact
  non-revival. No guard exception or removal of authority binding is permitted.

Independent review, focused corrections and actual final results are recorded in
`docs/test-evidence/phase-final-guard-reconciliation-2026-10-23.md`.
