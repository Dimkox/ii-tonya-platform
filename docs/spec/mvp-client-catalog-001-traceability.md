# MVP-CLIENT-CATALOG-001 Traceability

Status: planned, not implemented, tested, or activated. Base:
`0bfb6efc4b2145dfc5f4ba4763fa6264f422f842`.

| Requirement | Future implementation boundary | Required verification | Release / recovery owner |
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

No GitHub Actions, live provider, production server, Claw run, image build, or deployment
evidence exists for this specification.
