# Task 18 report: read-only operational projections

## Scope completed

- Added the public `ProjectionEvent`, `ProjectionSink`, and four-topic projection
  contract in `packages/integrations/src/projections/projection-port.ts`.
- Added `MakeProjectionSink`, an outbound-only injected HTTP sink. It requires an
  HTTPS endpoint, supplies the injected `Authorization` value on every request,
  sets `Idempotency-Key` to `eventId`, and uses `AbortSignal.timeout(5_000)`.
- The sink accepts only schema version `1`, the specified topic union, and each
  topic's allowlisted scalar payload fields and types. It rejects unexpected
  fields, so sensitive text and credentials cannot be added to a projection
  envelope.
- Non-2xx status values are normalized to typed permanent failures, except
  408/425/429/5xx and transport failures, which become typed retryable failures.
- Exported the projection contract/sink from the integrations package. The
  payment-scope guard's precise public-barrel allowlist and hash were updated
  only to accommodate that required export.
- Added an AST-based architecture test preventing projection imports outside
  the integrations projection implementation, integrations public barrel, or
  worker composition. Added an AST-based API scan that rejects any Fastify
  Make/Sheets route. No inbound route, Sheets SDK/credential/readback, database
  access, admin code, or runtime composition was added.

`MAKE_PROJECTION_ENABLED` and `GOOGLE_SHEETS_PROJECTION_ENABLED` remain literal
`false` in the existing environment policy and example configuration.

## TDD evidence

The test-first command was run before production implementation:

```text
pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/scope-boundary.test.ts tests/repo/architecture-boundaries.test.ts
```

It was RED because `./make-projection-sink.js` did not exist. The failure was
the expected missing implementation, not a test setup error.

After the minimal implementation, these checks passed:

```text
pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/architecture-boundaries.test.ts
# 2 files, 5 tests passed

pnpm exec vitest run tests/repo/scope-boundary.test.ts -t "contains no inbound Make or Sheets Fastify route"
# 1 test passed (70 unrelated tests skipped)

pnpm typecheck
# all 10 workspace projects passed

pnpm lint
# passed

git diff --check
# passed
```

## Known repository baseline concern

The requested full focused Vitest command still fails two pre-existing
`scope-boundary.test.ts` assertions unrelated to Task 18:

1. `.github/workflows/db-gate.yml` does not match its pinned historical hash.
2. The recursive payment-scope scan reports 59 existing unapproved migration,
   schema, journal, and workflow baseline violations from Tasks 9-17.

Task 18 did not introduce any of those violations; after updating the required
integrations public-barrel hash, `packages/integrations/src/index.ts` is no
longer among them. The new inbound Make/Sheets assertion passes independently.

## Review fix wave evidence

### Hostile RED evidence

1. `pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts`
   was RED with 6 failures: non-finite number accepted, inherited topic name
   accepted, malformed envelope values accepted or caused raw `TypeError`, the
   injected URL could be downgraded after construction, and malformed/null
   responses were not typed permanent failures.
2. `pnpm exec vitest run tests/repo/architecture-boundaries.test.ts` was RED
   because the reusable semantic classifier did not exist. A later isolated
   namespace re-export probe was also RED until that AST form was handled.
3. `pnpm exec vitest run tests/repo/scope-boundary.test.ts -t "Make or Sheets"`
   was RED because the reusable Fastify route classifier did not exist.
4. `pnpm exec vitest run tests/repo/scope-boundary.test.ts -t "post-MVP|reviewed non-payment"`
   was RED with six failures for unpinned committed migrations/snapshots and
   exact reviewed schema relations.

### Green implementation

- Runtime validation now starts from `unknown`: it requires a plain non-null
  object, uses `Object.hasOwn` for topics, validates non-empty string envelope
  values and schema `1`, accepts only explicit allowed scalar types, rejects
  non-finite numbers, and reconstructs the outbound event/data from validated
  own scalar fields.
- The constructor clones and freezes a validated HTTPS URL; delivery uses a
  fresh URL made from the private clone, so caller mutation cannot downgrade it.
- Authorization callback/config errors (including blank or non-string values)
  are typed permanent failures without leaking authorization text. Only the
  injected `post` call is in the retryable transport catch. Null/malformed
  transport results are typed permanent failures.
- Projection import checks now parse TypeScript statements and catch direct
  imports/re-exports plus public barrel named, aliased, namespace, star, and
  namespace re-exports outside the explicit worker/integrations boundaries.
- Route checks now use a reusable TypeScript classifier that detects Fastify
  property/element method calls, strings/templates, const route/options
  variables, and `register` prefixes.
- The payment scope guard now has exact hashes for committed migrations and
  snapshots through Task 17, the current workflow/journal hashes, and a narrow
  explicit list of the reviewed non-payment schema relations.

Final verification after the fix wave:

```text
pnpm exec vitest run packages/integrations/src/projections/make-projection-sink.test.ts tests/repo/architecture-boundaries.test.ts tests/repo/scope-boundary.test.ts
# 3 files, 106 tests passed
pnpm typecheck
# 10 workspace projects passed
pnpm lint
# passed
git diff --check
# passed
```
