# PostgreSQL16 local migration and restore probe

Status: scoped local compatibility evidence; independent semantic review accepted.
No production access, backup or mutation. No exhausted Vitest suites rerun.

## Exact scope

Local Docker image `postgres:16-alpine`, image ID `cf78e76683b9`, reports
PostgreSQL16.15. Dedicated container `ii-tonya-pg16-compat-20261012` has network
disabled and no published ports. It contains only synthetic databases
`ii_tonya_compat` and `ii_tonya_restored`, owner `ii_tonya_compat`, with local
trust authentication. No production credentials or customer data were used.

Journal-ordered raw SQL files0000 through0046 (47 files) were piped to psql with
ON_ERROR_STOP and a single transaction. Exit0. Historical long-identifier
truncation notices and the already-absent legacy index notice were emitted.
This is raw SQL compatibility, not a Drizzle migration-journal or upgrade test.

Input manifest0046 SHA256:
`8314d248bfbb998479aedac5ce62e77192b2dcd9b91cd769e036650474f087ae`.
Migration0046 SQL SHA256:
`67898707a8d46162e06706681632900f956b0c961f480994fc98bdcd51c2997e`.

A full custom-format `pg_dump` of `ii_tonya_compat` was piped to `pg_restore
--exit-on-error --no-owner` into newly created `ii_tonya_restored`. Exit0. No
constraints or triggers were disabled to restore the dump.

Restored catalog query: server_version_num160015,116 public tables,
36 nonextension public functions,65 noninternal public triggers,2 public views.
Experts, expert_services and slots each contain0 rows. The first inspection query
used an incorrect table name `services`; corrected to `expert_services` and reran
with ON_ERROR_STOP. The erroneous query did not mutate data.

## Comparison, including failure

Both databases were dumped with `--no-owner --no-privileges`, separately for
schema-only and data-only comparison. Only random `\\restrict`/`\\unrestrict`
lines were excluded. Data-only dump comparison emits circular-FK warnings for
the two ledgers; the actual restore used the full dump, not these data-only files.

Data-only SHA256 equals on both:
`836c4d96cf90f06001052944888b19bf9700f120ed5f3b90ee0dde9c1a7e391b`.

Schema-only SHA256 differs:

- source: `2b7c04fc52e52d8e9e5b3142356e6326f90a3eab7cff6bb6127083414e8afda8`
- restored: `2b3c1de7eee0bf7cc6cd5b49054fa36db06cba7c0c1ca767ec943772e97981f8`

The comparison exited1. A full textual diff identifies nine CHECK expressions
with changed parenthesis grouping around conjunctions. These differences are
not silently normalized away. Independent reviewer Kant
`01a13163-8eda-7fe2-8c3c-583809a42700` found no semantic drift: every change is
associative AND regrouping, with all operands, operators, constants, casts and OR
boundaries preserved, including NULL behavior. Schema text remains unequal.

The nine constraints are `client_catalog_requests_filters_check`,
`dialogue_inbound_text_check`, `expert_abuse_holds_reason_bounded`,
`expert_issuance_override_quota_bounded`, `expert_order_credit_cap`,
`expert_provider_operations_replay_bundle`,
`selarti_response_proposals_text_check`, `test_expert_prompt_source_bounded`,
and `test_expert_session_scope_bounded`.

Reviewer independently compared ordered catalog metadata for766 constraints:
validation, deferrability, initially-deferred, inheritance/locality and inheritance
count match. All nine CHECKs remain validated, nondeferrable and local. The reviewer
also reproduced the matching data checksum. No constraints were rewritten or
disabled to produce these results. This accepts only the scoped local probe.

## Limits

After independent review, the dedicated container and its anonymous volumes were
removed with its exact validated name. Both synthetic databases were deleted;
they are reproducible from the recorded migration inputs. No production data or
shared PostgreSQL17.5 test container was removed.

This is not a backup of production, a nonempty financial-data restore, an upgrade
from the actual live schema, application behavior on PG16, or a deployment/rollback
drill. Production restore and exact-RC acceptance remain open. A later change to
any migration invalidates the corresponding input-specific compatibility claim.
