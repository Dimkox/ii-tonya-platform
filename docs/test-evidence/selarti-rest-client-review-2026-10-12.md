# Selarti native client review — 2026-10-12

Candidate is uncommitted, baseline690797db64fd80aa1aeccea8003543de470d8c16.
Implementer reports47/47 GREEN and type/lint/format checks. Logical test budget3/3
is exhausted: first invocation was import/collection failure, not behavioral RED.
No complete TDD claim. No runtime integration or live provider call.

Three independent read-only layers completed:
blind01a130e7-8fe2-7ba1-8d55-a2859759605f,
edge01a130e7-8f86-7371-bb5f-8330ae21639a,
verification01a130e7-9036-77a3-ae60-9e1732da291b.

## Coordinator triage

- Patch, medium: IDs accept malformed UTF16. URLSearchParams replaces unpaired
  surrogates; an empty read page can silently refer to a different identifier.
  Reject malformed/whitespace-only IDs without rewriting valid opaque values.
- Patch, medium: bearer accepts non-header-compatible Unicode; fetch can fail
  before network while send reports uncertainty. Validate header-token syntax
  at construction. No credential content may escape error messages.
- Patch, high verification gap: oversized/declared-size tests use invalid JSON;
  removing both size guards still produces expected rejection. Use otherwise
  valid bound envelopes, actual byte boundaries and chunked UTF8 coverage.
- Patch, medium verification gap: non200 tests also use invalid JSON; removing
  HTTP guard still passes them. Use success-shaped bodies at rejected statuses.
- Patch, low/medium coverage: genuine missing fields and monotonic deadline when
  timer callback has not run; add focused assertions in the existing logical file.
- Patch, low documentation: cite public collection and distinguish application
  bounds from provider limits. Document smaller read pages/offset ceiling without
  claiming any request correlation or safe resend of ambiguous generation.

Other suggestions do not establish defects in this scoped transport: rejecting
long replies is intentional bounded behavior; page-size/body-budget interaction
needs documented caller handling, not unbounded buffering. Duplicate message
delivery belongs to the required durable bridge; this client claims no dedup or
ordering. Caller abort/diagnostic taxonomy are useful future interface choices,
not grounds to weaken the current bounded fail-closed behavior. No positive
release verdict follows from that scope distinction.

Implementer resumed to prepare regression changes BEFORE changing guards. Owner
request for two extra focused invocations is pending. Do not run exhausted tests,
rename them, or use a broad suite. Native client remains unaccepted for activation;
token acquisition and the durable authenticated response bridge remain required.
