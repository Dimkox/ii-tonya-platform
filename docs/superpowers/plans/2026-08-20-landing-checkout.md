# Promotional Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public ии-Тоня promotional landing as an information catalogue whose action buttons open the configured messenger.

**Architecture:** Add a static-first Vite application under `apps/web`, deployed as its own unprivileged nginx image beside the API. The browser renders approved public content and opens a configurable messenger link for every action. It contains no authentication, forms, quote, checkout, payment, receipt, webhook, reconciliation, or financial-status logic.

**Tech Stack:** Node.js 24, pnpm 11.9.0, TypeScript strict mode, Vite 7, semantic HTML, CSS design tokens, Vitest, nginx unprivileged, Docker Compose, existing Fastify/PostgreSQL/YooKassa services.

**Spec:** `docs/superpowers/specs/2026-08-20-unified-client-expert-platform-design.md`

## Global Constraints

- PostgreSQL/backend remains authoritative; the browser cannot create ledger, booking, referral, or residency facts directly.
- No provider credential, bearer token, client profile, receipt contact, or internal UUID is embedded in web assets, URLs, logs, or analytics.
- Products and tariffs are informational catalogue content only; subsequent messenger behaviour remains outside the landing.
- Public tariff wording and legal claims are marked as subject to approved published content; placeholders block production release.
- The site supports keyboard navigation, reduced motion, responsive layouts, and WCAG AA contrast.
- Local concurrency is one focused run; 20x gates run only in CI.

---

## File Structure

- `apps/web/package.json` — isolated web scripts and direct Vite dependency.
- `apps/web/index.html` — metadata and application mount point.
- `apps/web/src/content.ts` — typed, reviewed public copy and tariff display data.
- `apps/web/src/config.ts` — validates the public Telegram/chat URL and exposes no secrets.
- `apps/web/src/messenger-link.ts` — builds an allowlisted messenger intent link.
- `apps/web/src/main.ts` — renders the promotional landing.
- `apps/web/src/styles.css` — warm design system, layout, accessibility, and responsive rules.
- `apps/web/src/*.test.ts` — public-config, content, handoff, and rendered-source regression tests.
- `apps/web/public/robots.txt` — crawler policy.
- `apps/web/nginx.conf` — immutable assets, SPA fallback, health endpoint, and security headers.
- `Dockerfile.web` — deterministic Vite build and unprivileged runtime image.
- `compose.yaml` and `deploy/compose.remote.yml` — add the web service without changing API authority.
- `.env.example` — document only the non-secret public handoff URL.
- `tests/repo/release-assets.test.ts` — guard the web image and deployment contract.

### Task 1: Scaffold the isolated web workspace

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Modify: `pnpm-lock.yaml`
- Test: `tests/repo/workspace-layout.test.ts`

**Interfaces:**

- Produces: `@ii-tonya/web` scripts `build`, `typecheck`, `test`, and a `dist/` directory.
- Consumes: root pnpm workspace, TypeScript strict settings, and Vite 7.

- [ ] **Step 1: Add a failing workspace assertion**

Assert `apps/web/package.json` exists, is private ESM, pins `vite` as a direct dev dependency, and defines `build: vite build` plus `typecheck: tsc --noEmit`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec vitest run tests/repo/workspace-layout.test.ts`
Expected: FAIL because `apps/web/package.json` does not exist.

- [ ] **Step 3: Add the minimal workspace**

Create the manifest, a strict DOM-aware `tsconfig.json`, an `index.html` with Russian metadata, and `main.ts` importing `styles.css` and rendering a product-specific heading.

- [ ] **Step 4: Refresh dependencies and confirm GREEN**

Run: `pnpm install --frozen-lockfile=false && pnpm exec vitest run tests/repo/workspace-layout.test.ts && pnpm --filter @ii-tonya/web build`
Expected: PASS and `apps/web/dist/index.html` exists.

- [ ] **Step 5: Commit**

Commit: `feat(web): scaffold public landing application`

### Task 2: Add reviewed content and safe messenger links

**Files:**

- Create: `apps/web/src/content.ts`
- Create: `apps/web/src/content.test.ts`
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/config.test.ts`
- Create: `apps/web/src/messenger-link.ts`
- Create: `apps/web/src/messenger-link.test.ts`

**Interfaces:**

- Produces: `landingContent`, `readPublicConfig(metaEnv)`, and `buildMessengerLink(config, intent)`.
- `PublicConfig = { expertChatUrl: URL }`.
- `TariffCode = "base" | "exclusive" | "event"`.

- [ ] **Step 1: Write RED tests**

Cover exact ии-Тоня spelling, prohibited sales/medical guarantees, missing placeholder legal identifiers, HTTPS or `tg:` URL allowlisting, rejection of credentials/query secrets, and a handoff parameter containing only `expert_<tariffCode>`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm exec vitest run apps/web/src/content.test.ts apps/web/src/config.test.ts apps/web/src/messenger-link.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement typed public content and URL policy**

Use factual copy from the supplied document, mark prices as `от` and subject to current terms, and reject public URLs with username/password, non-allowlisted protocols, fragments, or secret-like query keys. Append only a fixed `start=expert_<code>` intent for Telegram HTTPS links.

- [ ] **Step 4: Confirm GREEN**

Run the three focused test files and `pnpm --filter @ii-tonya/web typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(web): add approved landing content and messenger links`

### Task 3: Build the complete responsive landing

**Files:**

- Modify: `apps/web/src/main.ts`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/main.test.ts`
- Create: `apps/web/public/robots.txt`

**Interfaces:**

- Consumes: `landingContent`, `readPublicConfig`, `buildExpertHandoff`.
- Produces: sections `hero`, `about`, `clients`, `experts`, `tariffs`, `faq`, `contacts`, `legal`; keyboard-operable FAQ; messenger CTA links.

- [ ] **Step 1: Write RED source/DOM-contract tests**

Assert one `h1`, ordered heading levels, landmarks, skip link, labelled navigation, links with visible names, all eight sections, no inline event handlers, no form, no authentication UI, no payment code, and no remote tracker.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `pnpm exec vitest run apps/web/src/main.test.ts`
Expected: FAIL because the complete surface is absent.

- [ ] **Step 3: Implement the landing**

Render the warm terracotta/cream/green visual system, editorial typography, asymmetric hero, trust boundary, client/expert paths, tariff cards, FAQ disclosure widgets, contact actions, and legal footer. Use CSS-only decorative shapes, `prefers-reduced-motion`, visible focus, 44px targets, and breakpoints at 900px and 640px.

- [ ] **Step 4: Build and validate**

Run: `pnpm --filter @ii-tonya/web test && pnpm --filter @ii-tonya/web typecheck && pnpm --filter @ii-tonya/web build`.
Expected: PASS with hashed assets and no external runtime dependency.

- [ ] **Step 5: Commit**

Commit: `feat(web): build responsive ii-tonya landing`

### Task 4: Package and route the landing safely

**Files:**

- Create: `apps/web/nginx.conf`
- Create: `Dockerfile.web`
- Modify: `compose.yaml`
- Modify: `deploy/compose.remote.yml`
- Modify: `.env.example`
- Modify: `tests/repo/release-assets.test.ts`

**Interfaces:**

- Produces: web container on internal port `8080`, `/healthz`, SPA fallback, immutable asset caching, and injected `PUBLIC_EXPERT_CHAT_URL` at build time.
- Consumes: reverse proxy ownership of `ii-tonya.ru`, existing API/worker services, pinned image digest policy.

- [ ] **Step 1: Write RED deployment guards**

Assert the runtime is unprivileged, read-only compatible, has no shell package installation, sets CSP/frame/referrer/content-type headers, includes healthcheck, and does not mount source, Docker socket, credentials, or `.env` into the web container.

- [ ] **Step 2: Run focused repository tests and confirm RED**

Run: `pnpm exec vitest run tests/repo/release-assets.test.ts tests/repo/workflow-semantics.test.ts`
Expected: FAIL for missing web release assets.

- [ ] **Step 3: Add the image and Compose service**

Build with pinned Node and nginx-unprivileged bases, copy only `dist`, bind `8080`, set read-only root/cap-drop/no-new-privileges/tmpfs, and keep API routes on the API service. Document the public URL variable without a value.

- [ ] **Step 4: Validate release contracts**

Run: `pnpm verify:deploy` and the focused repository tests.
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(deploy): package landing as hardened web service`

### Task 5: Prove promotional landing behaviour

**Files:**

- Create: `tests/e2e/landing-promo.test.ts`
- Create: `docs/test-evidence/landing/README.md`
- Modify: `docs/spec/expert-residency-referrals-traceability.md`

**Interfaces:**

- Consumes: built web image and configured messenger link.
- Produces: sanitized evidence for landing response, catalogue content, CTA intents, security headers, accessibility checks, and cleanup.

- [ ] **Step 1: Add a failing end-to-end contract**

Assert the public page returns 200, each CTA carries only its allowed messenger intent, and the web bundle contains no API checkout, authorization, receipt, webhook, or payment-provider reference.

- [ ] **Step 2: Run local non-container portion**

Run: `pnpm build && pnpm exec vitest run apps/web tests/repo/release-assets.test.ts tests/e2e/landing-promo.test.ts`.
Expected: static and boundary checks PASS.

- [ ] **Step 3: Run the Docker-capable gate**

Push the exact branch SHA, run GitHub CI/Database Gate, then run one approved focused Claw web-image gate. Require final summary, exit code 0, SHA/checksums, zero leaked secrets, and cleanup counts.

- [ ] **Step 4: Record evidence and review**

Commit only sanitized verification metadata; keep raw logs remote. Run adversarial review over web security, public claims, checkout authority, and deployment isolation.

- [ ] **Step 5: Commit**

Commit: `test(web): verify promotional landing boundary`

### Task 6: Final verification and publication readiness

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/provider-staging-evidence.md`
- Modify: `docs/runbooks/go-live-evidence.md`

**Interfaces:**

- Produces: exact release checklist and explicit remaining approvals.

- [ ] **Step 1: Run complete local non-container verification**

Run: `pnpm build && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:contract && pnpm test:security`.
Expected: PASS.

- [ ] **Step 2: Verify remote CI**

Require CI and Database Gate success for the exact SHA. Do not accept a workflow file, queued run, or older green SHA.

- [ ] **Step 3: Verify the rendered site**

Check desktop/mobile layout, keyboard flow, reduced motion, tariff CTA destinations, return state, broken links, placeholder leakage, and public copy sign-off. Record the named reviewer.

- [ ] **Step 4: Verify release boundary**

Confirm landing readiness separately from live YooKassa activation. Production payment remains NO-GO until credentials, receipt contact consent, provider staging evidence, reconciliation, rollback drill, legal copy, and deployment authorization are all recorded.

- [ ] **Step 5: Commit and push**

Commit: `docs(web): record landing release evidence`; push `codex/tonya-full-update` and return direct GitHub links.
