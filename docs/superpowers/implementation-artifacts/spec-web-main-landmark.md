---
title: One accessible main landmark per public page
type: bugfix
status: in-review
route: one-shot
created: 2026-10-05
baseline_commit: dce8b2e149d0553a7d6fa19a9941ed2a0e30494e
context:
  - AGENTS.md
  - docs/superpowers/implementation-artifacts/spec-client-sensitive-consent.md
  - docs/superpowers/plans/2026-10-05-web-main-landmark.md
---

## Intent

Fix the public website's nested main landmarks without changing commercial copy, authentication, API calls, styles or permissions. Real Chrome against deployed 2db008f on 2026-10-05 05:16:34 UTC found two main elements with one nested on /, /account, /consent, /my-data, /privacy and /oferta; /catalog has only the shell main. All pages return200, one h1, no390px horizontal overflow. Root cause: index.html uses main#app but six route templates also render main; catalogue's content wrapper is section.

## Scope and decisions

Own apps/web/index.html, apps/web/src/catalog-view.ts, a new apps/web/src/html-landmarks.test.ts and necessary focused index-shell/catalog-view expectations; this spec and linked plan. Existing parent owner request authorizes fixing found defects and RC release. Do not alter legal content, features, provider configuration, dependencies, backend, finance or secrets. Preserve all IDs, classes, labelled heading, tabindex, skip link, API binding selectors and navigation. Use a non-semantic div#app as mount shell and a semantic main#catalog-content for catalogue content. Every renderer then owns exactly one main; header/footer stay siblings outside it.

## Acceptance

- RED against existing code: compose actual index shell with each exported real renderer for /, /catalog, /account, /consent, /my-data, /privacy, /oferta. Assert exactly one main and no nested main; one h1; skip link resolves to its intended content wrapper.
- GREEN minimal shell+catalogue patch. No changing assertions merely to accept two main landmarks.
- Keep first-party-only/CSP/no-inline-script and existing catalogue interaction semantics.
- Individual focused files only, no aggregate/multi-path test command, no PG, no new dependency. Scoped web typecheck, lint/format and diff --check.
- Main will independently review and run built/live real-browser probes with one-main assertions across all seven routes; not only renderer-string tests.
- Record exact checks, in-review and freeze all writes. No commit/push/deploy/nested agents/new worktree.

## Verification

TDD reproduced the composed-page defect: `pnpm exec vitest run apps/web/src/html-landmarks.test.ts` initially failed all 7 cases (six nested landmarks, catalogue content not the main target). After the shell/catalogue correction, 7/7 passed, including the final run with explicit header/footer presence. Individually, `catalog-view.test.ts` passed 5/5 and `index-shell.test.ts` passed 5/5. Web typecheck/build, tests typecheck, scoped ESLint, Prettier and `git diff --check` passed.

Real Chrome against the locally built web at 05:22:11 UTC verified all seven routes: HTTP200, exactly one main, no nested main, one h1, no horizontal overflow at390px, and zero browser errors. This was a frontend check, not backend integration evidence. Live-before-change evidence remains the failing 2db008f browser probe; the next RC's post-deploy probe must verify the corrected built artifacts on production.

All repository writes frozen for independent review together with the backup-evidence candidate. No aggregate or PostgreSQL command ran for this slice. This is an accessibility correction, not activation of missing commercial features. Status remains in-review while exact-SHA external release gates are unavailable.

## Suggested Review Order

1. [Neutral mount shell](../../../apps/web/index.html) and [catalogue content landmark](../../../apps/web/src/catalog-view.ts).
2. [Composed real-renderer regression cases](../../../apps/web/src/html-landmarks.test.ts) and [catalogue expectations](../../../apps/web/src/catalog-view.test.ts).
3. [Execution plan](../plans/2026-10-05-web-main-landmark.md).

## Authorized review patch — 2026-10-05

The controller extended the sole writer's scope under existing owner authorization to `index.html`, `html-landmarks.test.ts`
and the existing main targets in `landing-view.ts`, `consent-view.ts`, and
`legal-view.ts`. Preserve the previous `div#app`, catalogue `main#catalog-content`,
IDs, classes, commercial/legal copy and interactions. The only added copy is the
minimal no-JavaScript heading “ии-Тоня”; the existing fallback sentence is exact.

The main sidecar's real Chrome probe of the initial built correction found unique
targets and correct main ancestry on all seven routes, but Enter on the skip link
failed to focus the main on six routes. Only catalogue already had `tabindex=-1`.
The bounded patch adds that attribute to the other three shared renderer targets,
adds a labelled main/h1 in noscript, and treats noscript as inactive when composing
JS-enabled markup. Tests separately check the no-JS heading/main and no tracking,
unique skip target, containment in main and tabindex. No parser dependency added.

Focused verification: `pnpm exec vitest run apps/web/src/html-landmarks.test.ts`
first failed 1/8 for the fallback, then 7/8 for fallback plus focus targets, and
passed 8/8 after the patch. Individually, `index-shell.test.ts` passed 5/5 and
`catalog-view.test.ts` passed 5/5. Web build/typecheck, tests typecheck, scoped ESLint,
Prettier and whitespace checks passed. Main owns the fresh real-browser DOM,
navigation ancestry, keyboard-focus and JavaScript-disabled probes on the new
build; this test record does not claim those sidecar probes have completed.

Writes frozen again; status remains `in-review`. No commit, push, deployment,
commercial/legal copy change, new dependency or activation. See the shared
[patch closure table and final file manifest](spec-backup-erasure-evidence.md#bounded-independent-review-patch-round--2026-10-05).

## Independent closure and built-browser evidence

Independent read-only review returned closure PASS for this bounded correction.
Main's final real-Chrome probe at 05:42:57 UTC passed all seven routes: unique main
and skip target, correct navigation ancestry, actual keyboard Enter focus on
main, one h1, no390px overflow and zero browser errors. All seven pages also passed
in a JavaScript-disabled context with one fallback main/h1 and zero API/external
requests. Main reran the composed markup file: 8/8 PASS. The temporary preview
server was stopped. These checks do not establish backend/provider readiness;
the production artifact still requires its post-deployment check.
