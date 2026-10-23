# P0.1 service geography audit

Date: 2026-10-23. Base: 031ae46065b58223a2b6cd47e002b388a41ec89c.
Owner plan: `docs/superpowers/plans/2026-10-23-phase-1-owner-plan.md`.

## Changes

- `apps/web/index.html`: search keywords describe nationwide service.
- `apps/web/src/landing-view.ts`: the portrait caption refers to the reader's region
  and online access, without limiting the service to the operator's city.
- `docs/spec/normalized-requirements.md`: remove the city-limited pilot assumption;
  timezone must be explicitly supplied rather than inferred from the operator's city.

The replacement script executed against these exact reviewed phrases, requiring one
match per replacement and aborting on unexpected counts. No indiscriminate rewrite of
source archives, legal addresses, migrations or local environment files occurred.

## Audit boundary and retained occurrences

A case-insensitive scan for the Cyrillic city root and Latin spelling covered tracked
application/package/prompt sources, README, environment examples, SQL files, and
Selarti-named JSON configuration. The only remaining runtime occurrences identify the
operator's address or the place of execution/publication of legal documents:

| File                            | Occurrences | Meaning                        |
| ------------------------------- | ----------: | ------------------------------ |
| `apps/web/src/content.ts`       |           1 | Operator postal address        |
| `apps/web/src/legal/oferta.txt` |           3 | Legal document/address context |
| `apps/web/src/legal/policy.txt` |           7 | Legal document/address context |

These do not restrict client/expert service geography. Replacing an operator's actual
postal address with “your region” would make the contact information inaccurate.

The primary checkout's local `.env` was inspected only for occurrence counts: zero
location matches. No environment values were printed, copied or changed. The isolated
worktree has no `.env`. README, tracked SQL and Selarti JSON had no matching city
restriction. No authenticated Selarti panel configuration was inspected or changed.

Original owner/source archives under `docs/source/` remain historical evidence; this
cleanup changes the working specification, not the original source testimony. The
new owner plan itself mentions the city as a search term. Those occurrences are not
service configuration and must not be erased to fabricate a zero-match audit.

## Verification and recovery

Prettier and web typecheck/build results are recorded in the Phase 0 evidence report.
Inspect the three-file diff to reproduce the content review. Recovery is a targeted
Git revert of this cleanup; no database, provider or deployment rollback is needed.
