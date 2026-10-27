# S3b second independent-review correction: R2a / R2b

Local synthetic evidence against control `eb110d74b10c98ad6d048449edf46c1c4ee801c2`.
No live Telegram/provider calls, model rebuild, deployment, or broad suite rerun.
All four previous artifact sets remain byte-for-byte unchanged. Root-owned contracts
and review/status/coordinator documents are excluded from this implementation commit.

## Correction and authority

Profile confirmation now deletes only deselected catalogue rows. Retained rows and
semantic labels remain in their existing stores, including a canonical identity
present in both stores. Existing semantic spelling is preserved. Newly selected
identities are added only when neither existing store already represents them.
A catalogue-only removal advances the revision without redundant selection-array
assignments. The existing deferred DELETE trigger validates its authoritative OLD
row; no caller-provided repair snapshot or claim is introduced.

An approved card also reopens to collecting and loses owner/manager confirmation.
Migration 0069 separates status events from content assignment events. The narrowly
bounded approved-to-collecting status transition can invalidate confirmation without
changing selected content. Equal-value selection assignments still invoke the strict
content guard: confirming an unchanged invalid selection is rejected. Final approval,
confirmation, content additions and unrelated-field safety checks remain enforced.

Recommendation deduplication keeps the first existing readable label. Candidate
labels are aligned with that retained label, preserving evidence numbering and
checkbox identity without changing canonical identity, score or evidence provenance.

## RED / GREEN

The new actual authenticated Telegram route witnesses use ordinary `/tags` and
recommendation callbacks, original update replay and the existing paid/consented
owner fixture. They make no external calls.

- **R2a approved RED:** on the control source, removing obsolete catalogue A while
  obsolete service B remains returns the owner error reply. The preceding unchanged
  invalid confirmation also rejects and leaves the card approved. With the correction,
  removal succeeds, transitions to collecting, clears confirmation and replays without
  mutation; the full prior immutable version stays byte-for-byte equal. Direct final
  owner confirmation remains denied while B is still invalid.
- **R2a collecting GREEN:** A is selected through `/tags`; existing semantic `ПА`
  also has a catalogue occurrence. Removing A through profile recommendation preserves
  both retained occurrences and their storage scopes/spelling. The remaining obsolete
  guided tag can then be removed through its ordinary scope.
- **R2b RED:** both initial scope orders show `#панические_атаки` instead of the
  retained `ПА` in the actual keyboard on the control source. Both now retain `ПА`
  through guided/pending cleanup; exact-evidence numbering stays 1, never 0.
- Existing obsolete/repeated-blocked-selection and unrelated-answer guards pass in
  the same focused semantic run: **5/5** total. The complete-card R4 moderation
  witness and approved repair pass **2/2** against the final SQL. R4 still pins
  pending/rejected/stale denials to the intended moderation error, accepts a current
  decision, and preserves immutable version/decision association after later edits.

The earlier two collecting RED attempts failed in fixture setup (a selected catalogue
button has a tick prefix; then the manually prepared duplicate lacked `user_id`).
They are retained as harness failures, not claimed as product reproductions. The
first approved RED assertion expected an exception, whereas ingress correctly returns
an error reply; its corrected run reaches the actual removal failure. All original
failed logs and corrected runs are preserved in the additive archive. Each focused
integration file was invoked three times; there was no broad suite repeat.

## State and checks

Full hand-authored chain replay and fresh introspection on isolated PostgreSQL 17.5
succeeded: 213 tables, 156 functions, 194 triggers, 1,449 constraints, 533 indexes,
two extensions. Only 0069 and its derived state changed; the older migration chain
and journal are unchanged. The extra constraint trigger accounts for both count
increments. Exact state/history/scope guards passed **24/24**.

Database build/typecheck, complete tests typecheck, changed-source lint, formatting
and whitespace checks passed. The new helper is a tracked test support file and
requires no untracked evidence directory. Existing helper/model measurements and
ordinary-input/rollback proofs remain the previous accepted evidence; they were not
rerun because their source contracts did not change.

The [manifest](residency-semantic-tags-second-review-2026-10-27/manifest.json) records
commands, exits, raw/compressed hashes, preserved manifests and final source pins.
Archived drivers read protected local connection configuration only in memory and
sanitize output. Restore the reconstruction driver to its recorded ignored path and
provide the local protected configuration to reproduce; no credentials are archived.
This is local synthetic review evidence, not release or production authorization.
