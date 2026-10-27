# Public Page Landmark Correction

**Goal:** One main content landmark on every existing public route.
**Spec:** docs/superpowers/implementation-artifacts/spec-web-main-landmark.md
**Architecture:** Neutral shared mount container, semantic main owned by each route renderer.
**Stack:** Existing Vite/TypeScript/Vitest, no dependency changes.

## Task 1: Reproduce composed markup

**Files:** apps/web/src/html-landmarks.test.ts, existing index-shell and catalogue tests.
**Interfaces:** Actual shell file plus real renderers, not a synthetic substitute.
**Review focus:** Test catalogue as the counterexample too; changing only shell would give it zero mains.

- [x] RED in one new focused test file across all seven routes.
- [x] Keep heading, skip target and outer header/footer assertions.

## Task 2: Minimal correction

**Files:** apps/web/index.html and apps/web/src/catalog-view.ts.
**Interfaces:** Preserve #app and catalogue selectors/IDs; div shell, main catalogue content.
**Review focus:** No copy/API/permission/style changes.

- [x] Apply only semantic wrapper corrections.
- [x] GREEN new test plus affected existing tests individually.
- [x] Web typecheck, scoped lint/format/diff.
- [x] Record evidence, status in-review, freeze for main's independent review and real-browser build/live checks.

## Task 3: Authorized review corrections

**Files:** index shell, composed landmark tests, existing landing/consent/legal main targets; no other web behavior change.

- [x] Preserve neutral mount/catalogue landmark and existing IDs/classes/copy.
- [x] RED accessible noscript main/h1, then six missing keyboard-focus targets.
- [x] Add minimal labelled fallback and tabindex=-1 to existing main targets.
- [x] JS-enabled composition treats noscript as inactive; separately test no-JS structure/no tracking, unique target and main containment.
- [x] GREEN landmarks8/8; shell5/5; catalogue5/5, each a separate command. Web build/typecheck, tests typecheck, scoped lint/format/whitespace pass.
- [x] Record the sidecar's initial real-browser skip-focus defect; hand the rebuilt artifact to main for fresh DOM/navigation/focus and JS-disabled probes. Keep in-review and freeze.
