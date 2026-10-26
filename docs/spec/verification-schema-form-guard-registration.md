# Resident verification Schema+Form Logic guard registration — 2026-10-26

Authority: `docs/superpowers/implementation-artifacts/spec-verification-schema-form.md`.
This is the first pre-price intake increment, default-off. No manager decisions,
prices, invoices, activation, document download, OCR, URL fetch or provider work.

## Exact additive inventory

Migration0057, snapshot57 and `state/0057_verification_sql_objects.json` are pinned
by exact SHA256 in the existing scope guard. The journal hash advances by one
contiguous entry. Historical SQL/snapshots/hashes remain unchanged. Snapshot57
adds five tables to169, plus the channel-identity owner composite unique and
`users.current_verification_stage`. The full SQL chain was replayed on task-owned
PostgreSQL17.5; fresh introspection was normalized using migration-state.ts.
Only new tables and the two additive existing-table projections are promoted.
The companion records8functions,5triggers,42constraints and11indexes affected by
0057, including original PostgreSQL definitions and validation flags.

The exact new relations are `residents_applications`,
`resident_verification_application_updates`, `resident_verification_check_work`,
`resident_verification_requests` and `resident_verification_cohorts`. They enter
the existing literal inventory; copied/suffixed relations remain forbidden.
The only added flag is `EXPERT_VERIFICATION_FORM_ENABLED=false`; extending the
flag recognizer to VERIFICATION strengthens rejection of unapproved siblings.
No route, privileged manager action, dependency or release automation is added.
`verification-form-boundary.test.ts` pins hashes and rejects altered bytes,
shadow migrations/relations and sibling flags; exact inventory tests still apply.

## Physical schema mapping and authority

`residents_applications.draft` is the validated version1 applicant record and
allows missing required answers until submission. Generated `role_type`,
`target_category`, `tax_status`, `location_city`, `motivation_text`,
`social_links_json`, `education_refs_json` and `property_refs_json` expose typed,
queryable owner schema fields without divergent duplicate applicant state.
The social projection maps the submitted URL hostname to its URL list; a hostname
is an organizational key, never proof of platform ownership or a verified account.
The original submitted HTTPS URLs remain in the draft. Education/property refs
are private Telegram file IDs, bound to the original bot/channel identity; optional
size/MIME metadata remains null when Telegram omits it. Declared unsupported MIME
or excessive size is rejected. These are pending-upload references, not S3 URLs,
published documents or proof of ingested bytes.

`telegram_user_id`, bot scope and `channel_identity_id` are derived from the
private authenticated ingress. A composite FK binds the identity to internal
`user_id`; SQL also checks the original active private mapping. `application_updates`
from the owner schema maps to `resident_verification_application_updates`: bounded
applicant patches and follow-up text only. Question cursor updates are recorded
for durable editing. The immutable submitted snapshot is separate from later
supplemental answers.

`system_check_result` is constrained to unknown/pending/pending-upload;
`manager_notes` is reserved null. Status vocabulary includes future decisions,
but SQL rejects manager transitions in this increment. A status string therefore
cannot mint price eligibility. Trusted versioned education policy is persisted
and frozen per application; the default has no niche rule and is explicitly
unknown/manual-review. A required-policy fixture proves missing document refs
block both service and SQL submission. No law or category criteria are invented.

`users.current_verification_stage` projects the intake's progress transactionally;
it resets to NONE when intake data is removed. It never authorizes money/access.
Internal UUID-only cohort membership survives intake erasure/consent withdrawal,
so disabling the UI flag or removing PII cannot revive legacy pricing. Receipt
PII/results are tombstoned; drafts, updates and pending check work cascade away
before channel identity deletion. Existing issued quotes and settled residency
facts select the legacy flow and retain their original financial clocks.

Intake classification, original consent, erasure and new anchor/quote admission
share the canonical subject advisory barrier. The price predicate is VOLATILE so
an admission trigger reads committed membership after any lock wait. Enabled
consent grant and existing-owner enrollment admit the new cohort atomically.
There is no later approval implementation in this increment: all intake cohorts
remain fenced, including after submission. A future reviewed manager provenance
migration must deliberately change that gate.
