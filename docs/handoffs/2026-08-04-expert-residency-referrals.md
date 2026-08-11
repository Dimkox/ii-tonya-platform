# Expert residency referrals handoff

Date: 2026-08-04
Status: implementation in progress; not released

## Repository checkpoint

- Canonical repository: `https://github.com/Dimkox/ii-tonya-platform.git`
- Canonical local worktree:
  `C:\Users\Dmitry\Documents\Codex\2026-07-28\new-chat\work\ii-tonya-platform\.worktrees\expert-residency-referrals`
- Branch: `codex/task25-expert-referral-implementation`
- Draft pull request: <https://github.com/Dimkox/ii-tonya-platform/pull/4>
- Last functional Task 9 commit: `a121e21da8634eea1f247b2a85452a42684c42fb`
- Recorded progress checkpoint: `1331e4be8abc214fdd266c3175ea77b4b9cc5042`
- Superseded design PR #3 is closed. Its three commits remain in PR #4 history.

Always resolve and record the current branch HEAD before continuing:

```powershell
git status --short
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
gh pr view 4 --repo Dimkox/ii-tonya-platform
```

Do not use the Obsidian mirror, another checkout, or `openclaw-airgap-farm` as the
source repository for this work.

The receiving machine must not be assumed to match the source workstation. Run
`pwsh -File scripts/check-development-environment.ps1` before installing dependencies
and use `-RequireDocker` before PostgreSQL/container verification. The committed
environment manifest records required versions, the observed source-machine drift,
clean bootstrap steps, workspace modules, container topology, CI tools, and Serena
scope. The repository-contained `AGENTS.md` and `docs/agents` roles replace any missing
global Codex profiles, skills, agents, or memory.

## Product contract

Expert referral codes are strictly separate from client coupons. A referred expert's
first eligible settled residency payment grants the inviter exactly 1,000 RUB of
internal residency credit. Each grant expires after exactly 365 days. Credit may pay
at most 50% of a residency tariff; the remainder is paid in money. Credit is allocated
FIFO by expiry.

Prompts, Telegram, Make, and Google Sheets have no financial authority. PostgreSQL
transactions own referral binding, balances, reservations, settlement, refund,
reversal, debt, expiry, idempotency, and abuse holds. Plaintext expert codes are
returned once after approved batch creation; persistent inventory is masked and codes
are stored as non-reversible digests.

Authoritative documents:

- `AGENTS.md`
- `docs/agents/expert-residency-team.md`
- `docs/handoffs/environment-manifest.md`
- `docs/superpowers/specs/2026-08-02-expert-residency-referrals-design.md`
- `docs/superpowers/plans/2026-08-03-expert-residency-referrals.md`
- `.superpowers/sdd/progress.md`

## Completed scope

Tasks 1–9 are complete:

1. Scope and repository boundaries.
2. Domain rules and contracts.
3. PostgreSQL schema, migrations, and invariants.
4. Expert referral code lifecycle.
5. Residency quote and checkout accounting.
6. Provider-neutral settlement.
7. Refund, reversal, holds, and debt behavior.
8. Disabled-by-default services, feature controls, keyring, and environment policy.
9. Approved admin workflows, two-person overrides, masked inventory, and immutable
   replay results.

Task 9 passed independent adversarial review with no remaining findings. Stable exact-SHA
evidence:

- CI: <https://github.com/Dimkox/ii-tonya-platform/actions/runs/30865251809> — PASS
- Database Gate: <https://github.com/Dimkox/ii-tonya-platform/actions/runs/30865251814> — PASS

Runs `30867002520` and `30867002478` were still executing when this handoff was written;
they validate the later documentation-only checkpoint and must be checked before relying
on them as evidence.

## Remaining work

Continue from Task 10 in the implementation plan:

- **Task 10:** expert API, Telegram views/callback binding, prompt-safe typed proposals,
  and malicious fixtures `llm-05` through `llm-09`.
- **Task 11:** bounded worker jobs, reconciliation, expiry processing, and telemetry.
- **Task 12:** traceability, CI coverage, runbooks, release evidence, and final human
  checkpoints.

Task 10 had only been inspected when work stopped. No Task 10 source or test changes were
left in the worktree. Start with RED tests, then implement the smallest compatible change.

Required Task 10 boundaries:

- authenticate and reauthorize the expert for every command;
- accept only a referral code, idempotency key, or server-issued tariff/order ID;
- never accept client-supplied balance, price, credit, inviter, settlement, payment ID,
  provider payload, or cross-expert authority;
- bind Telegram callbacks to expert ID, operation, object ID, nonce, and expiry;
- render server-derived masked summary and quote values;
- reject all five malicious prompt fixtures as unsupported intents.

## Resume and verification sequence

1. Confirm the worktree is clean and PR #4 is still Draft.
2. Read the Task 10 section and the existing referral/residency services, intent proposal,
   Telegram callback, adapter, and webhook contracts.
3. Add failing Task 10 tests and record the expected RED failures.
4. Implement Task 10 without moving financial authority into adapters or prompts.
5. Run focused Vitest, package typechecks, ESLint, Prettier, and `git diff --check`.
6. Obtain an independent adversarial review and remediate findings.
7. Push the exact reviewed SHA and require both repository CI and Database Gate to finish
   successfully before recording the task complete.
8. Repeat the same evidence chain for Tasks 11 and 12. Mark PR #4 ready only after all
   remaining tasks and final checks pass.

## Deployment boundary

- No staging or production deployment occurred from this branch.
- Earlier staging approval does not waive unfinished Tasks 10–12, mandatory CI, release
  evidence, target validation, or human checkpoints.
- Production requires a separate explicit deployment command after all release gates.
- The attempted Task 9 modification of the separate `openclaw-airgap-farm` test harness
  was cancelled and reverted; its temporary release asset and branches were removed.
- Do not modify another repository merely to obtain test evidence. If Claw cannot run the
  ii-tonya checkout without changing its repository, record that limitation and use the
  ii-tonya CI/Database Gate instead.

## Recovery

There is no deployed state to roll back. Git history and PR #4 are the recovery source.
Do not rewrite history or delete the implementation branch. If a later change fails,
revert only its exact commit and preserve failed CI evidence for diagnosis.
