# Block C exact scope and state registration — 2026-10-23

Authority: [Block C contract](../superpowers/implementation-artifacts/spec-phase1-block-c.md)
and [execution contract](../superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md).
These exact registrations cover local private card preparation, reviewed materials,
explicit main-tariff acceptance and canonical paid publication. They grant no
provider calls, production activation, shared migration or release authority.

## Relations, routes and SQL objects

The exact 15 new relations are registered in both residency/database inventories:

- `expert_card_drafts`, `expert_card_entries`, `expert_card_reviews`;
- `expert_card_material_templates`, `expert_card_material_jobs`;
- `expert_card_promo_proofs`, `expert_card_promo_confirmations`;
- `expert_card_handoffs`, `expert_card_requests`, `expert_card_staff_actions`;
- `expert_card_consent_epoch`;
- `expert_card_main_acceptances`, `expert_card_main_orders`;
- `expert_promo_qualification_audits`, `experts_published`.

The consent epoch is a singleton transaction-conflict fence; it creates no consent
or financial authority. Material attempt/receipt constraints retain unknown outcomes
without fabricating delivery. Main orders/publication reuse existing immutable
quotes, canonical GET settlement and qualified reward semantics. Promo qualification
adds an explicit audited source variant alongside the old single-use code source;
first-source uniqueness and the existing 1000 RUB reward remain authoritative.

The integration barrel hash changes only for the independently reviewed actual
Telegram material transport factory/type exports. No new provider SDK or payment
integration sibling allowance is registered.

Five exact admin routes reuse existing manager sessions/MFA/roles:

- `/v1/admin/expert-cards`
- `/v1/admin/expert-cards/:applicationId`
- `/v1/admin/expert-cards/:applicationId/public-card`
- `/v1/admin/expert-cards/:applicationId/review`
- `/v1/admin/expert-cards/:applicationId/promo-review`

SQL0054 adds 17 functions and 21 triggers, with names explicitly registered in the
history inventories. It narrowly replaces `enforce_expert_campaign_order_source`
to admit an inactive applicant only through the new DB-owned accepted-card gates;
all existing quoted amount/currency/tariff/TTL checks remain represented in the
actual function catalogue. No generic mint/caller activation hook is added.

## Actual database-derived metadata

The frozen SQL SHA256 was
`4820d720ccf047a84cdea0aa3fe6b1c0dc4ce0a824e423ab8eabbabe838e6ed9`.
All 55 hand-authored journal migrations replayed on a separate disposable
`promo_state_0054` database in the task-owned PostgreSQL 17.5 instance. Protected
recovery settings were parsed only in memory; no stale Docker environment values,
credentials or URLs were printed, copied or committed. No functional PG test file
or shared fixture database was used by this owner.

Fresh empty-directory introspection 0.31.10 was normalized from positional live
constraint/index reads. The supported snapshot links to 0053. Exact catalogue
readback contains 150 tables, 63 functions, 105 triggers, 1013 constraints, 408 indexes
and 2 extensions. Every old trigger/index/constraint/extension is unchanged. The
only replaced old function is the explicitly authorized campaign order source.
The only existing table projections changed are `experts` (composite owner unique),
`expert_referrals` (audited promo source) and `expert_promo_registrations` (composite
registration owner unique). All other existing table projections remain unchanged.

The deferred approved-review FK is captured as actually DEFERRABLE INITIALLY
DEFERRED in the SQL supplement; Drizzle cannot express its deferral flags. Card
schema includes all 22 core CHECKs, including NULL-hardening and consent epoch.
The epoch bigint default uses SQL rather than a JavaScript BigInt literal.

The temporary database and introspection directory were removed after capture.
Ignored reproduction helper/log remain under `.superpowers/sdd/phase1-block-c-state/`.
The SQL, supported snapshot, SQL-only catalogue, manifest and journal are pinned
with literal normalized-content SHA256. Newest snapshot becomes 0054, table count
becomes 150; frozen historical gaps and BigInt-default inventory are unchanged.

## Verification

Schema DB typecheck, scoped ESLint, formatting and whitespace passed. Exact input,
snapshot/supplement hashes and prior-state deltas are checked separately. After the lead staged final source and tests, separate focused invocations passed:
scope 123/123 at 16:57:13 UTC and history 8/8 at 16:57:15 UTC. Each file ran once for
Block C, with no retry or functional/PG file invocation by this owner. No classifier,
internal mint boundary, unresolved-import rejection, provider allowance or negative
probe is weakened. Local metadata/static evidence is not release acceptance.

## PostgreSQL ARE media-bound correction

The integrated PG run found a real SQL error: PostgreSQL ARE rejects repeat bounds
above 255, including the intended media bound `{1,512}`. The sole SQL owner replaced
only the entry/proof media branches with explicit non-NULL checks, total length
15–526 and the same anchored allowed-character set using `+`. This preserves the
1–512-character file identifier contract and NULL rejection. Schema mirrors both
CHECKs. The new frozen SQL SHA256 is
`526ac3bd5fa9ac6edfee72128d2898ae19b1ea6555161091b897db0ed1f860f8`.

A full isolated 55-migration replay and fresh normalized introspection recaptured
both actual CHECK definitions. Counts and authorized prior-state deltas remain
unchanged; snapshot ID/linkage are preserved. Snapshot, SQL catalogue, manifest
and exact hash pins were updated. Temporary database/output were removed. Schema
lint, formatting and DB typecheck passed following the pinned launcher repair.
The failed launcher commands executed no test or validation body. After staging the correction, history invocation 2 passed 8/8 at 17:13:05 UTC.
Scope invocation 2 passed 122/123 but failed its recursive tracked-artifact scan's
existing 30000ms timeout (37086ms actual), with no concrete violation reported.
The timeout was not widened. The root authorized one quiet focused retry after
our other checks ended: scope invocation 3 passed 123/123 at 17:15:05 UTC, including
the recursive scan in 11407ms under the unchanged 30000ms bound. Failed invocation 2
is retained as diagnostic evidence; history was not rerun. No external processes
were changed and no functional test was invoked by this owner.
