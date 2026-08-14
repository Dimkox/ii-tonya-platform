# MVP Client Catalog 001 Design

Status: approved design input for a future implementation only. The frozen requirements,
wire contract, and invariants are respectively in
`docs/spec/mvp-client-catalog-001.md`, `docs/contracts/client-catalog.md`, and
`docs/superpowers/architecture/architecture-mvp-client-catalog-001/ARCHITECTURE-SPINE.md`.

Selected approach: a durable request/snapshot read model. It is chosen over synchronous
catalog assembly because it isolates the request path from provider availability and
preserves a repeatable response. It is chosen over adding fields to the conversation
payload because the already-emitted `catalog.show` shape must remain compatible.

The design is default-off, uses no live integration, and becomes implementable only after
the generic worker outbox registry is merged. The blocker list is deliberate: no client
session issuer/resolver, no authenticated Selarti contract, and no authenticated Planerka
availability contract exist in this repository.
