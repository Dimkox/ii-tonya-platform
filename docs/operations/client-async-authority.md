# Client asynchronous authority

Deployed bounded RC on 2026-10-06:425e647a6e8a577095df2d9a89f28660d5a781ef,
native/web and remote RC matching. [Live release evidence](../test-evidence/production/2026-10-06-client-async-authority-rc.md)
records successful readback and retained rollback. Feature activation is unchanged;
publication is not completion of the full product or external release gates.

CT-012 candidate, disabled by default. Independent static closure preceded the latest
focused PG pass; external release gates remain open. The implementation contract and exact verification ledger are in
[the spec](../superpowers/implementation-artifacts/spec-client-async-authority.md).

Current review state: `in-progress`, locally tested but not release-ready. Final immutable
financial nonapplication now terminalizes reconciliation instead of scheduling a
retry; the retryable transport nonapplication contract is unchanged. Client-only
production runtime recovery belongs to its configured filtered runner, including
when the separate worker-outbox registry is disabled. These corrections have focused
non-PG consumer evidence only (synthetic DB/repository boundaries).

The original convoy and all six post-claim contention scenarios passed the latest
focused PostgreSQL run after the fixture collision correction. Both claims exclude
cleanup-busy IDs; actual admission bounds document/subject waits to 10 ms and
row/authority waits to 1000 ms without removing post-wait freshness checks. Lock-busy
admission rolls back, then releases only the exact provably unstarted claim and its
claim-only attempt increment. If the source row is also locked, scoped expiry
recovery restores it later. Started/uncertain work is never reset by that branch.
No provider fact, usage, refund or reservation change follows temporary contention;
the runner reports deferral as no-op. Keep capabilities off pending the review gates.

Main's separate one-run owner exception (logical outbox run6) exited0, **34/34**
at15:00:26 UTC, duration23.69s. This closes the six setup-blocked scenarios from
run5 (28/34), whose failure log is retained. Distinct synthetic update IDs corrected
the fixture; production idempotency and behavioral assertions were not weakened.
Original convoy, backlog-limit recovery, preservation of started uncertainty and
financial/residual scenarios passed. All authorized outbox runs are consumed.
The latest log is `owner-exception-3-final.log` in the existing ignored task directory.
Independent static closure and this focused pass do not certify the full product,
external Trust CI or live providers. Publication subsequently occurred as documented
above, without signing-provider or personal free-text activation. Signing remains
excluded from ordinary launch prerequisites.

An admitted operation carries `consentAuthority` in existing outbox JSONB: version 1,
the canonical subject UUID, and original decision UUID / decimal revision pairs.
Messaging requires `client_messaging`; Selarti and its derived reply retain both
`client_messaging` and `selarti_ai_processing`. Regrant creates new authority and
never upgrades historical work. Document hashes identify consent documents, not messages.

The evidence query lives in `consent-current.ts` alongside the existing tie-fail-closed
journal oracle. A matching projection alone is insufficient. Approved effective document
version, policy, presentation, basis, active subject, dialogue and channel ownership
are also required. Canonical `client-messaging-vN` and its existing `messaging-vN`
alias are accepted only for the same approved document version; Selarti uses
`selarti-ai-vN`. Currently only unscoped `{}` evidence is supported. Nonempty scope,
including expiry-bearing or unknown fields, denies; adding a real scope/expiry binding
is a prerequisite for any capability that needs it.

Operations resolve the candidate subject without row locks, take the document-table
share lock before the canonical subject advisory lock, then read authority under
READ COMMITTED and lock their source. Withdrawal uses the same canonical subject
barrier and post-wait reads. No network call runs inside these transactions.

Claiming an outbox row provides no send authority. `recordAttemptStarted` validates
the exact lease owner, token, attempt and reconciliation key, then commits one durable
start with a digest of the complete internal payload. The returned receipt must match
the runner's message. The dispatcher consumes it once against the persisted start,
recording `dispatch_consumed` in the existing append-only attempt journal before HTTP.
Only the provider's explicit request fields cross the transport boundary; the stamp
and receipt do not.

The committed start is the linearization boundary. Withdrawal winning first blocks
start. A start winning first remains potentially irreversible, even when a crash
occurs before HTTP. A consumed receipt cannot authorize a second send. An expired
lease or uncertain network outcome retains reconciliation/accounting evidence;
neither a content rejection nor consent withdrawal proves provider nonapplication.
PostgreSQL and external HTTP are not atomic.

Claim paths remove invalid work in bounded batches only when no durable start exists.
They retain the ordered Telegram barrier, so newly authorized sequences can advance
past terminalized stale work. Processing or uncertain work is not silently refunded,
released or replayed. Operators must not reset it to pending to work around consent.

Responses resolve the durable request before proposal locks, use the same subject
barrier, verify original authority and durable start evidence, and check database time
after waiting. Rejected/late content creates neither a proposal body nor a reply.
Already recorded duplicates/conflicts retain their result after payload redaction
without recreating effects. Rejected trial content leaves unknown reservations reserved;
the existing authoritative-outcome reconciliation contract remains separate.

Production worker factory composition now registers this path when complete trusted
dependencies are supplied and the existing flags permit it. Missing Telegram transport,
bot identity, consent fencing, or required Selarti request-mapping capability fails
readiness. The baseline had no Selarti outbox dispatcher, so the new wrapper accepts an
explicit trusted request transport; it does not invent a provider endpoint or mapping.
Default production dependencies do not supply that capability. Existing flags and
configuration defaults are unchanged, and no provider has been activated.

Recovery: keep capabilities off, retain attempt and accounting evidence, and inspect
the fixed `client_authority_invalid` reason without logging payloads or identifiers.
Do not stamp old payloads with new grants. Deploy/rollback decisions belong to main
after independent review; an older binary can bypass this application fence. Mandatory
immutable stamps against arbitrary SQL/old binaries require a separately reviewed
migration and coordinated writer rollout. This candidate supplies no such DB constraint,
special-category signature admission, provider attestation, or release certification.
