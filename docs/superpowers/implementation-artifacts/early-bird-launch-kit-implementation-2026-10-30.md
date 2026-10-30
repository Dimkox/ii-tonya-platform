# Launch-kit delivery — 2026-10-30

The owner requested automatic delivery of launch materials after the client
opening. The committed version `early-bird-launch.v1` contains two neutral Russian
post drafts and an original text-only SVG banner. It contains no medical,
superiority, outcome, audience or private-profile claims. No invented logo,
remote image, tracking or customer data is included. The SVG is embedded in the
worker bundle and byte-matches `assets/early-bird/launch-kit-v1/banner.svg`; native
deployment therefore needs no additional file-copy path.

A dedicated minimal ledger was necessary: existing material jobs require a legacy
review identity and Telegram file references; adding a template there would also
make it eligible for unrelated prelaunch jobs. The generic outbox's legacy scanner
claims arbitrary topics and its narrow supported-topic registry does not support
this package. The new `early_bird_launch_kit_jobs` ledger is unique by user and
content version; it preserves delivered/unknown history across replacement of an
expert/profile row. User deletion or the existing erasure cohort deletes it.

One least-privileged capability,
`public.early_bird_launch_kit_worker(text,jsonb)`, is granted only to
`ii_tonya_wave_launch_kit_worker`. The runtime login has no direct table grants and
is audited with the existing strict principal checks. Helper/erasure functions
revoke PUBLIC execution and explicitly place pg_temp last in search_path.

Eligibility requires the physical database clock at/after the active configured
client start, active user and expert, verified expert, active published wave
profile, the reviewed current-publication proof (including financial coverage,
qualification, refund/exclusion and safety rules), current messaging consent and
exact private Telegram identity. Date alone never authorizes a kit. Admission
commits dispatched uncertainty before network I/O, then eligibility/identity are
rechecked under source/config/subject locks through the bounded send. Unknown or
partially delivered packages are never automatically resent.

The fixed-origin Telegram adapter sends one text message and one SVG document.
Both use `protect_content=false` for forwarding after launch. It rejects redirects,
binds the response to the configured bot and private recipient, bounds responses
and total time, and does not log token/URL/body or retry either POST. No external
messages were sent during verification.

Verification:

- Content unit: initial red exposed an overbroad SVG guard matching the word
  `description`; corrected to actual active-element/attribute patterns, 1/1 green.
- Telegram transport: initial content-guard red, then 3/3 green; fresh 3/3 green
  after conditional optional-header typing correction. Tests cover fixed endpoints,
  forwarding, exact SVG, partial delivery, wrong recipient and pre-aborted job.
- New isolated-role PostgreSQL file: invocation 1, 2/2 green; invocation 2, 2/2
  green after preserving the ledger across expert replacement. Invocation 3:
  3/3 green after the reviewed enqueue/erasure race correction. Tests cover before
  launch, insufficient date-only authority, verification, durable once-only
  dispatch, fresh publication recheck, unknown/no retry, erasure, denied direct
  SELECT and rejection after unsafe privilege grant. The three-run allowance is exhausted; do not rerun this focused file.
- The fixture uses synthetic publication/consent helpers with actual capability
  SQL. Actual publication proofs are covered by the separate publication witness;
  the aggregate migration/role and exact-SHA release gates remain separate.
- Focused ESLint and whitespace passed. Root workspace build/lint passed; after
  fixing optional RequestInit headers, actual worker typecheck passed.

Final draft SQL SHA256:
`5656d4bd00c54e59e7ed21d9f5fa848461e46feb7a659c3228af66640d942d8d`.
The root coordinator promotes it with publication additions as migration 0083.
No production change or provider message was made by this implementation task.

Independent review found a P1 erasure race in the original bulk enqueue: the
privacy trigger could see no uncommitted job, then enqueue could commit identity
after erasure. The corrected function obtains the consent-document barrier,
iterates user IDs in sorted order, takes the exact subject advisory lock and
rechecks eligibility with a fresh volatile query after waiting before INSERT.
The deterministic PostgreSQL regression holds the privacy lock, inserts an
uncommitted erased cohort, observes the worker backend actually waiting on the
advisory lock, commits privacy, and asserts zero enqueued/residual jobs. It passed
on the third and final focused invocation.
