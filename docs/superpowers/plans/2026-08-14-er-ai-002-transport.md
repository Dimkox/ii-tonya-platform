# ER-AI-002 Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing bounded `ExpertAiIngressService` through a default-off authenticated HTTP route and an optional private Telegram non-command seam without adding a live model, persistence, or payment provider.

**Architecture:** A dedicated Fastify route resolves a fresh expert principal for every request, validates an exact small body plus bounded idempotency/correlation metadata, and maps only the ingress service's closed result union. Telegram receives a separate optional capability and dispatches only private non-slash text when explicitly enabled; the existing slash/callback branches remain authoritative and the default lifecycle composes neither transport.

**Tech Stack:** TypeScript, Fastify, Vitest, pnpm workspace.

## Global Constraints

- Base is exactly `origin/main` at `651b8bf63c32a1e2f0caf295fe0b28aad830c960`.
- `EXPERT_AI_INGRESS_ENABLED` remains false by default.
- No live model/provider, raw conversation persistence, YooKassa activation, production, GitHub Actions, image build, or prune.
- Human behavior spot-check remains explicitly BLOCKED; deterministic fixture eval evidence remains unchanged.
- One final focused Claw run only after local GREEN; no repeated successful suite.

---

### Task 1: Authenticated HTTP transport

**Files:**

- Create: `apps/api/src/routes/expert-ai-ingress.ts`
- Create: `apps/api/src/routes/expert-ai-ingress.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: `ExpertPrincipalResolver.resolve(authorization)` and `ExpertAiIngressService.handle(command)`.
- Produces: default-off `POST /v1/expert/assistant/messages` accepting exact `{ text, locale, tariffVersionId? }`, bounded `Idempotency-Key`, optional bounded `X-Correlation-Id`, and closed sanitized HTTP outcomes.

- [ ] Write route tests proving absence while disabled, fresh authentication, exact/body/header bounds, idempotent command metadata forwarding, and sanitized mappings for completed/rejected/disabled/forbidden/unavailable.
- [ ] Run the focused route test and confirm RED because the route does not exist.
- [ ] Implement the minimal plugin and register it only when the feature and complete injected capability are present.
- [ ] Run the focused route test to GREEN once.

### Task 2: Optional private Telegram seam

**Files:**

- Modify: `apps/api/src/routes/telegram-webhook.ts`
- Modify: `apps/api/src/routes/telegram-webhook.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: injected Telegram expert-AI capability with fresh `resolvePrincipal(telegramUserId)` and existing `ExpertAiIngressService.handle` semantics.
- Produces: private non-slash dispatch keyed by `telegram:<updateId>:expert-ai`; no dispatch for slash text, group chats, disabled configuration, or incomplete capability.

- [ ] Write tests proving default lifecycle does not activate free text, private-only identity binding, fresh principal resolution, duplicate suppression, bounded outcome mapping, and unchanged slash/callback dispatch.
- [ ] Run only the focused new Telegram cases and confirm RED for missing dispatch.
- [ ] Add the minimal branch after existing callback/slash handling, reusing the inbox and rate limiter.
- [ ] Run the focused Telegram file to GREEN once.

### Task 3: Composition, traceability, and release boundary

**Files:**

- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `tests/repo/expert-ai-ingress-boundaries.test.ts`
- Modify: `docs/requirements-traceability.md`
- Create: `docs/test-evidence/claw/<revision>-er-ai-002/verification.md`

**Interfaces:**

- Consumes: the two transport capabilities from Tasks 1-2.
- Produces: fail-closed startup when enabled capability is incomplete, default lifecycle route absence, architecture guards against provider/persistence imports, and release evidence retaining the BLOCKED human checkpoint.

- [ ] Write composition and architecture tests first and observe the expected RED assertions.
- [ ] Complete application/test composition without adding a capability to `createDefaultLifecycle`.
- [ ] Run changed local tests once to GREEN, then commit the code revision.
- [ ] Run exactly one focused Claw verification against that revision, record counts and command evidence, and do not repeat a successful suite.
- [ ] Request an independent read-only review; resolve every Critical/Important finding through a new RED/GREEN cycle.
- [ ] Commit evidence and leave the branch clean without push or merge.
