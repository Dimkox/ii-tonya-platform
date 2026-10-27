# Private verification final-gate registration correction

The full canonical gate at8760c2b3 failed six repository assertions (588passed,
6failed of594), while shell syntax, formatting, whitespace, evidence integrity,
changed-file lint and tests typecheck passed. The failures were missing exact
registrations for the newly reviewed parser runtime/witnesses, stale hashes for
its changed helper/test/export/journal files, and an empty PRIVATE_VK_TOKEN example
where the standing environment policy requires explicit placeholder markers.
No actual credential was committed or printed, and all live flags stayed false.

The correction updates only exact accepted file hashes/paths and three example
credential markers. It does not exempt a directory, change classification rules,
disable a test, loosen a ceiling, or change runtime behavior. The journal's two
existing map entries are both updated. Automation paths use the classifier's
existing lowercase normalization, including the nested Dockerfile.

A new negative guard first failed8 legitimate new artifacts while3 adjacent-file
rejections passed. The first affected-file check passed150 of152: the only remaining
failure was the case-normalized Dockerfile map key, observed twice. After correcting
that exact key, the two affected files pass141/141; the previous run separately
passed the existing core9 and environment2 checks. New mutation tests reject changed
bytes for all8 entries and reject3 adjacent unreviewed executable paths. Scoped lint
and git diff --check pass. A fresh full gate follows because this correction changed
source registrations; no unchanged broad retry or hook bypass was used.

[Manifest](verification-private-jobs-gate-correction-2026-10-26/manifest.json) preserves
all six raw/compressed log hashes and exit statuses, including both failed correction
runs. Runtime b360ac46 remains independently acceptedR1–R8; this small guard/example
correction gets a separate read-only review before final delivery.
