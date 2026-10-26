# Core stabilization guard registration

Contract: `docs/superpowers/implementation-artifacts/spec-residency-core-stabilization.md`.
SQL0058 adds only `hashtags_db` and private `expert_card_draft_tags`, plus informational
`hashtags_taxonomy` and `resident_workspace_access` views. It extends existing private
draft input/proposal fields, request operations and durable verification work attempts.
The public four-field card contract, financial facts and main activation gates stay intact.

The complete59-migration chain was replayed on the existing task-owned PostgreSQL17.5
cluster. A fresh empty introspection directory produced the supported0058 snapshot,
normalized with database constraint/index definitions. The additive catalogue records
2functions,1trigger,2views,13constraints and4indexes, including modified old-table checks
and the idempotent ACCESS_ACTIVATED audit index. The new snapshot is a state projection,
not permission to generate migration SQL. Existing historical gaps remain unchanged.

Exact artifact hashes are pinned for SQL, supported snapshot, SQL-object catalogue,
journal, integration barrel/package manifest and the two Python executables. New allowed
relations/flags are individual names. Adjacent taxonomy relations, tag-selection relations
and workspace flags remain rejected, with negative probes. The schema count advances
174→176; unquoted hand-SQL function/trigger/view inventories advance only by these objects.

`EXPERT_DRAFT_TAGS_ENABLED=false` and `RESIDENT_WORKSPACE_NOTIFICATIONS_ENABLED=false`
are independent defaults. UI settings require the matching capability ceiling. Delivery
requires original promo identity and configured transport, uses a single durable attempt,
and quarantines ambiguity. A transport cannot grant admission or link an arbitrary user.

The Python helper receives bytes only through stdin and returns bounded JSON. Its source
and uv-locked runtime graph ship as explicit integration-package assets. Node-only native
releases and the256MiB production worker do not include/prove an isolated Python runtime;
parsing stays unavailable/manual there. A separately reviewed runtime and trusted bounded
file reader are required before deployment or provider activation, neither authorized here.

## Unknown workspace notification recovery

An unknown outcome is terminal for automated notification attempts, including a
crash after preparation and before transport. Do not reset it to pending or blindly
resend. The operator can direct the actual owner to `/work_handoff` in the original
promo bot. That existing command rechecks current private identity, original
consent and paid interview admission, then issues a fresh owner-bound ten-minute
work-bot link through the genuine user request. It cannot grant main access.
Notification preparation preserves prior valid interactive links; explicit
owner-request issuance retains its existing replacement semantics.
