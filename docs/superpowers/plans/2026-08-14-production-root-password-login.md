# Production Root Password Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve interactive SSH password login for the production `root` account while keeping the password out of project files and running ii-Тоня as `ii_tonya`.

**Architecture:** The ignored operator `.env` records the approved access policy, not the credential. A repository guard binds versioned deployment assets and the runbook to that decision and rejects future automation that disables root/password SSH.

**Tech Stack:** Bash deployment scripts, TypeScript/Vitest repository guards, Markdown runbooks, ignored dotenv operator configuration.

## Global Constraints

- `PROD_ROOT_PASSWORD_LOGIN_ENABLED=true` must be explicit in the ignored local `.env`.
- `PROD_ROOT_PASSWORD_SOURCE=interactive` must be explicit in the ignored local `.env`.
- The root password must not be stored in Git, `.env`, logs, release artifacts, handoffs, or memory.
- The application API and worker continue to run as `ii_tonya`.
- Production deployment remains native systemd/nginx/PostgreSQL without application containers or GitHub Actions.

---

### Task 1: Version and enforce the SSH access policy

**Files:**
- Modify: `tests/repo/native-production-release.test.ts`
- Modify: `docs/runbooks/native-production-deployment.md`
- Modify locally, ignored: `.env`

**Interfaces:**
- Consumes: `scripts/deploy-native-remote.sh` and the existing `ii_tonya` systemd units.
- Produces: repository assertions for the SSH policy plus explicit operator configuration.

- [ ] **Step 1: Add the failing repository guard**

Add an assertion that the runbook contains `PROD_ROOT_PASSWORD_LOGIN_ENABLED=true`, `PROD_ROOT_PASSWORD_SOURCE=interactive`, and the statement that the password is entered only at the SSH prompt. Assert that deployment assets contain none of `PermitRootLogin no`, `PermitRootLogin prohibit-password`, or `PasswordAuthentication no`, and that systemd continues to contain `User=ii_tonya`.

- [ ] **Step 2: Run the focused test to verify RED**

Run on Claw or the repository's prepared test runtime:

```bash
pnpm exec vitest run tests/repo/native-production-release.test.ts --maxWorkers=1
```

Expected: the new runbook assertions fail because the policy is not documented yet.

- [ ] **Step 3: Document the approved policy**

Add a production SSH access section to `docs/runbooks/native-production-deployment.md` stating the two exact non-secret variables, interactive-only password handling, preserved root/password login, and unprivileged application runtime.

- [ ] **Step 4: Record the local operator policy**

Add exactly these lines to the ignored local `.env` without adding a password variable:

```dotenv
PROD_ROOT_PASSWORD_LOGIN_ENABLED=true
PROD_ROOT_PASSWORD_SOURCE=interactive
```

- [ ] **Step 5: Run focused verification**

Run the focused Vitest file and `git diff --check`. Expected: all tests pass, `.env` remains ignored, and a credential-pattern scan finds no newly persisted password.

- [ ] **Step 6: Commit the versioned changes**

```bash
git add tests/repo/native-production-release.test.ts docs/runbooks/native-production-deployment.md
git commit -m "docs: preserve production root password login"
```
