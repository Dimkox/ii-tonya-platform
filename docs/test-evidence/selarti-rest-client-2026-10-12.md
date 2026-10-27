# Selarti REST client verification

## Review regression checkpoint (not executed)

All three review layers completed; accepted findings are recorded in
`selarti-rest-client-review-2026-10-12.md`. Regressions are prepared in the same
logical test file for malformed/blank IDs, exact opaque-ID preservation,
non-ASCII bearer rejection, genuinely missing fields, success-shaped non-200
responses, independently isolated declared/actual byte bounds, exactly 64 KiB,
chunked multibyte responses, invalid UTF-8, and monotonic deadline enforcement
without advancing timer callbacks. Runbook now records public collection
provenance and explicitly distinguishes application limits from provider limits.

No new Vitest invocation occurred. Budget remains 3/3 consumed; two requested
extra invocations are pending owner authorization. Production guards remain
unchanged so the next authorized focused invocation can establish behavioral RED.
The previous 47/47 result below does not verify these newly added regressions.

## Original implementation verification

Baseline: `690797db64fd80aa1aeccea8003543de470d8c16` on `codex/planerka-api`.
The spec frontmatter context list is empty. Existing unrelated changes preserved.

Environment check passed: Node 24.21.0, pnpm 11.9.0.

Focused logical test file: `packages/integrations/src/selarti/rest-client.test.ts`.
All three allowed invocations consumed; do not rerun without owner authorization.

1. 16:13:27 UTC: collection failed because the implementation did not exist.
   Tests were authored first; this is not behavioral RED evidence.
2. 16:14:32 UTC: 42/42 passed.
3. 16:15:52 UTC: 47/47 passed, including late-body cancellation, before-write
   classification, query encoding, boundaries, page size and read timeout.

Matrix coverage includes accepted/foreign sends, normalized/foreign message pages,
input validation without HTTP, HTTP/JSON/body failures, explicit transport phases,
header/body deadlines, empty stream chunks and response byte limits.

Integrations typecheck, tests typecheck, scoped ESLint/Prettier and whitespace
checks are recorded by the implementing session. No broad suite or other provider
test file was run. No real credentials or provider traffic were used.

Independent adversarial review is pending: reviewer-agent tools are unavailable.
Prepared three review handoffs alongside the spec. This is a local candidate,
not release evidence or complete AI delivery. Token acquisition/refresh, durable
correlation/polling, trusted composition and activation remain separate work.
