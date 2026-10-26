# Resident content safety

Contract: `docs/superpowers/implementation-artifacts/spec-resident-content-safety.md`.
This mechanism moderates private resident drafts and the existing four public card
fields. It is independent of the client copy guard and makes no provider/LLM calls.

## Bounded policy language

SQL0061 owns `resident_safe_regex_v1`. Registry strings are never passed to a
JavaScript or PostgreSQL regular-expression engine. The compiler accepts literal
text, escaped punctuation (`\.`, `\/`, `\#`, `\%`, `\-`, `\_`), optional paired
outer `\b`, `\s+`, `[км]`, and one flat outer alternation of literal/token branches.
The only `\d+` templates are `доходность\s+\d+%` and
`заработок\s+\d+[км]\s+в\s+день|неделю|месяц` (each full branch is enumerated).
Nested groups, lookarounds, backreferences, arbitrary character classes, repetition,
and free-standing numeric patterns are rejected. Each rule has at most 512 UTF-8
bytes, 16 alternatives and 16 atoms per alternative; at most 256 active rules apply.

Evaluation normalizes each field once using NFKC, whitespace folding and the pinned
PostgreSQL `C.utf8` collation for Unicode case/boundary classification. Fixed built-in
regular expressions handle whitespace, letter classification and splitting only;
none execute registry text. Token matching is bounded to 131072 atom steps per
rule/field. Input limits are 125 fields, 64000 UTF-8 bytes per field, 100 bytes per
field identifier and 2 MiB aggregate field values. Repository transactions retain
2 s statement and 1 s lock timeouts. Exceeding any budget denies the operation.

Caps warnings count only cased letters: exactly 50 percent passes, above 50 percent
warns, zero cased letters passes. Invisible formatting controls are blocked with a
constructive field-level reason. Accepted raw text is preserved. Rule matches are
not stored as fragments. Medical/financial/hate/scam rules block; political and
magical content warns. Ordinary CAT_03 taxonomy is not prohibited.

The source-derived inventory has 35 effective rules, split where necessary to fit
the 512-byte bound. Every row records source provenance and a positive witness.
Corrections include `вылечу`, disease inflections and ё forms, percentage endings,
and the source's Latin `a` in `единственнaя`. Only the five explicit insults are
seeded. Shortener/invitation prefixes are prohibited; the source's lookahead is not
an authenticated official-link exception. The malformed `все остальные во\nlаке`
fragment is quarantined as `TODO: Wait for Content Spec`, is not executable and
is not counted. The placeholder racial-insult class is not executable either.

## Atomic SQL publication

A security administrator with a current manager session creates a new policy row,
copies/edits its rules, then calls:

```sql
BEGIN;
-- Insert resident_safety_policies and forbidden_patterns for a fresh UUID.
-- Each rule needs category, severity, reason, provenance and positive_witness.
SELECT resident_safety_publish(:candidate_uuid, :manager_uuid, :session_hash);
COMMIT;
```

`resident_safety_publish` requires the existing fresh MFA/session authority and
`security_admin` role. It compiles and validates every candidate rule and witness,
then publishes the singleton atomically. Published policy/rule rows are immutable.
An append-only publication ledger authenticates every activation using that same
fresh session and role. Policy and pointer triggers require the ledger fact from
the current transaction; direct publication, pointer rewriting, and pointer deletion
are refused. Every activation receives a monotonic generation and new UUID.
Rollback uses the same publication function with a previously published policy;
it creates a new activation, so old human acknowledgments never become valid again.
The active-row trigger independently validates the selected version. Invalid or
oversized candidates roll back without changing the prior version. No restart or
application cache is involved: gated transactions hold the singleton `FOR SHARE`.
The next transaction sees the new version. Missing/corrupt policy, unknown engine
or timeout fails closed. This document authorizes no production policy mutation.

Reviews contain a database-produced assessment bound to policy and publication UUIDs, exact effective
field values, selected tag UUIDs/current values and labels, and draft revision.
Approvals with warnings require the displayed assessment digest as the explicit
manager acknowledgment. A changed policy/tag/content invalidates that proof for
new publication or activation; historical reviews receive no invented attestation.
Existing finance, promo-evidence alternatives and main-payment admission remain
required by the original activation gate. Existing published cards are not silently
assigned a new human acknowledgment when a policy changes.

## Recovery, private feedback and erasure

`/card_answers [page]` lists 8 current answers per bounded private reply, with their
IDs and revision. `/card_correct REVISION ENTRY_ID replacement text` appends a
correction without rewriting the original. Corrections remain available at the
100-entry limit; they have a separate 10000-per-draft history bound. Each replacement
must pass the current policy, while submission reassesses all effective fields.
This permits incremental repair of multiple legacy blocked answers. Selected
forbidden tags can likewise be removed incrementally. Changes invalidate existing
review/public projection using the normal draft semantics. Approved cards can be
returned for correction through the actual manager interface.

`/card_document REVISION discard` removes the current extracted proposal from
effective content. `/card_document REVISION replace replacement text` replaces it
with text of at least 50 characters (at most 64000 UTF-8 bytes). Both preserve all
uploaded entries and the previous proposal in a separate append-only history,
bounded to 10000 changes per draft. They remain available at 100 media entries,
check the current owner/revision, and use normal replay and erasure semantics.

The manager detail shows current effective fields, extracted proposal, selected
tag values, warnings and separately labelled original history. An unchecked warning
acknowledgment cannot approve. A rejected extracted proposal retains its uploaded
file and enters manual interview fallback. Forbidden selections are not saved.

`resident_safety_outcomes` commits typed refusal/warning metadata alongside the
existing owner/staff request receipt. `security_logs` stores only subject, draft,
outcome, field, rule, policy, revision, timestamp and action. Neither contains raw
matched fragments. Replays retain refusal and do not multiply incidents. Privacy
erasure deletes outcomes/incidents and correction history under the existing subject
lock; erased request tombstones and current owner checks prevent resurrection.

SQL0061 is hand-authored. Its supported snapshot and exact SQL catalogue are rebuilt
by replaying the complete migration chain on isolated PostgreSQL 17.5, followed by
fresh-directory introspection and catalogue normalization. `drizzle-kit generate`
remains forbidden. No live service, paid action or deployment is enabled here.
