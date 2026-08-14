---
id: SPEC-mvp-client-conversation-001
companions:
  - ../../../docs/contracts/client-conversation.md
  - ../../../docs/spec/mvp-client-conversation-001.md
  - ../../../docs/superpowers/architecture/architecture-mvp-client-conversation-001/ARCHITECTURE-SPINE.md
sources:
  - ../../../docs/spec/normalized-requirements.md
  - ../../../docs/contracts/client-session-principal.md
  - ../../../docs/contracts/client-catalog-session-amendment.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for downstream implementation and verification.

# Authenticated Client Conversation and Typed Tools

## Why

The current Selarti edge can pass an external chat identifier as an internal `userId`, so an authenticated provider event can bypass canonical client-principal resolution. This mandate closes that authority gap before client conversation tooling can use the merged catalog and protected booking slices.

## Capabilities

- **CAP-1**
  - **intent:** The system can authenticate a bounded inbound fixture and resolve its opaque Selarti tenant/user/thread identity to a fresh active internal client principal.
  - **success:** No raw inbound field can supply an internal UUID, and an unbound, inactive, erased, malformed, or unavailable binding reaches neither conversation nor tool code.
- **CAP-2**
  - **intent:** The system can durably admit one authenticated client message and freeze one typed operation before any downstream mutation.
  - **success:** Same event and payload produces one inbox/message/accounting/operation result; changed payload conflicts, and every crash point resumes the frozen operation without a second inference or effect.
- **CAP-3**
  - **intent:** A validated `show_catalog` proposal can request the authenticated client's catalog through the catalog application service.
  - **success:** The service receives only the fresh principal and bounded filters and creates or replays one owner-scoped catalog request.
- **CAP-4**
  - **intent:** A validated `start_booking` proposal can reserve an authenticated client's protected catalog choice under a fresh exact channel booking-write grant.
  - **success:** Conversation identity or catalog scope cannot book; only a runtime-authenticated operation claim whose booking-write grant is locked/rechecked in the reservation transaction and exact `ch1` handle reach booking mutation.
- **CAP-5**
  - **intent:** Operators can keep conversation, tools, AI, and providers independently fail-closed and review activation evidence.
  - **success:** Defaults create no live route, provider client, tool dispatch, or worker delivery; invalid matrices fail before migrations/listen, and activation remains NO-GO without named approvals.

## Constraints

- `CLIENT_CONVERSATION_ENABLED=false`, `CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED=false`, `SELARTI_ENABLED=false`, `LLM_ENABLED=false`, and `SELARTI_OUTBOUND_BILLING_MODE=disabled` are required defaults.
- The only executable inbound source in this slice is an injected authenticated test fixture/capability. No accepted production implementation, live provider contract, credential, endpoint, or network call exists.
- Ordered raw header occurrences and the fixture-v1 authenticated capability are the only inbound evidence; normalized header maps, unproven proxy/HTTP2 paths and other key versions are denied.
- `provider_subject_mappings` plus exact tenant token is identity only. A private runtime claim is necessary but insufficient: after the implemented catalog/protected-choice advisory prelock, the transaction locks and freshly rechecks binding, exact grant and fence before remaining downstream locks. Lifecycle paths begin at user and never wait on a tool prelock. `channel_identities`, structural principals, display names, usernames, request UUIDs, and raw external identifiers are never authority.
- Conversation and AI code only freeze encrypted typed operations. A dedicated non-outbox fenced runner may call exact catalog or booking gateways; it has no financial/provider authority.
- Raw conversation content is not persisted or logged. Existing retention remains unapproved for live data.
- One reviewed migration is required for tenant-bound mappings, grants and durable operation state; its prefix is only the next actual journal entry after merged booking and is not reserved here.
- One total immutable focused Claw/PostgreSQL 17.5 invocation is allowed after review; a pass ends the gate and a failure blocks without a rerun.

## Non-goals

- Live Selarti, Planerka, Telegram, LLM, payment, or production activation.
- Creating or mutating provider-subject bindings or tool grants from inbound traffic.
- New message pricing, billing, catalog, booking, financial, provider-delivery, safety, or AI behavior.
- Accepting `expertId` as a booking tool argument, direct identifiers as authority, or adding provider topics to the worker registry.

## Success signal

At an exact clean implementation SHA, an authenticated seeded fixture resolves through a fresh active binding, three identical deliveries create one accounting fact and one typed catalog or protected-booking effect, every confused-deputy and payload-conflict case fails closed, the worker performs zero provider attempts, and the single focused gate records zero unresolved Critical/Important findings.
