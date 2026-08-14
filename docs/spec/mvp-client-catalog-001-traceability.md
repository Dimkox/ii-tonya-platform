# MVP-CLIENT-CATALOG-001 Traceability

Status: implementation checkpoint under independent review; not activated. Exact main
base: `b6763dd`. Both catalog-related flags remain false by default.

| Requirement | Implementation boundary | Required verification | Release / recovery owner |
| --- | --- | --- | --- |
| CCAT-001 | client resolver, route composition | malformed/revoked/inactive/resolver-error denial before repository call | Security; retain flags false |
| CCAT-002 | Fastify strict schemas and normalizer | extra-key/type/control/8KiB matrix | API owner; reject request |
| CCAT-003 | serializable request/outbox repository | concurrent same-user replay and different-user digest isolation on PostgreSQL | DB owner; inspect durable facts |
| CCAT-004 | owner-scoped read repository | owner, foreign, unknown, expired indistinguishable 404 | Security; disable client flag |
| CCAT-005 | public catalog reader and snapshot writer | active/verified/service filter, max 20/3, deterministic ordering, 24h lead/freshness | DB owner; forward-fix source data |
| CCAT-006 | optional availability port | absent Planerka yields catalog_only and no port invocation | Integrations; retain provider disabled |
| CCAT-007 | worker registry and config schema | each flag combination; legacy/new payload union and unknown payload failure | Platform; retain both false |
| CCAT-008 | response/outbox/snapshot/log/metric boundaries | forbidden-field, zero-ledger and zero-provider-call assertions | Security; purge bounded snapshots |
| CCAT-009 | retention and privacy repositories | first-write replay, 24h cleanup, export, erasure deletion | Privacy owner; run existing erasure workflow |
| CCAT-010 | observability definitions | metric label allowlist and focused real-PostgreSQL gate | Operations; no production activation |

Implementation checkpoints are `21e2cca` (durable request/outbox), `85e7809`
(authority/application), `76b4872` (HTTP/config), and `4b88a2b` (worker/public reader).
Focused Claw evidence is 2/2 plus PostgreSQL 3/3, 21/21, 10/10 plus 33/33, Task 4
23/23, Task 5 9/9, and adversarial-remediation 11/11. The first independent review
found one Critical and seven Important issues; its closure pass found three further
Important issues. Both remediation gates pass (11/11 and 5/5), and all affected
builds pass. Final independent closure review and one new focused Claw/PostgreSQL
gate are still required. No GitHub Actions, live provider, image build, activation,
deployment, push, or merge is authorized by this checkpoint.
