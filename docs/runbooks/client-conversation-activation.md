# Client Conversation Activation Gate

Status: **NO-GO / BLOCKED**. This document is evidence metadata, not activation, deployment, or
provider authorization.

## Current safe posture

- All conversation, tool, Selarti, LLM, booking, and provider flags are false by contract.
- Production composition has no authenticated conversation inbound implementation or live Selarti
  client; only a test-support fixture is permitted.
- No mapping/grant provisioner, provider contract, credential owner, live tenant, measured rate limit,
  delivery identity, or reconciliation endpoint is approved.
- No code, migration, test, Claw/PG, provider/network, Actions, push, merge, deployment,
  production, Claw-host, or Obsidian mutation occurred in this docs task.

## Required approvals and evidence

| Gate | Owner | Required evidence | Current result |
| --- | --- | --- | --- |
| Public/tool contract | Product | named approval of fixed acknowledgements, catalog and protected booking behavior | absent; blocked |
| Inbound contract | Provider/Security | immutable official Selarti snapshot/checksum, authenticated fixture vectors, replay/freshness, tenant/user/thread/event/message mapping | absent; blocked |
| Mapping/grant provisioner | Identity/Booking/Security | dual-controlled identity plus exact grants, shared lifecycle lock order, AES-GCM key lifecycle, revocation/erasure races and cross-tenant/thread tests | absent; blocked |
| Principal | Platform/Booking/Security | fresh active-user lookup, runtime-authenticated claims, in-transaction grant/fence recheck, channel-vs-HTTP authority separation and hostile JS rejection | docs only; blocked |
| Catalog/booking | Catalog/Booking | merged protected services; unchanged catalog/protected-choice advisory prelocks before lifecycle rows; owner/replay/deadlock/race evidence, flags and rollback | booking worktree implemented but not merged here; blocked |
| Runtime readiness | Platform/Operations | worker-first rollout; exact-build `dispatch_v1`/`cleanup_v1` leases, continuous API readiness, heartbeat/cleanup-lag alerts and withdrawal drill | docs only; blocked |
| Privacy/Legal | Privacy/Legal | approved bases/retention, raw-content prohibition, export/erasure and 35-day backup receipt | absent; blocked |
| AI behavior | Product/Safety/Security | incident regressions, prior-release distribution diff, named human spot-check for the mandatory tool-schema change | absent; blocked |
| Interface/security review | Independent reviewer | zero unresolved Critical/Important findings with file/line evidence | docs approved: 0/0/0; implementation/live still blocked |
| Focused gate | Verification | one immutable `client-conversation` Claw invocation, exact clean SHA, external PG 17.5, counts/cleanup, `repeat_limit: 1` | not run; blocked |
| Provider delivery | Provider/Operations | stable authenticated delivery identity, measured limits, timeout/idempotency/reconciliation and unknown-outcome drill | absent; blocked |
| Deployment | Deployment owner | separate target authorization, immutable artifact, telemetry and rollback evidence | absent; blocked |

## Implementation and verification sequence

1. Merge/review the protected booking slice, rebase this contract, inspect the actual journal and
   allocate one migration at the next actual prefix for tenant-bound mappings, exact grants and
   durable operations. The number is not reserved in advance.
2. Obtain Product approval of fixed inbound/tool behavior and Security approval of the application
   channel-authority seam before implementation completion.
3. Implement with focused/property/concurrency TDD and repeat diagnostics as needed without
   invoking the Claw/PG release gate. Freeze each tool operation before downstream mutation; prove
   hostile crypto/SQL shapes and both lifecycle/mutation commit orders.
4. Obtain independent interface/security review and close every Critical/Important finding.
5. Run one total immutable `run-claw-ci.sh client-conversation` release-evidence invocation for the
   reviewed clean SHA/identity with approved external PostgreSQL. Assert 17.5 without logging its
   URL. Pass ends the gate. Failure is preserved and blocks this story; any successor requires a
   new SHA, delta review, verification identity and explicit authorization.
6. Separately approve the live Selarti contract, mapping provisioner, crypto key custody,
   privacy/legal and AI evidence. Start compatible dispatch/cleanup workers first; expose API only
   after both exact-build 30-second leases are fresh. Alert at 20-second heartbeat age or any cleanup
   lag, withdraw readiness on loss, and treat ciphertext past deadline as a security incident.
   Keep providers and outbound billing disabled until their own gates pass.
7. Obtain separate target deployment authorization. Nothing above implies it.

## Rollback and recovery

Set `CLIENT_CONVERSATION_TOOL_DISPATCH_ENABLED=false` first to stop new operation claims while
retaining frozen rows for approved recovery and safety/handoff handling. Then set
`CLIENT_CONVERSATION_ENABLED=false` to remove inbound routing. Do not enable provider delivery.
Keep PostgreSQL authoritative; reconcile frozen operations through their exact downstream server
identities and fencing tokens. Disabling dispatch never disables expiry cleanup; keep `cleanup_v1`
leased until all ciphertext is terminalized. Never delete mappings, grants, operations, inbox, ledger, catalog
requests, booking receipts, reservations, audits, or outbox rows as rollback. Erasure/retention
cleanup is the only approved deletion path. Restore only from
an immutable reviewed configuration with fresh Product, Security, Privacy/Legal, provider, and
deployment decisions. No command in this runbook grants production authority.
