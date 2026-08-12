# Expert Bearer Principal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral, fail-closed Bearer-token resolver for expert HTTP routes
without composing a live session store or enabling expert features.

**Architecture:** The API hashes a strictly parsed opaque bearer token and asks an
injected `ExpertSessionLookup` for a fresh session on every request. The resolver emits
only a minimal `ExpertPrincipal`; the existing route and application services retain
response handling and ownership reauthorization.

**Tech Stack:** Node.js 24, TypeScript 5, Fastify 5, Vitest 3, pnpm 11.9.0, Docker Compose
Claw test profile.

## Global Constraints

- Requirements are defined in
  `docs/superpowers/specs/2026-08-12-expert-bearer-principal-design.md`.
- `EXPERT_REFERRAL_ENABLED=false`, `EXPERT_RESIDENCY_BILLING_ENABLED=false`,
  `PAYMENTS_ENABLED=false`, and `PAYMENT_PROVIDER=disabled` remain the runtime defaults.
- Do not add a database session table, identity-provider adapter, token secret, cookie,
  Telegram-to-HTTP mapping, or live server composition.
- Never log or persist the bearer token or its SHA-256 lookup hash.
- Run tests only in `/home/pall/app-stack` through the existing `ii-tonya-test` profile.
- Use `--entrypoint sh` for focused tests; do not invoke the profile's broad default
  wrapper.
- Do not run `test:repeat`; CI-only 20x gates remain in CI.
- Do not change production services, `/home/pall/app-stack/docker-compose.yml`, Billing,
  or GitHub Actions spending controls.

---

### Task 1: Expert Bearer resolver contract and implementation

**Files:**

- Create: `apps/api/src/expert-principal-resolver.test.ts`
- Create: `apps/api/src/expert-principal-resolver.ts`
- Modify: `apps/api/src/routes/expert-referral.ts:1-55`
- Modify: `apps/api/src/index.ts:1-5`

**Interfaces:**

- Consumes: `ExpertPrincipal` from `@ii-tonya/application`.
- Produces: `ExpertSessionRecord`, `ExpertSessionLookup`, `ExpertPrincipalResolver`, and
  `createExpertBearerPrincipalResolver` exactly as declared in the approved design.
- Preserves: `ExpertPrincipalResolver` remains importable from
  `apps/api/src/routes/expert-referral.ts` through a type re-export.

- [ ] **Step 1: Write the failing resolver tests**

Create `apps/api/src/expert-principal-resolver.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createExpertBearerPrincipalResolver,
  type ExpertSessionRecord,
} from "./expert-principal-resolver.js";

const token = "A".repeat(32);
const authorization = `Bearer ${token}`;
const now = new Date("2026-08-12T09:00:00.000Z");
const validSession = (): ExpertSessionRecord => ({
  userId: "00000000-0000-4000-8000-0000000000AA",
  expertId: "00000000-0000-4000-8000-0000000000BB",
  expiresAt: new Date("2026-08-12T10:00:00.000Z"),
});

describe("expert bearer principal resolver", () => {
  it("hashes a valid token and emits only a normalized principal", async () => {
    const findByTokenHash = vi.fn(async () => validSession());
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.toEqual({
      authenticated: true,
      userId: "00000000-0000-4000-8000-0000000000aa",
      expertId: "00000000-0000-4000-8000-0000000000bb",
    });
    expect(findByTokenHash).toHaveBeenCalledWith(
      `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`,
    );
  });

  it.each([
    undefined,
    "",
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Bearer ${"A".repeat(31)}`,
    `Bearer ${"A".repeat(513)}`,
    `Bearer ${"A".repeat(31)}!`,
  ])("rejects malformed authorization without lookup: %s", async (header) => {
    const findByTokenHash = vi.fn(async () => validSession());
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(header)).resolves.toBeNull();
    expect(findByTokenHash).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "expired at equality",
      session: { ...validSession(), expiresAt: now },
    },
    {
      name: "expired before now",
      session: {
        ...validSession(),
        expiresAt: new Date("2026-08-12T08:59:59.999Z"),
      },
    },
    {
      name: "revoked",
      session: {
        ...validSession(),
        revokedAt: new Date("2026-08-12T08:00:00Z"),
      },
    },
    {
      name: "invalid expiry",
      session: { ...validSession(), expiresAt: new Date(Number.NaN) },
    },
    {
      name: "invalid user id",
      session: { ...validSession(), userId: "not-a-uuid" },
    },
    {
      name: "invalid expert id",
      session: { ...validSession(), expertId: "not-a-uuid" },
    },
  ])("fails closed for $name", async ({ session }) => {
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash: async () => session },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.toBeNull();
  });

  it("performs a fresh session lookup for every request", async () => {
    const findByTokenHash = vi
      .fn<() => Promise<ExpertSessionRecord | null>>()
      .mockResolvedValueOnce(validSession())
      .mockResolvedValueOnce(null);
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.not.toBeNull();
    await expect(resolver.resolve(authorization)).resolves.toBeNull();
    expect(findByTokenHash).toHaveBeenCalledTimes(2);
  });

  it("replaces lookup failures with a fixed error", async () => {
    const resolver = createExpertBearerPrincipalResolver({
      sessions: {
        findByTokenHash: async () => {
          throw new Error(`provider leaked ${token}`);
        },
      },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).rejects.toThrow(
      "expert_session_lookup_failed",
    );
    await expect(resolver.resolve(authorization)).rejects.not.toThrow(token);
  });
});
```

- [ ] **Step 2: Synchronize the RED test to Claw and prove the expected failure**

From the Windows worktree, copy only the new test into the concrete test workspace:

```powershell
$key = 'C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519'
$target = 'pall@192.168.0.229:/home/pall/app-stack/ii-tonya-test-workspace/source/apps/api/src/expert-principal-resolver.test.ts'
scp -i $key -o BatchMode=yes apps/api/src/expert-principal-resolver.test.ts $target
$remote = @'
cd /home/pall/app-stack &&
tag="$(docker images ii-tonya-test --format '{{.Tag}}' | head -1)" &&
test -n "$tag" &&
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run apps/api/src/expert-principal-resolver.test.ts --maxWorkers=1'
'@
ssh -i $key -o BatchMode=yes pall@192.168.0.229 $remote
```

Expected: FAIL because `./expert-principal-resolver.js` does not exist. No other test file
is selected.

- [ ] **Step 3: Implement the minimal resolver**

Create `apps/api/src/expert-principal-resolver.ts`:

```ts
import { createHash } from "node:crypto";
import type { ExpertPrincipal } from "@ii-tonya/application";

const bearerPattern = /^Bearer ([A-Za-z0-9._~-]{32,512})$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ExpertSessionRecord {
  readonly userId: string;
  readonly expertId: string;
  readonly expiresAt: Date;
  readonly revokedAt?: Date;
}

export interface ExpertSessionLookup {
  findByTokenHash(tokenHash: string): Promise<ExpertSessionRecord | null>;
}

export interface ExpertPrincipalResolver {
  resolve(authorization: string | undefined): Promise<ExpertPrincipal | null>;
}

const tokenHash = (token: string): string =>
  `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

export function createExpertBearerPrincipalResolver(deps: {
  readonly sessions: ExpertSessionLookup;
  readonly now?: () => Date;
}): ExpertPrincipalResolver {
  return {
    async resolve(authorization) {
      const token = bearerPattern.exec(authorization ?? "")?.[1];
      if (token === undefined) return null;

      let session: ExpertSessionRecord | null;
      try {
        session = await deps.sessions.findByTokenHash(tokenHash(token));
      } catch {
        throw new Error("expert_session_lookup_failed");
      }

      if (session === null) return null;
      const now = deps.now?.() ?? new Date();
      if (
        !validDate(now) ||
        !validDate(session.expiresAt) ||
        session.expiresAt.getTime() <= now.getTime() ||
        session.revokedAt !== undefined ||
        !uuidPattern.test(session.userId) ||
        !uuidPattern.test(session.expertId)
      ) {
        return null;
      }

      return {
        authenticated: true,
        userId: session.userId.toLowerCase(),
        expertId: session.expertId.toLowerCase(),
      };
    },
  };
}
```

Modify `apps/api/src/routes/expert-referral.ts` by removing the local
`ExpertPrincipalResolver` declaration and adding:

```ts
import type { ExpertPrincipalResolver } from "../expert-principal-resolver.js";
export type { ExpertPrincipalResolver } from "../expert-principal-resolver.js";
```

Append to `apps/api/src/index.ts`:

```ts
export * from "./expert-principal-resolver.js";
```

- [ ] **Step 4: Synchronize the implementation and prove GREEN on Claw**

```powershell
$key = 'C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519'
$root = 'pall@192.168.0.229:/home/pall/app-stack/ii-tonya-test-workspace/source'
scp -i $key -o BatchMode=yes apps/api/src/expert-principal-resolver.ts "$root/apps/api/src/expert-principal-resolver.ts"
scp -i $key -o BatchMode=yes apps/api/src/expert-principal-resolver.test.ts "$root/apps/api/src/expert-principal-resolver.test.ts"
scp -i $key -o BatchMode=yes apps/api/src/routes/expert-referral.ts "$root/apps/api/src/routes/expert-referral.ts"
scp -i $key -o BatchMode=yes apps/api/src/index.ts "$root/apps/api/src/index.ts"
$remote = @'
cd /home/pall/app-stack &&
tag="$(docker images ii-tonya-test --format '{{.Tag}}' | head -1)" &&
test -n "$tag" &&
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run apps/api/src/expert-principal-resolver.test.ts --maxWorkers=1'
'@
ssh -i $key -o BatchMode=yes pall@192.168.0.229 $remote
```

Expected: the resolver test file passes with no warnings.

- [ ] **Step 5: Run static checks and commit Task 1**

```powershell
pnpm exec eslint apps/api/src/expert-principal-resolver.ts apps/api/src/expert-principal-resolver.test.ts apps/api/src/routes/expert-referral.ts apps/api/src/index.ts
pnpm exec tsc --noEmit -p apps/api/tsconfig.json
pnpm exec prettier --check apps/api/src/expert-principal-resolver.ts apps/api/src/expert-principal-resolver.test.ts apps/api/src/routes/expert-referral.ts apps/api/src/index.ts
git diff --check
git add apps/api/src/expert-principal-resolver.ts apps/api/src/expert-principal-resolver.test.ts apps/api/src/routes/expert-referral.ts apps/api/src/index.ts
git commit -m "feat: add expert bearer principal resolver"
```

Expected: all checks exit `0`; the commit contains no configuration, database, or live
composition change.

---

### Task 2: Composed API failure semantics

**Files:**

- Modify: `apps/api/src/app.test.ts:1-43,225-240`

**Interfaces:**

- Consumes: `createExpertBearerPrincipalResolver` from Task 1.
- Produces: composed Fastify evidence that a session lookup outage returns only
  `{ error: "internal_error" }` with HTTP 500.
- Preserves: existing four-route feature isolation and disabled-capability startup tests.

- [ ] **Step 1: Write the failing composed API test**

Add this import to `apps/api/src/app.test.ts`:

```ts
import { createExpertBearerPrincipalResolver } from "./expert-principal-resolver.js";
```

Add this test after the existing unexpected-service-fault test:

```ts
it("sanitizes expert session lookup failures in the composed path", async () => {
  const token = "A".repeat(32);
  const app = await buildTestApp({
    expertApi: testExpertApi({
      principals: createExpertBearerPrincipalResolver({
        sessions: {
          findByTokenHash: async () => {
            throw new Error(`identity backend leaked ${token}`);
          },
        },
      }),
    }),
    features: { expertReferral: true, expertResidencyBilling: false },
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/expert/referrals/summary",
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: "internal_error" });
  expect(response.body).not.toContain(token);
  await app.close();
});
```

Do not change `testExpertApi` yet. Vitest transpiles this file without TypeScript semantic
checking, so the unchanged helper ignores the new `principals` property and the request
incorrectly succeeds with its default principal.

- [ ] **Step 2: Prove RED on Claw before changing the helper**

Copy the test with the new case but before adding `principals` to the helper type/body:

```powershell
$key = 'C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519'
scp -i $key -o BatchMode=yes apps/api/src/app.test.ts 'pall@192.168.0.229:/home/pall/app-stack/ii-tonya-test-workspace/source/apps/api/src/app.test.ts'
$remote = @'
cd /home/pall/app-stack &&
tag="$(docker images ii-tonya-test --format '{{.Tag}}' | head -1)" &&
test -n "$tag" &&
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run apps/api/src/app.test.ts --maxWorkers=1'
'@
ssh -i $key -o BatchMode=yes pall@192.168.0.229 $remote
```

Expected: FAIL because `testExpertApi` cannot accept or use the resolver override. The
failure must occur before service execution.

- [ ] **Step 3: Apply the minimal helper change and prove GREEN**

Extend `testExpertApi` options and principal selection with the minimal implementation:

```ts
const testExpertApi = (options: {
  principals?: ExpertReferralApiDependencies["principals"];
  summary?: ExpertReferralApiDependencies["referrals"]["summary"];
} = {}): ExpertReferralApiDependencies => ({
  principals: options.principals ?? {
    resolve: async () => ({
      authenticated: true,
      userId: "00000000-0000-4000-8000-000000000001",
      expertId: "00000000-0000-4000-8000-000000000002",
    }),
  },
```

Then copy the final test file and run:

```powershell
$key = 'C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519'
scp -i $key -o BatchMode=yes apps/api/src/app.test.ts 'pall@192.168.0.229:/home/pall/app-stack/ii-tonya-test-workspace/source/apps/api/src/app.test.ts'
$remote = @'
cd /home/pall/app-stack &&
tag="$(docker images ii-tonya-test --format '{{.Tag}}' | head -1)" &&
test -n "$tag" &&
II_TONYA_SOURCE_SHA="$tag" docker compose --profile test run --rm --no-deps --entrypoint sh ii-tonya-test -lc 'CI=true ./node_modules/.bin/vitest run apps/api/src/expert-principal-resolver.test.ts apps/api/src/app.test.ts --maxWorkers=1'
'@
ssh -i $key -o BatchMode=yes pall@192.168.0.229 $remote
```

Expected: both focused files pass. Existing tests must still prove that no capability
means 404 and either enabled expert flag without a capability rejects startup.

- [ ] **Step 4: Run static checks and commit Task 2**

```powershell
pnpm exec eslint apps/api/src/app.test.ts
pnpm exec tsc --noEmit -p apps/api/tsconfig.json
pnpm exec prettier --check apps/api/src/app.test.ts
git diff --check
git add apps/api/src/app.test.ts
git commit -m "test: verify expert identity outage semantics"
```

Expected: all commands exit `0`.

---

### Task 3: Traceability, evidence, review, and publication

**Files:**

- Modify: `docs/spec/expert-residency-referrals-traceability.md`
- Modify: `docs/handoffs/2026-08-11-expert-residency-referrals-full.md`
- Create: `docs/test-evidence/claw/83e20da-expert-bearer-principal/verification.md`

**Interfaces:**

- Consumes: final code/tests and exact Claw output from Tasks 1–2.
- Produces: ERR-AUTH-001..009 traceability, portable handoff, exact focused evidence, and
  a pushed reviewable branch.

- [ ] **Step 1: Add authentication traceability**

Append this section before `## Release gate` in
`docs/spec/expert-residency-referrals-traceability.md`:

```md
## Expert Bearer authentication extension

| Requirement       | Implementation                                                                             | Focused verification                                 | Mandatory CI                     | Recovery / rollback                                           | Approval owner        |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | --------------------- |
| ERR-AUTH-001..003 | `apps/api/src/expert-principal-resolver.ts` strict Bearer parser, SHA-256 lookup, no cache | resolver syntax/hash/fresh-lookup tests              | Main CI `pnpm verify`            | remove resolver composition; routes remain capability-gated   | Security              |
| ERR-AUTH-004..006 | resolver session-state and UUID validation                                                 | expiry/revocation/identifier/minimal-principal tests | Main CI `pnpm verify`            | revoke session or disable expert capability                   | Security              |
| ERR-AUTH-007..008 | fixed lookup failure plus existing logger authorization redaction                          | resolver failure and composed API 500 tests          | Main CI security/full regression | identity outage returns sanitized 500; no fallback credential | Security + Operations |
| ERR-AUTH-009      | unchanged default server lifecycle and app capability gate                                 | existing absent-capability and flag-startup tests    | Main CI security/full regression | keep expert flags disabled                                    | Operations            |
```

- [ ] **Step 2: Add the handoff continuation**

Append `## 25. 2026-08-12 continuation: expert Bearer principal boundary` to the handoff.
Record the new files, ERR-AUTH-001..009 behavior, exact final focused test count/duration,
review result, pushed commit, and these unchanged boundaries:

```text
default server expert capability = ABSENT
expert referral activation = OFF
expert residency billing activation = OFF
live identity/session provider = NOT COMPOSED
release status = NO-GO until hosted CI and external approvals pass
```

- [ ] **Step 3: Write exact Claw evidence**

Create `docs/test-evidence/claw/83e20da-expert-bearer-principal/verification.md` with:

- branch and base SHA `83e20da49de061f278f6a3f9d42920b4cf34d5bc`;
- the actual RED failure reasons from Tasks 1 and 2;
- the exact final command and unedited Vitest file/test counts and duration;
- Compose limits of 1 CPU and 1 GiB from `/home/pall/app-stack/docker-compose.yml`;
- confirmation that `--entrypoint sh` bypassed the broad wrapper;
- static ESLint, TypeScript, Prettier, and `git diff --check` results;
- confirmation that the mounted source was restored to pushed base and zero test
  containers/processes remained;
- hosted CI/Billing boundary and disabled production composition.

- [ ] **Step 4: Restore Claw workspace and verify cleanup**

```powershell
$key = 'C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519'
cmd /c "git archive --format=tar 83e20da49de061f278f6a3f9d42920b4cf34d5bc | ssh -i C:\Users\Dmitry\.ssh\ii_tonya_claw_ops_ed25519 -o BatchMode=yes pall@192.168.0.229 tar -xf - -C /home/pall/app-stack/ii-tonya-test-workspace/source"
ssh -i $key -o BatchMode=yes pall@192.168.0.229 'test -z "$(docker ps -q --filter label=com.docker.compose.service=ii-tonya-test)"; ! ps -eo cmd | grep -q "[v]itest run apps/api/src"; printf "test_containers=0\nfocused_processes=0\n"'
```

Expected: `test_containers=0` and `focused_processes=0`.

- [ ] **Step 5: Run final verification and independent review**

```powershell
pnpm exec eslint apps/api/src/expert-principal-resolver.ts apps/api/src/expert-principal-resolver.test.ts apps/api/src/routes/expert-referral.ts apps/api/src/app.test.ts apps/api/src/index.ts
pnpm exec tsc --noEmit -p apps/api/tsconfig.json
pnpm exec prettier --check apps/api/src/expert-principal-resolver.ts apps/api/src/expert-principal-resolver.test.ts apps/api/src/routes/expert-referral.ts apps/api/src/app.test.ts apps/api/src/index.ts docs/spec/expert-residency-referrals-traceability.md docs/handoffs/2026-08-11-expert-residency-referrals-full.md docs/test-evidence/claw/83e20da-expert-bearer-principal/verification.md
git diff --check
```

Then request an independent review limited to Critical and Important findings for token
handling, error leakage, expiry/revocation semantics, route compatibility, default-off
composition, tests, and evidence. Resolve every finding and rerun the affected focused
Claw command before committing.

- [ ] **Step 6: Commit documentation and push the complete branch**

```powershell
git add docs/spec/expert-residency-referrals-traceability.md docs/handoffs/2026-08-11-expert-residency-referrals-full.md docs/test-evidence/claw/83e20da-expert-bearer-principal/verification.md
git commit -m "docs: record expert bearer principal evidence"
git status --short
git push origin codex/expert-bearer-principal
git rev-parse HEAD
git ls-remote origin refs/heads/codex/expert-bearer-principal
```

Expected: clean worktree and identical local/remote SHA. Open a Draft PR; do not mark it
ready, merge, dispatch server-control, or deploy while hosted CI is blocked or required
review/approval evidence is absent.
