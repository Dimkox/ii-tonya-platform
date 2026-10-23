# Approved residency plan — coordinator record

## Authority and scope

The owner instructed continued execution, then explicitly: implement everything in
the approved plan and fix discovered defects along the way. The approved sequence
is Phase0, Phase1 A/B/C/D, then Phase2. Phase3 stays excluded. Local implementation,
review and commits are authorized; no remote publish, provider request, production
change or release acceptance is implied. Do not ask for per-step approval again.

Worktree: `.worktrees/phase1-owner-plan-20261023`.
Branch: `codex/phase1-owner-plan-20261023`.
Execution contract: `docs/superpowers/implementation-artifacts/spec-phase1-through-phase2-execution.md`.

Phase0 scope/history reconciliation source commit:
`47e6680e9fdadf8416574afa003737691504b16a`.
Execution-contract commit: `8b41802cd0156f8596fbf0e1ba67890f2ed969f2`.
Scope123/123, migration history8/8, new verifier authority10/10 and import boundary
41/41 passed. Exact artifact registrations preserve unknown/mutated-content denial;
worker generic canonical mint was removed rather than allowlisted.

## Delegated economics decision

The owner did not specify the frozen amount and delegated calculation to the agent.
Chosen introductory indication:100 bonus points after2 unique eligible promo
registrations, one time per inviter. Its100RUB-equivalent is a preliminary component
of the existing1000RUB qualified referral reward, not an additional reward.

| Event                                      |             Preliminary indication | Authoritative available credit                                            | Incremental reward above existing policy |
| ------------------------------------------ | ---------------------------------: | ------------------------------------------------------------------------- | ---------------------------------------: |
| Two eligible registrations                 |                  100 frozen points | 0 from registration                                                       |                                        0 |
| Qualifying first paid referral             | Reconcile/supersede preliminary100 | Existing1000RUB reward subject to current eligibility/maturity/debt rules |                                        0 |
| Ineligible/refunded/reversed qualification |   No manufactured available reward | Existing eligibility/reversal/debt rules prevail                          |                                        0 |

The referral reward is never1100RUB as a consequence of this campaign. No cash
withdrawal or client coupon grant follows. This bounds the campaign's additional
reward cost to zero relative to the existing policy; it does not invent an
unverified operating-margin figure. The original price engine and spend limits stay
authoritative. Registration counts or a PDF response never prove paid eligibility.

PDF content remains absent. A waiting-content delivery slot is required; never
create a fake guide, mark `pdf_sent`, or claim delivery from an enqueued job.

## Implementation coordination

`remaining_plan_implement` owns the remaining source work and delegates disjoint
files only within the current block. AGENT-STATUS contains live child owners,
active commands, exact commits and test counters. Do not restart or duplicate
in-progress work after compaction. The coordinator does not edit those owned sources.

BlockA must support first-time applicants directly in the dedicated trusted promo
bot, including explicit approved-document consent presentation and choice. A
pre-existing assistant account or new web cabinet cannot be a hidden prerequisite.
No silent account merge or fabricated consent. Preserve the original deep-link
candidate across consent, prevent candidate replacement and revalidate eligibility
at registration. Use128bit public promo codes in a separate namespace.

Per-block verification/review and local commit precede the next block. No repeated
exhausted PostgreSQL/provider file, full suite or multi-path inner loop is permitted.
External merchant delivery, processor/backup proof and exact-SHA release gates
remain distinct from local fixture verification.

## Local synthetic database credential containment

During BlockB preparation, a child accidentally printed the one-line private
Compose JSON while searching local configuration. It contained only the disposable
password of the task-owned PostgreSQL17.5 environment, not merchant/customer data
or provider credentials. The incident was reported; the value is not repeated here.

Coordinator paused new DB/metadata/test invocations, changed the actual local role
password, and atomically updated the private Compose file with mode0600. A separate
infrastructure-only connection check confirmed the replacement works and the
retired value is rejected (28P01). Log /tmp/phase1-local-credential-rotation.log.
No migration, application test/domain assertion or provider operation ran in that
check, so no functional verification budget was reset or consumed.

Container Config.Env still records the obsolete invalid initial value until a
future recreation. All future task DB connections must read the private current
Compose configuration in memory; never dump/grep/print it, cached URLs, or env.
The old transcript cannot be erased, but its credential no longer authenticates.
No source, real environment, customer/provider credential or other container was
changed. BlockB new focused PG-file count was0 when work resumed.

## Block B local acceptance and Block C financial review

Block B source is committed as dd73dfb30be327d1e3e86458826c956375834ece;
its documentation checkpoint is 656cf89a025d46dfa6bc8e0cf92a3e6eee355c21.
The lead reports the second focused verification invocation passed 23/23 on the
isolated PostgreSQL17.5 environment. Two of three invocations are consumed; the
third remains unused. These results establish local verification only.

The coordinator independently read the new Block C main-payment gate helper,
canonical settlement integration, financial DDL supplement, and original0048
campaign constraint. Three findings were reported to the implementation lead:
explicit verified-event/order binding and scalar snapshots; exact paid-order,
review and activation-gate binding in the publication trigger; and deadline
re-evaluation after newly introduced lock waits, including blocked paths.

Source re-review confirms those findings are addressed: canonical inbox evidence
is bound to the event and order; publication requires the main-order/review/digest
and current card gate; every blocked path checks database time, and settlement
preserves the expired-payment fact while refreshing its clock after main gates.
The original0048 price, quote, tariff, TTL and snapshot checks remain present.
The coordinator performed no edits to those implementation files, test runs,
database probes or provider calls. This narrow source acceptance does not replace
the lead's integration tests, wider independent reviews or release gates.

## Owner-authorized Block C invocation4

The owner explicitly granted one additional focused invocation after checkpoint
921d108d0b947e164a56314e8185d91862fac6e1. The coordinator confirmed that SHA,
clean worktree, canonical remote and isolated branch; RequireDocker preflight
passed with Node24.22.0 and pnpm11.9.0. A separate launcher accepted only invocation4,
read rotated synthetic credentials in memory, and opened a new log exclusively.

The exact focused file ran once (session66416), exited1:12/20 passed,8 failed.
Log: /tmp/phase1-c-card-pg4.log. Duration103.68s, collection4.38s. This permission is
fully consumed; no fifth invocation or equivalent functional probe is authorized.

The two deadline cases reached the canonical committed-expiry path, which throws
EXPERT_RESIDENCY_PAYMENT_EXPIRED after committing financial truth. Their resolved
result expectation contradicts that existing contract and needs a fixture-only fix;
all subsequent stored-state assertions must remain. Three other cases exceeded
the default5000ms body deadline. One exceeded the bounded cleanup drain too, so
the next three cases correctly stopped with async_case_drain_poisoned rather than
resetting a database while the previous body continued. Neither timeout cause is
claimed to be proven solely by host load. No production behavior, runtime timeout,
cleanup bound or financial assertion was weakened by this invocation.

The implementation lead owns the remaining fixture preparation, independent
review, types/lint/format and local WIP checkpoint before any further exact
permission request. Block C remains unaccepted; D and Phase2 have not started.

## Owner-authorized Block C invocation5

The owner answered “Делай” to the request for exactly one fifth focused run.
Coordinator verified clean572c7a5b1335e3e3c8d8524b963ef1502bd2c592 and a passing
RequireDocker preflight, then launched only invocation5 with protected current
synthetic credentials in memory and a new exclusive log.

Session69562 exited1:19/20 passed; the canonical1000 reward scenario alone exceeded
its default5000ms body timeout. No SQL or assertion failure was reported. All
deadline, legacy-source, main checkout, publication and erasure scenarios passed.
Log /tmp/phase1-c-card-pg5.log; duration126.03s, collection10.21s. All five focused
invocations are consumed; no sixth or equivalent functional probe is authorized.

The lead owns a full20-case setup/body audit and fixture-only repair with independent
review and static verification before a revised local WIP checkpoint. Runtime
limits, financial assertions, production code and the drain helper remain unchanged.
The owner's subsequent question about the limit is not an override: coordinator
explained the three-run rule comes from AGENTS.md:105 and the default5000ms body
timeout comes from the test runner. No further functional command followed.

## Explicit task-wide run-count override

After the coordinator asked whether to override the invocation-count restriction
for this current task and continue without repeated requests, the owner answered:
“разрешаю, что за бесконечный цикл”. This explicitly supersedes the three-focused-
invocation limit for the current approved implementation task. Further necessary
focused verification does not require another count approval. Preserve actual run
counts, failed logs and reasons for each rerun; no blind unchanged repetition,
weakened assertions or runtime limits follows from this override. The separate
repeat-tool count guard remains unchanged. External release authority is unchanged.

Coordinator acknowledged its piecemeal fixture preparation and repeated permission
requests prolonged the work. The complete20-case fixture audit is reviewed at
82b72348349fd9f8ba66b7082c991130a45b6b0c. RequireDocker preflight passed before
invocation6 (session89705, exclusive /tmp/phase1-c-card-pg6.log), launched only once
using current synthetic credentials in memory. No success is claimed before its
actual terminal result. The implementation lead was instructed not to duplicate it
and to continue C closure, D and Phase2 after passing the critical local gate.
