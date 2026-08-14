# MVP-CLIENT-CONVERSATION-001 Design

Status: approved command-derived design for implementation planning; live activation NO-GO.

The smallest safe slice keeps the existing hexagonal boundary and replaces the Selarti route's
direct `external_chat_id -> userId` handoff with an ordered-raw-header authenticated fixture plus a
fresh tenant/subject mapping lookup. Fixture version 1 uses exact HMAC domains over the tenant,
external user and thread; event/message identities include the same tuple. Inbound cannot create
bindings or grants, and plaintext `channel_identities` is not authority.

After fresh identity resolution, the existing inbox/completion lock atomically records accounting
and one encrypted typed operation before any tool mutation. A dedicated non-outbox fenced job
privately mints one runtime-authenticated claim. The matching transaction preserves the implemented
catalog-request/protected-choice advisory prelock, then locks user, mapping, exact grant and
operation fence before remaining downstream locks. Lifecycle paths begin at user and never wait on
a tool prelock, preventing the inverse edge. Catalog and booking remain state owners. Unknown outcomes
replay the frozen call through downstream server idempotency; nondeterministic inference never runs
after freeze.

Operation encryption is AES-256-GCM envelope v1 with unique 96-bit nonce, exact metadata AAD and an
injected active/decrypt-only/retired/compromised key provider. Expiry is a fenced terminal
`privacy_expired` transaction that invalidates claims, clears all crypto fields and creates one
sanitized case/receipt. Separate worker jobs publish exact-build dispatch/cleanup leases in
PostgreSQL; API readiness and each tool freeze require both, so process-local preflight does not
pretend to prove another deployment is running.

All relevant flags default false. The production Selarti adapter remains disabled, no fixture can
be imported into runtime, and the operation job adds no outbox/provider topic. One migration is
required for tenant/version binding columns, exact grants, constrained encrypted leased operations,
runtime leases, expiry cases and cleanup;
its number is only the next actual after booking merges. Fixture key rotation, live provider limits,
broader message-event anonymization and delivery remain explicit activation blockers.

Alternatives rejected: accepting an inbound/internal UUID preserves the confused-deputy defect;
using `channel_identities` loses tenant/thread binding; structurally casting conversation identity
launders booking scope; a grant read outside the mutation transaction races revocation; synchronous
tool calls permit reinference after crash; generic outbox topics expand provider-style registry
authority. The dedicated operation table freezes intent without duplicating catalog/booking state.
