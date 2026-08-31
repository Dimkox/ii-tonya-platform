# Release B3 traceability

| Requirement                                                                     | Evidence                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Fixed-point official FX × 1.10; stress 60% evidence only                        | `selarti-cost-calculator.test.ts`                                                                |
| Immutable policy, snapshots, reservations, facts and 0035→0036 preservation     | `hybrid-message-gateway-b3-migration-upgrade.test.ts`, migration 0036                            |
| Real security-admin approval flow and canonical SQL/application hash bytes      | `admin-approval-repository.test.ts`, `hybrid-message-gateway-b3.test.ts`                         |
| Authoritative settled cash revenue, free client, atomic reserve/outbox rollback | `hybrid-message-gateway-b3.test.ts`                                                              |
| Concurrent per-user and multi-user global warning/soft/hard admission           | `hybrid-message-gateway-b3.test.ts`                                                              |
| Unknown/release/reconcile/overrun and poison/idempotency                        | `hybrid-message-gateway-b3.test.ts`, `PostgresSelartiBudgetRepository`                           |
| Default-off/incomplete config and bounded metrics                               | `hybrid-message-env.test.ts`, `selarti-budget-metrics.test.ts`, `hybrid-message-gateway.test.ts` |

Provider activation, B2 official response fixture approval and live delivery remain outside B3.
