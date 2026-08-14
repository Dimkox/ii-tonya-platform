# MVP-CLIENT-PRINCIPAL-001 Traceability

Status: specified and planned; not implemented, tested, activated, deployed, or provider-bound.
Base: `b6763dde890f472c5ad0fcf5a5dbd4ebba2e8423`.

| Requirement | Future implementation | Verification / evidence | Release, telemetry and recovery |
| --- | --- | --- | --- |
| CPS-001 | config, pure preflight, API composition, session route registration | default false; full flag/dependency matrix proves migration/listen/registration not called | Platform; disable catalog before session |
| CPS-002 | `IdentityProofVerifier` port, hostile-result validator and production composition guard | exact-key/UUID/audience/scope/date/versioned-digest matrix; test-fake import boundary; no fallback scan | Security approval required; verifier outcome labels only |
| CPS-003 | strict raw-body issue parser and Fastify route | media/framing/UTF-8/duplicate-key/trailing-byte/exact-object/control/32–6144-byte/8-KiB matrix | API owner; normalized `400|401|503` |
| CPS-004 | CSPRNG issuer and response serializer | canonical token shape, 256-bit source, no-store, plaintext returned once | Security; revoke hashes, never recover token |
| CPS-005 | PostgreSQL issue transaction and replay receipt | sequential plus ten-way concurrent single-winner real-PG test | DB owner; inspect counts without digest output |
| CPS-005A | verifier-owned `K_replay[v]` construction and process-wide verifier gate | canonical-field/version/rotation vectors; 33rd-call saturation, 2-second timeout, abort and late-result zero-row tests | Security owns key overlap; fixed unavailable outcome only |
| CPS-006 | issue/revoke repository | min-expiry database-clock cases; concurrent conditional revoke has one `204`, all later use/revoke `401` | Security; hash-only bulk revoke procedure |
| CPS-006A | shared `users FOR UPDATE` lifecycle serialization | real-PG issue-versus-deactivation/erasure tests for both commit orders | Privacy + DB; deactivate first, then remove user-linked sessions |
| CPS-007 | raw-header occurrence guard and exact bearer parser | duplicate/mixed-case fields, proxy/HTTP2 normalization, comma/case/space/padding/suffix table | API owner; all negative outcomes `401` |
| CPS-008 | fresh resolver query joining users | expiry/revocation/scope/deactivation between-request tests; DB failure `503` | DB owner; no cache metric or credential label |
| CPS-009 | catalog app/server composition, route injection and versioned session amendment | own request success; foreign/unknown `404`; negative authority `401`; resolver outage `503`; catalog-without-session preflight failure | Catalog owner; retain both flags false |
| CPS-010 | identity schema, nullable replay link, migration and cleanup | forbidden-column scan; erasure null-link/replay/account-recreation test; proof-expiry cleanup | Privacy owner; retain non-linkable receipt until proof expiry |
| CPS-011 | logger, traces, metrics and error mapping | sentinel scan across logs/traces/metrics/errors/evidence | Observability owner; fixed operation/outcome labels |
| CPS-012 | import/scope and end-to-end boundary guards | session paths create zero business facts; catalog POST creates only request plus one `catalog.show`; zero provider/ledger/reservation/booking/payment facts | Platform; no provider reconciliation needed |
| CPS-013 | migration journal at implementation start | exact merged catalog SHA and next actual journal entry recorded | DB owner; forward-only migration recovery |
| CPS-014 | focused local/PG gate, review, exactly one Claw invocation for this slice | exact SHA, command, counts, cleanup, `repeat_limit: 1`; failure retained as terminal evidence | Verification owner; no second invocation under this slice ID |
| CPS-015 | activation runbook | all Security evidence rows plus named approval and deployment authorization | Security/deployment owners; status remains BLOCKED |
| CPS-016 | non-idempotent issuance client behavior | lost-`201` same-proof `401` plus distinct-proof recovery test | Client/API owner; never recover or replay the original bearer |

## Upstream and downstream links

| Link | Contract |
| --- | --- |
| MVP-FR-001 | channel identity maps to internal user; external/display identity is never authority |
| MVP-FR-003 / CCAT-001 / CCAT-004 | active client principal and owner-only catalog access |
| `MVP-CLIENT-CATALOG-001` at `10819c8` | rebase prerequisite; owns catalog request/read shape and immediately preceding migration |
| `docs/contracts/client-catalog-session-amendment.md` | supersedes catalog v1 only for principal resolution, `401|503` mapping and preflight composition |
| `FOLLOW-CLIENT-BOOKING-001` | later protected choice-to-booking contract with new write scope |
| `FOLLOW-SELARTI-IDENTITY-001` | later verified channel-to-internal-principal binding |

No current CI, Claw, provider, staging, production, or deployment result is evidence for this
slice. The only current activation result is `BLOCKED`.
