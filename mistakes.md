# Mistakes

- 2026-08-26 — Treated empty-state, allowlist, and self-comparison checks as release evidence. Root cause: the gate did not seed an invocation-bound lifecycle fixture or compare identity against independent git/argument facts; it now asserts expected state and cleans an isolated temporary fixture.

- Task 5’s initial repository type imported the application package from the database package, creating an unavailable build-order dependency. The root cause was coupling the DB seam to a higher layer; the repository now owns its structural claim-detail types.

- The first runtime claim implementation called a method through a mutable class prototype, so WeakSet provenance did not protect the returned details from prototype tampering. The root cause was treating genuine object identity as equivalent to immutable behavior; regression tests now cover prototype mutation and the class prototype is frozen.

## 2026-08-26 — Trusted a raw SQL generic for a computed timestamp

Root cause: the repository annotated `clock_timestamp() + interval` as `Date`, but the PostgreSQL/Drizzle raw result returned a string and TypeScript could not validate that runtime boundary. Normalize and validate computed timestamps immediately after raw SQL instead of calling `Date` methods on asserted generic types.

## 2026-08-26 — Mixed wall-clock and transaction timestamps at a constrained boundary

Root cause: operation expiry used `clock_timestamp()+24h` while `created_at DEFAULT now()` used the earlier transaction timestamp, making expiry exceed the schema's exact 24-hour maximum. Derive related constrained timestamps from the same PostgreSQL clock semantic.

## 2026-08-26 — Applied a context-light patch at the wrong SQL insertion site

Root cause: a broad patch anchor placed the tool-outbox guard in `persistHandoff` instead of `auditCompletionAndOutbox`, so the intended branch still executed. For repeated SQL shapes, inspect the exact surrounding method immediately after patching and anchor changes on the method-specific context.

## 2026-08-26 — Left a stale shape expectation after widening the contract

Root cause: the catalog contract was changed to accept any bounded trimmed non-control service code, but one prompt-safety case still classified `../admin` as malformed instead of structurally valid and unauthorized without an allowlist. Keep shape assertions aligned with the contract and test authorization as a separate boundary.

## 2026-08-26 — Made a runtime-required alarm optional in the type contract

Root cause: encryption and nonce-collision alarm capabilities were typed as two independent optional properties even though the tool path requires them together. Model coupled capabilities as a discriminated option union so invalid repository composition fails during typechecking.

## 2026-08-26 — Accepted incomplete Task 6 evidence

Root cause: the initial Task 6 owner relied on focused tests and string-only structural assertions and claimed typecheck green without preserving/verifying the actual command result, allowing an incompatible OpenTelemetry type and incomplete gate/privacy evidence.

## 2026-08-26 — Embedded interpolation inside a Drizzle SQL literal

Root cause: a new privacy fixture placed template interpolation inside a quoted SQL string, producing a prepared-statement parameter mismatch. Keep dynamic SQL values as outer tagged-template parameters.
