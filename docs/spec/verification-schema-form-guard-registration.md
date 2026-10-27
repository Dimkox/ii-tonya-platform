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
The companion records9functions,5triggers,43constraints and12indexes affected by
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

## Reviewed remediation — 2026-10-26

Role patches retain the explicit primary-role deletion marker through cloning,
validation, fingerprinting and merging. Text and inline role changes clear an
incompatible primary without losing other answers. Intake media is accepted only
at an applicable document question; files after submission become typed private
supplements, never edits to the frozen submitted snapshot. Document controls can
remove, clear or replace active draft references, including at the ten-item cap.
Optional education has Skip/Back; required missing documents remain non-skippable.
Private history still belongs to the existing erasure/consent lifecycle.

Normal HTTPS scheme/hostname case is canonicalized. A conservative DNS-host HTTPS
subset rejects userinfo, explicit ports, whitespace and backslashes;
SQL enforces the same submitted URL subset and projects host keys case-insensitively.
Text/caption prohibited controls are rejected by domain and SQL. Before SQL, the
serialized draft is capped at64000UTF8bytes, conservatively below the100000-byte
JSONB constraint; a rejected aggregate leaves the saved draft unchanged.

`resident_verification_followup_valid` constrains supplemental answer/document
shape and bounds. The partial `resident_verification_requests_subject_idx` on
non-null user_id serves actual erasure/consent cleanup. Receipt retention remains
governed by that existing lifecycle; this increment adds no TTL or retention policy.
A persisted education-policy mismatch yields a read-only manual-review message,
not questions under a new policy. Disabled form admission cannot expose pending
cohort prices or advertise a usable tariff entry. Capability validation refuses
both upward and downward mismatches with trusted configuration.

Confirmation uses bounded saved facts and document counts, with Russian role/tax
labels and unchanged internal enums. It never shows Telegram file IDs or complete
long private fields. Inline callbacks return the next/current question through
the webhook sendMessage response. There is no separate answerCallbackQuery network
transport in this increment, so a client spinner can remain briefly. No bot token
or provider transport dependency was added solely for that acknowledgement.

The first form prompt also retains the pre-existing non-price promo code, guide
status and frozen-bonus information. It does not carry the legacy tariff listing
instruction. The decoder distinguishes valid-but-unsupported user content from
malformed structure: unsupported declared MIME/size, overlong form text and old
controls after feature disablement receive corrective200 without a service call,
after authentication and the existing per-user rate limit. Malformed structures
remain400 and failed authentication401. This changes no SQL or pricing boundary.
