# MVP-CLIENT-CONVERSATION-001 Traceability

Status: locally implemented, tested, and independently reviewed at `685947c44e18c6e9e21b3021d427857d68605deb`; not activated, deployed, or provider-bound. This docs-only synchronization is on top of that reviewed SHA.

| Requirement | Implementation                                                                | Verification / evidence                                                                                           | Release, telemetry, recovery                        |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| CCV-001/014 | API/worker local preflight, runtime leases, expiry cleanup                    | default/invalid local matrix; exact-build lease loss/readiness/freeze; fenced expiry receipt                      | Platform/Privacy; all flags false                   |
| CCV-002/003 | ordered-header capability, v1 opaque token/payload parsers                    | duplicate/fold/proxy/HTTP2 denial; exact cross-tenant/thread/event/message/payload vectors                        | Security/Identity; fixture only                     |
| CCV-004/005 | tenant-bound identity, private runtime claim, shared lifecycle/mutation locks | hostile JS claims plus real-PG revoke/deactivate/erase commit-order races                                         | Identity/Booking/Security; no scope laundering      |
| CCV-006/015 | byte edge, freshness, four fixture rate buckets, fixed HTTP/telemetry         | raw framing/UTF-8/time/rate/state matrix and forbidden sentinel scan                                              | API/Observability; live distributed limiter blocked |
| CCV-007/008 | inbox/message lock plus atomic encrypted operation freeze                     | same/different payload, concurrent different proposals, one accounting/operation winner                           | DB/Conversation; no pre-freeze mutation             |
| CCV-009/012 | dedicated fenced operation job, AES-GCM envelope and reconciliation           | crypto swaps/rotation; four crash seams; lease/fence/retry/unknown/dead-letter; registry/dormant topics unchanged | Worker/Operations/Security; no new outbox topic     |
| CCV-010     | runtime claim plus transactional catalog gateway                              | exact read-grant/fence locks, owner filters, replay, zero direct repository call                                  | Catalog; existing request/outbox                    |
| CCV-011     | runtime claim plus transactional protected-booking gateway                    | exact write-grant/fence locks and `ch1`; foreign/expired/race/error matrix                                        | Booking/Security; reserve kill switch               |
| CCV-013     | deterministic proposal fixture and mandatory AI evidence                      | old/new tool schema incident regression, distribution diff, named spot-check                                      | Product/Safety/Security before completion           |
| CCV-014     | shared-lock erasure and terminal ciphertext cleanup                           | commit-order races; `privacy_expired`, stale-fence denial, one case/receipt, anonymization blocker                | Privacy/Legal; live activation blocked              |
| CCV-016/017 | local preflights, runtime leases and one next-actual migration                | cross-process readiness; journal allocation; hostile SQL truth-table/parity proof                                 | Platform/DB; no reserved prefix                     |
| CCV-018/019 | development tests, closure review, immutable release gate/runbook             | repeated pre-gate diagnostics; one reviewed identity invocation, exact SHA/PG/counts/cleanup                      | Verification/Deployment; failure preserved          |

## Upstream and downstream links

| Link                                           | Contract                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP-FR-001 / AC-001                            | channel identity mapping and duplicate inbound requirements                                                                                          |
| MVP-FR-006 / MVP-FR-016                        | message idempotency and retry/dead-letter boundary; tool job remains separate from integration outbox                                                |
| `MVP-CLIENT-PRINCIPAL-001` at base `dad7e3a`   | fresh internal client principal and fail-closed capability pattern                                                                                   |
| `MVP-CLIENT-CATALOG-001` at base `dad7e3a`     | owner-scoped typed request and local `catalog.show` worker authority                                                                                 |
| `MVP-CLIENT-BOOKING-001` worktree at `e5efdb2` | implemented protected `ch1` choice, server idempotency, exact advisory/row locks, migration 0031 and provider-disabled boundary; still unmerged here |
| `docs/contracts/client-conversation.md`        | exact inbound, binding, replay, tools, privacy, rate, and unknown-delivery contract                                                                  |
| Task 6 local evidence                          | privacy race entrypoint, sanitized telemetry, deterministic AI blocker, immutable gate structure                                                     | locally tested and independently reviewed 0 Critical/0 Important; external release evidence and human signoffs blocked; gate NOT RUN |

No current CI, Claw, provider, staging, production, or deployment result is evidence for this
slice. Implementation is locally complete; activation and release remain `BLOCKED`.
