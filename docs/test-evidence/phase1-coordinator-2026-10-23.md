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
