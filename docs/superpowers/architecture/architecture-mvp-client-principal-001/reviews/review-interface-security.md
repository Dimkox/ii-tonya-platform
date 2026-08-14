# MVP-CLIENT-PRINCIPAL-001 Interface and Security Review

Verdict: **APPROVED FOR DEFAULT-OFF IMPLEMENTATION HANDOFF; zero Critical and zero Important findings remain.** Live activation remains **BLOCKED**; this review is not Security approval, deployment authorization, or evidence that an identity-proof source exists.

Scope reviewed: all new `MVP-CLIENT-PRINCIPAL-001` specification, contract, architecture, plan, traceability, progress, and activation documents; committed catalog documents at `85e78098a10e0dae7359447068995bd355d73770` (which contains `10819c8`); and current `origin/main` identity/session composition at `b6763dde890f472c5ad0fcf5a5dbd4ebba2e8423`. Review only: no tests, network, Claw, provider, production, or catalog-worktree mutation was performed.

This document exists to help the Platform, Catalog, DB, Privacy, and Security owners close interface and trust-boundary gaps before code is written. The documents broadly follow the appropriate strategic/reference structure; the findings below prioritize executable contract defects over copy-editing.

## 2026-08-14 resumed independent review and reconciliation

The resumed independent review found one Critical and eight Important gaps. The draft package was
updated in place; the historical findings below remain as the audit trail.

| Finding | Reconciliation |
| --- | --- |
| Critical: receipt/session erasure contradiction | Standardized nullable session link with `ON DELETE SET NULL`; erasure removes the session and retains a non-linkable receipt until proof expiry in spec, contract, spine, plan, traceability and memlogs. |
| Important: missing catalog error amendment | Added `docs/contracts/client-catalog-session-amendment.md` with precedence, typed `resolved|denied|unavailable` outcomes, `401`, both `503` branches and preflight composition. |
| Important: duplicate authorization defense absent from plan | Assigned exact case-insensitive `rawHeaders` occurrence counting and proxy/protocol cases to Task 3 before normalized-value parsing. |
| Important: verifier resource bounds absent from plan | Added a named per-process gate, 32-call ceiling, 2-second abort deadline, saturation and late-completion zero-row tests. |
| Important: preflight-before-migration absent from plan | Added pure preflight before `migrateDb` plus assertions that migration, registration and listen remain untouched for invalid matrices. |
| Important: traceability incomplete | Added dedicated CPS-005A, CPS-006A and CPS-016 rows and updated plan self-review through CPS-016/AC-11. |
| Important: HMAC key/version ambiguity | Replaced public `keyVersion` as key with secret verifier-owned `K_replay[v]`, bounded canonical fields and one strict versioned runtime grammar. |
| Important: Claw rerun contradiction | Froze exactly one invocation total for this slice; failure is retained as terminal evidence and cannot be rerun under the slice ID. |
| Important: frozen HTTP contract weaker than canonical spec | Added exact media type, charset, encoding, UTF-8, duplicate-key, trailing-byte, framing, byte-cap and control-code rules to the contract and plan. |
| Minor: lifecycle metadata and principal digest | Spine moved to `implementation-ready` only after clean re-review; token digest was removed from the catalog-facing principal. |

Two post-reconciliation independent passes confirmed zero Critical and zero Important findings.
The final pass also verified that all five SPEC companions, all architecture companion/source paths,
and the pinned catalog-ref source resolve. The architecture spine may therefore carry
`status: implementation-ready`; `activation: blocked` remains unchanged.

## Critical

None.

## Important

### I-01 — Resolver outage semantics conflict with the frozen catalog contract

- **Location:** `docs/spec/mvp-client-principal-001.md:57-66`; catalog `docs/contracts/client-catalog.md:68-69`; catalog `docs/spec/mvp-client-catalog-001.md:14-17`
- **Finding:** The principal spec requires a PostgreSQL resolver failure to return generic `503`, while the frozen catalog contract says resolver exceptions are `401` and lists only `503 feature_disabled`. Implementers cannot satisfy both contracts, and choosing either path can create an availability oracle or break catalog compatibility.
- **Concrete fix:** Amend and version the catalog HTTP contract before implementation: freeze one exact response for resolver infrastructure failure (recommended generic `503 {"error":"temporarily_unavailable"}`), reserve `401` for negative authority, and update both route tests and traceability documents to the same mapping.

### I-02 — Duplicate `Authorization` detection is delegated to a lossy framework value

- **Location:** `docs/contracts/client-session-principal.md:70-92`; `docs/spec/mvp-client-principal-001.md:53-56`
- **Finding:** `string | string[] | undefined` does not prove that duplicate field lines survived Node/Fastify normalization. A proxy or parser may join or discard duplicates before `resolve`, so the promised rejection of every duplicate credential is not implementable from this interface alone.
- **Concrete fix:** Make the HTTP adapter inspect `request.raw.rawHeaders` (or a verified equivalent) and require exactly one case-insensitive `Authorization` field occurrence before passing its single value to the parser. Freeze tests for two field lines, comma-folding, mixed field-name case, HTTP/1.1, and the deployed HTTP/2/proxy normalization path.

### I-03 — The verifier output is typed but not specified as hostile runtime input

- **Location:** `docs/contracts/client-session-principal.md:7-28`; `docs/spec/mvp-client-principal-001.md:23-28`; `docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md:49-58`
- **Finding:** TypeScript literal fields do not validate a production adapter at runtime. The contract does not explicitly require rejection of an invalid UUID, invalid `Date`, non-finite/out-of-range instant, malformed replay digest, extra properties, or runtime audience/scope mismatch before any transaction.
- **Concrete fix:** Add a strict post-verifier schema at the application trust boundary: exact keys only; canonical UUID; exact audience and scope; valid finite UTC instant representable by PostgreSQL; and `^hmac-sha256:[0-9a-f]{64}$`. Map every validation failure to the same `401` and create zero rows.

### I-04 — Replay HMAC domain, stability, and key rotation are not frozen

- **Location:** `docs/spec/mvp-client-principal-001.md:23-28`; `docs/runbooks/client-session-activation.md:18-25`; `_bmad-output/specs/spec-mvp-client-principal-001/SPEC.md:51-54`
- **Finding:** The documents require a verifier-produced HMAC digest but do not define its canonical input, domain separation, tenant/environment binding, stability across verifier replicas, or behavior during key rotation. A digest that changes during the proof lifetime permits replay; a shared undomained digest can collide across proof classes or environments.
- **Concrete fix:** Freeze a versioned construction such as `HMAC(key_version, "ii-tonya/client-proof-replay/v1\0" || environment || "\0" || issuer || "\0" || canonical_proof_id)`, require the same digest from every replica for at least the proof lifetime, and define overlap/retirement rules that keep old-key replay detection until all affected proofs expire. Record this in the Security gate.

### I-05 — Verifier liveness and resource limits are absent

- **Location:** `docs/contracts/client-session-principal.md:59-66`; `docs/spec/mvp-client-principal-001.md:29-35`
- **Finding:** `503` is specified for verifier unavailability, but no deadline, cancellation propagation, concurrency bound, or overload behavior is defined. A slow or hanging verifier can hold request bodies and sockets indefinitely and exhaust the API without violating the written contract.
- **Concrete fix:** Add a bounded verifier deadline below the route timeout, propagate cancellation, cap concurrent verification, and normalize timeout/overload to the same credential-free `503`. Add tests for hang, late resolution after abort, exception with nested credential data, and concurrency saturation.

### I-06 — Issuance and user deactivation have no shared serialization rule

- **Location:** `docs/spec/mvp-client-principal-001.md:42-47`; `docs/contracts/client-session-principal.md:103-113`; `docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md:49-58`
- **Finding:** “locking/checking the active user” does not state the lock mode or require the deactivation/privacy path to take the same lock in the same order. Issuance can read `active=true` while a concurrent deactivation commits, then return a bearer for an inactive user even though later resolution rejects it.
- **Concrete fix:** Freeze a serialization contract: issuance locks the `users` row `FOR UPDATE` before replay/session inserts; deactivation/erasure locks that same row before changing `active` or deleting session state; document lock order and the allowed winner semantics. Add real-PostgreSQL interleaving tests for both commit orders.

### I-07 — Concurrent revoke does not have a specified single-winner update

- **Location:** `docs/contracts/client-session-principal.md:95-101`; `docs/spec/mvp-client-principal-001.md:48-52`
- **Finding:** Two `DELETE` requests can both resolve the session before either writes `revoked_at`. The promise that the second revoke returns `401` requires a conditional update, but the repository contract only says “atomically sets” once.
- **Concrete fix:** Require one statement/transaction equivalent to `UPDATE ... SET revoked_at = clock_timestamp() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp() ... RETURNING ...`; return `204` only for one returned row and `401` for zero. Add a real-PostgreSQL concurrent-revoke test.

### I-08 — Subject erasure contradicts replay retention without an account-restoration rule

- **Location:** `docs/spec/mvp-client-principal-001.md:93-101`; `docs/contracts/client-session-principal.md:105-113`
- **Finding:** Routine cleanup says a replay receipt remains until proof expiry, but subject erasure deletes it immediately and asserts that the proof cannot become issuable again. That assertion depends on an unstated invariant that the deleted internal identity can never be restored or recreated with the same UUID while the proof remains valid.
- **Concrete fix:** State and enforce the identity lifecycle invariant, or preserve a privacy-approved non-linkable replay tombstone until proof expiry. Add an erasure-then-replay test and an explicit decision for account restoration/recreation; do not claim replay remains closed until one of these mechanisms is frozen.

### I-09 — Invalid startup composition is currently detected only after migrations can mutate PostgreSQL

- **Location:** `docs/spec/mvp-client-principal-001.md:19-22`; `docs/runbooks/client-session-activation.md:41-49`; `origin/main:apps/api/src/server.ts:212-217`
- **Finding:** Current `composeServer` calls `migrate` before dependencies and `buildApp`. A session/catalog flag combination missing its verifier or resolver can therefore apply migrations before “fail startup,” which weakens the requested no-side-effect startup gate.
- **Concrete fix:** Add a pure configuration/capability preflight before `migrateDb`, and repeat the invariant at application composition. Tests must assert the migration callback is not called for every invalid session/catalog/dependency matrix, not merely that `listen` is skipped.

### I-10 — The no-side-effect requirement contradicts catalog's required outbox behavior

- **Location:** `docs/spec/mvp-client-principal-001.md:76-79`; `docs/contracts/client-session-principal.md:115-122`; catalog `docs/contracts/client-catalog.md:79-103`
- **Finding:** CPS-012 says owner-scoped catalog access creates no outbox, while the next sentence and catalog contract require catalog request creation to write a `catalog.show` outbox fact. The acceptance count silently omits outbox, so a conforming catalog implementation would violate the literal principal requirement.
- **Concrete fix:** Split the rule: session issue/resolve/revoke create zero catalog or business facts; an authenticated catalog POST may create only the catalog contract's request plus `catalog.show` outbox fact, while GET and failed authorization create none. Add explicit expected outbox deltas to CPS-AC-05 and CPS-AC-08.

### I-11 — Exact issuance HTTP grammar omits media-type and framing rules

- **Location:** `docs/contracts/client-session-principal.md:30-42`; `docs/spec/mvp-client-principal-001.md:29-35`
- **Finding:** The exact JSON object and size are frozen, but accepted `Content-Type`, charset, malformed UTF-8, duplicate JSON keys, trailing bytes, `Content-Length`/`Transfer-Encoding` conflicts, and compressed bodies are not. Different proxy/Fastify parsing paths can therefore accept different proof bytes or enforce the 8-KiB cap after decompression inconsistently.
- **Concrete fix:** Freeze `application/json` with UTF-8 only, reject duplicate `identityProof` keys and trailing JSON, define the cap on decoded/uncompressed bytes, reject unsupported content encodings, and require the ingress proxy to reject ambiguous framing. Test raw requests through the same proxy/protocol configuration used for activation evidence.

### I-12 — Lost-success retry behavior is not an explicit client contract

- **Location:** `docs/contracts/client-session-principal.md:44-57`; `docs/spec/mvp-client-principal-001.md:42-47`
- **Finding:** If the transaction commits and the `201` response is lost, retrying the same proof correctly returns `401` and the bearer is unrecoverable. The documents do not tell the client how to recover without weakening replay safety, so consumers may implement unsafe automatic retries or treat a valid proof as permanently broken.
- **Concrete fix:** State that issuance is intentionally non-idempotent, clients must never automatically replay the same proof after an ambiguous response, and recovery requires obtaining a newly issued proof with a distinct replay identity. Add the ambiguous-commit case to the client contract and Security evidence.

## Minor

### M-01 — “Control character” is not an executable Unicode rule

- **Location:** `docs/contracts/client-session-principal.md:40-42`; `docs/spec/mvp-client-principal-001.md:29-32`
- **Finding:** The documents do not say whether “control” means ASCII C0/C1, Unicode general category `Cc`, line/paragraph separators, or a particular regex implementation.
- **Concrete fix:** Freeze exact rejected code-point ranges/categories and test NUL, CR/LF, DEL, C1, U+2028/U+2029, lone surrogates, and malformed UTF-8.

### M-02 — Session digest field name implies an identifier rather than a secret-derived hash

- **Location:** `docs/contracts/client-session-principal.md:80-88`
- **Finding:** `sessionIdHash` can be mistaken for a hash of a public session UUID rather than the bearer digest, encouraging accidental serialization or logging by future consumers.
- **Concrete fix:** Rename it to `tokenDigest` or omit it from `ClientPrincipal` unless a concrete downstream authorization/audit consumer requires it; keep it forbidden from telemetry either way.

### M-03 — “Status: final” overstates an architecture with unresolved Important findings

- **Location:** `docs/superpowers/architecture/architecture-mvp-client-principal-001/ARCHITECTURE-SPINE.md:1-10`; `docs/spec/mvp-client-principal-001-progress.md:8-10`
- **Finding:** The spine says `status: final` while the progress ledger requires independent review and implementation is blocked, making the metadata easy to misread as approved.
- **Concrete fix:** Use `status: review-required` (or the repository's equivalent) until all Important findings are resolved; retain the separate `activation: BLOCKED` statement.

## Editorial lens result

No additional structure or prose defect rises above the security/interface findings. Preserve the current separation between canonical spec, frozen HTTP contract, architecture invariants, implementation plan, traceability, and activation runbook. After resolving the findings, remove repeated normative wording only where every requirement ID still points to one authoritative contract; do not shorten the explicit `BLOCKED` warnings.
