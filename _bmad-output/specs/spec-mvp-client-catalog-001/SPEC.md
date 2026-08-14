---
id: SPEC-mvp-client-catalog-001
companions:
  - ../../../../docs/spec/mvp-client-catalog-001.md
  - ../../../../docs/contracts/client-catalog.md
  - ../../../../docs/superpowers/architecture/architecture-mvp-client-catalog-001/ARCHITECTURE-SPINE.md
sources: []
---

# MVP Client Catalog Request

## Why

Clients need a safe way to obtain a useful catalog without binding the API to unverified
provider sessions or exposing private expert and contact data. A durable snapshot makes
the catalog repeatable, auditable, bounded, and recoverable.

## Capabilities

- **CAP-1**
  - **intent:** An authenticated active client can submit normalized catalog filters and
    retrieve only their own pending or immutable ready snapshot.
  - **success:** Equal normalized requests replay one request for that user; foreign and
    missing requests are indistinguishable; ready responses meet the public bounded shape.
- **CAP-2**
  - **intent:** A worker materializes a deterministic catalog snapshot from public local
    facts and only approved fresh availability.
  - **success:** The first snapshot wins, contains at most 20 cards and three slots each,
    and emits catalog-only empty slots when availability capability is absent.
- **CAP-3**
  - **intent:** Operators can retain only the minimum catalog data required for 24 hours
    and honor subject export and deletion.
  - **success:** Retention cleanup and erasure remove request and snapshot data without
    ledger or provider side effects.

## Constraints

- `CLIENT_CATALOG_ENABLED` and `WORKER_OUTBOX_DELIVERY_ENABLED` default false and jointly
  gate registration; implementation waits for the worker-outbox prerequisite.
- Client authority is injected and fail-closed; Selarti and Planerka remain unbound.
- No raw/provider/contact/private identifier, raw payload, or ledger debit crosses this slice.

## Non-goals

- Live client authentication, booking, payments, or dynamic refresh of a ready snapshot.

## Success signal

A real PostgreSQL proof shows an owner receives one bounded immutable snapshot from a
replayed request while a foreign principal sees only `404`, and no provider or ledger fact
is created.

## Assumptions

- An approved future issuer can prove the requested `active` client principal claim.
