# YooKassa provider traceability

Status: implementation boundary present; merchant activation **BLOCKED**.

This matrix records the YooKassa Merchant API increment without treating code, fixtures,
or direct Claw gates as provider-connected evidence. YooKassa is a YooMoney merchant
product; the personal YooMoney Wallet API and T-Bank are outside this integration.

| Requirement | Boundary / verification target                                       | Operations or recovery record    | Approval state             |
| ----------- | -------------------------------------------------------------------- | -------------------------------- | -------------------------- |
| YKP-001     | fixed-origin client (`packages/integrations/src/yookassa/client.ts`) | runbook origin check             | blocked pending review     |
| YKP-002     | client authentication and redaction boundary                         | credential incident procedure    | credentials absent         |
| YKP-003     | operation repository and migration `0023`                            | unknown-outcome reconciliation   | no merchant evidence       |
| YKP-004     | adapter/verifier integer-RUB validation                              | mismatch hold and investigation  | no merchant evidence       |
| YKP-005     | redirect checkout adapter                                            | checkout remains feature-off     | disabled                   |
| YKP-006     | authoritative verifier                                               | PostgreSQL inbox delivery        | no merchant evidence       |
| YKP-007     | default-off webhook seam                                             | nginx peer-trust review          | not configured             |
| YKP-008     | unknown-outcome classification                                       | reconcile before retry           | no merchant evidence       |
| YKP-009     | refund adapter boundary                                              | canonical reversal path          | disabled                   |
| YKP-010     | typed fiscal configuration                                           | legal/fiscal approval            | blocked                    |
| YKP-011     | `YOOKASSA_ENABLED=false` defaults                                    | fail-closed startup              | active default             |
| YKP-012     | bounded safe metrics/logging                                         | secret/redaction review          | pending independent review |
| YKP-013     | explicit test/live mode validation                                   | test-shop evidence               | test shop absent           |
| YKP-014     | preserved durable mappings                                           | operator rollback/reconciliation | activation blocked         |
| YKP-015     | consent-bound receipt contact                                        | purpose/policy evidence          | inputs empty; blocked      |
| YKP-016     | encrypted exact-body unbound recovery                                | bounded replay policy            | inputs empty; blocked      |

Direct Claw CI and Database Gate are the repository’s executable gates; GitHub Actions
are not used. Claw’s container simulates the server for development/testing and cannot
substitute for merchant test-shop, legal/fiscal, ingress, reconciliation, or approval
evidence. See [the operator runbook](../runbooks/yookassa-provider.md),
[provider staging record](../runbooks/provider-staging-evidence.md), and
[go-live gates](../runbooks/go-live-evidence.md).
