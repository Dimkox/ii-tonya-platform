# MVP-CLIENT-BOOKING-001 Traceability

Status: specified and planned; not implemented, tested, activated, deployed, or provider-bound.

| Requirement | Future implementation | Verification / evidence | Release, telemetry and recovery |
| --- | --- | --- | --- |
| CBK-001/002 | config preflight, booking principal resolver, route composition | full flag/dependency/scope/raw-header matrix before repository access | Platform/Security; both flags false |
| CBK-003/004 | catalog v2 payload, secure handle generator, protected choice repository | v1 byte compatibility, v2 first-write mapping, owner-only no-ID snapshot | Catalog/DB; delete choices with snapshot |
| CBK-005/006 | byte-exact route parser, client booking service, protected receipt | raw framing/media/duplicate-key tests; missing/foreign equality; ten-way replay and bounded collision counts | API/Booking; no-store and fixed errors |
| CBK-007 | BookingService and PostgresBookingRepository protected reserve extension | real-PG reservation/receipt/audit/outbox atomicity and zero split commit | DB; existing capped serialization retry |
| CBK-008/009 | owner-handle cancel and public state projector | reserved/booked cancel, client/expert cancelled identical replay, foreign/missing `404`, other terminal `409` | Booking; retain owner cancel during rollback |
| CBK-010/011 | choice coordination plus existing booking locks, database clock, configured buffer | topology survey; both-order reserve/cleanup and transition race tests; 24h/15m/72h/60m boundary table | DB/Operations; no global reorder; expiry worker remains active |
| CBK-012 | existing audit/outbox path, disabled adapters | exact topic/count/hash facts; four booking topics absent from export/registry/claim/reconcile; zero provider adapter/attempt | Provider owners; flags remain false |
| CBK-013/014 | fenced durable two-phase erasure, export/redaction, fixed metrics/cache/time | lease/crash/partial/dead-letter races; retained handles; exact label keys/enums, no-store and UTC grammar | Privacy/Observability; no handle labels |
| CBK-015 | migration journal at implementation start | exact merged principal SHA and next actual journal entry | DB; forward-only migration |
| CBK-016 | focused TDD, independent review, immutable Claw/PostgreSQL 16.0.15 (`160015`) adapter | no successful suite repeat; exact SHA/version/counts/cleanup/repeat limit | Verification; failed gate terminal |
| CBK-017/018 | reserve kill switch, runbook and approval ledger | rollback drill; named Product/Security/deployment decisions | Operations; new reserve off before route off |

## Upstream and downstream links

| Link | Contract |
| --- | --- |
| MVP-FR-008 / AC-007–010 | owner, lead, freshness, capacity, deadline and replay reserve rules |
| MVP-FR-010 / AC-013 | owner-only client cancel and single capacity release |
| MVP-FR-016 / AC-015 / AC-022 | transactional outbox, provider failure isolation and audit |
| `MVP-CLIENT-CATALOG-001` at `3db7ad1` | merged public snapshot, owner, retention and worker compatibility authority |
| `MVP-CLIENT-PRINCIPAL-001` at `94ad64c` | approved future session boundary; catalog read does not grant booking write |
| `docs/contracts/client-catalog-booking-amendment.md` | protected choice and v2 compatibility only |
| `docs/contracts/client-booking.md` | reserve/cancel HTTP, payload, state and error authority |

No current CI, Claw, provider, staging, production, or deployment result is evidence for this
slice. The current implementation and activation results are both `BLOCKED`.
