# S3b fourth independent-review correction: R7 within-scope repair

Local synthetic correction against control
`4d2bb601c91f8d399b888e07b334f46141c69d9f` (accepted SQL/source `7b4f79f5`).
All six prior manifests and their 286 artifacts remain unchanged. No live calls,
model rebuild, broad suite rerun, deployment or publication occurred.

## Bounded application correction

Tag confirmation now uses the established `richServiceSchema.shape.tags` shape:
strings up to 80 characters, no disallowed control characters, at most 20 entries,
and no duplicate labels. It preserves the exact selected text, including unchanged
historical punctuation/emoji, without the newer parser's trim transformation.

The accepted SQL remains the authority: historical invalid syntax may survive only
an actual strict per-scope subset with no addition, move or unrelated-content edit,
and with the existing unrelated-content safety gate satisfied. New invalid labels,
unchanged-invalid confirmation and final owner/manager approval remain denied.
Custom-label entry still uses the strict current `tagLabelSchema`. No SQL, migration
journal, snapshot or state supplement changed; reconstruction was unnecessary.

## Authentic owner callback proof

The retained pre-0069 repository runs on the actual migration chain through 0068.
It creates a complete service tagged `[Стресс, тревога; Спокойствие 🙂; #КПТ]`,
including the existing private-photo, owner-confirmation and manager-approval flow.
Only then is current 0069 applied. No guards are disabled to manufacture history.

On the control implementation, an authenticated private Telegram callback removing
only `Стресс, тревога` returns the owner failure reply because the retained emoji
label fails the application precheck. The same callback journey passes on the final
implementation: first removal retains `Спокойствие 🙂` exactly, then a second
recommendation/confirmation removes it, retaining `#КПТ`.

The witness checks original-update replay after both removals; exact non-tag answers;
unchanged immutable versions/reviews and financial facts; invalid unchanged
confirmation before and after the first removal; refusal of a newly introduced
invalid label through both SQL and custom-entry application validation; and rejection
of owner finalization and approved status while the emoji remains. This passes
**1/1** on the final source. The preliminary fallback-parser GREEN is retained
separately; the final parser uses the old bounded shape directly to avoid rewriting
other retained labels through trim normalization.

The populated harness is archived as `fourth-r7-upgrade.test.ts.gz`. Restore it to
`tests/integration/resident-semantic-same-scope-upgrade.test.ts`, and restore the
preserved baseline repository to its original ignored path, to reproduce. Adapt
baseline worktree-root imports for another checkout. The baseline bytes match the
initial archive. The temporary historical harness is removed after execution, so
normal tests do not depend on an untracked evidence directory.

## Verification and evidence

Focused existing owner/SQL guard regressions pass **10/10** on the final precheck:
new syntax denial, obsolete/active subset removal, mixed stores, retained aliases,
no-add/move/unrelated-edit denials and unsafe unrelated-field protection.
Database build and typecheck, complete tests typecheck, changed-source lint,
formatting and whitespace checks pass. Accepted 0069 SQL/state bytes are verified
unchanged. Existing R4/model/ordinary-input proofs were not rerun because their
source contracts did not change.

The [manifest](residency-semantic-tags-fourth-review-2026-10-27/manifest.json) records
commands, exits, raw/compressed hashes, final source pins, unchanged state hashes and
all six preserved manifest hashes. Drivers read protected local database configuration
only in memory and sanitize output. This is local synthetic review evidence;
independent review and the coordinator's final gate remain separate.
