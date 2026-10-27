# Customer demo review triage

Three independent read-only BMad review layers inspected the uncommitted web
patch against baseline29a01ce7bc386c5d0c052f0ac1a4f24cf0950023. Hilbert covered
blind findings, Epicurus edges, Bohr verification gaps. No reviewer ran tests,
changed files or called production. Coordinator owns classifications below.

## Accepted patches

- Offscreen focus after reserve/payment/cancel/clear: medium user-facing defect.
  Bring the focused status into view. Add a focused new regression for this
  newly discovered behavior, not a replay of the exhausted walkthrough test.
- Export explanation: low copy ambiguity. Explicitly state that downloaded files
  survive reset/clear/reload. Clarify full reset also clears illustrative consent
  and the single checkbox is a simplified demo, not all real consent purposes.
- New Chrome harness cleanup: medium reliability defect. Protect resource
  acquisition, handle already-exited/failed children, bound termination and use
  UTF-8 streaming decoding. Existing walkthrough3/3 remains exhausted; static
  checks only for this harness correction, with that limit recorded.
- Verification gaps: add distinct focused coverage for existing-document reset
  handlers and download failure cleanup. Synthetic lifecycle dispatch is not proof
  of actual browser BFCache eligibility. Keep the old browser run budget intact.

Assigned as one fix round to the same implementer Godel. Do not create another
implementer or replay the full browser journey to reset its exhausted budget.

## Scope/evidence qualifications

- Native select/pointer interaction was not established by assigning DOM values
  and calling click. Keyboard Enter/Tab/Space was exercised; real production smoke
  remains coordinator-owned. No claim of exhaustive touch-device testing.
- Mock-server route fallback is not deployment evidence. Check `/demo`, `/demo/`
  and served source on the real host after publication.
- Existing browser harness built an isolated Vite bundle with envDir/configFile
  disabled. The separately executed standard web build passed; signed release
  must use the normal exact-commit web build and live browser smoke.
- Cookie/local/session storage and network attempts were instrumented. IndexedDB
  and CacheStorage were not instrumented. Source has no persistence calls; this
  is not a runtime audit of every possible browser storage API.
- Browser executable is the provisioned google-chrome command in this environment.
  Portable browser provisioning is not required for the released website.
- DOM-context destruction during test polling can produce a failed test; it
  cannot turn a bad app into a pass. Do not claim the harness handles every
  navigation failure. The first successful focused browser result is preserved.
- Spec intentionally permits only one demo booking until reset and one illustrative
  consent. A multi-booking account or real purpose-specific consent is out of scope.
- Local report identifies its uncommitted patch and logs honestly. Coordinator
  will record reviewed commit, signed artifact and deployed SHA separately.

This review does not approve real payments, booking authority, erasure execution,
hosting backup facts or customer identity. Email is not authentication evidence.

## Fix closure

Godel implemented the accepted patches. Coordinator read actual unit15/15 and
narrow review-regression Chrome1/1 logs under /tmp/ii-tonya-demo-review.dcU7gy/.
The new focused regression failed then passed (2/3 used); original walkthrough
remains3/3 exhausted and was not rerun. Standard build, relevant types, lint,
format and diff checks passed. Epicurus independently inspected the fix scope
and reported no remaining concrete blocking defect. The harness cleanup changes
are statically reviewed only; no actual BFCache eligibility claim is made.
