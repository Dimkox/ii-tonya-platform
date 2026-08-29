# Hybrid message gateway B2 traceability

| Requirement                | Implementation                                                        | Evidence                                                       |
| -------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| One ordered dialogue       | `dialogues.next_delivery_sequence`, `dialogue_deliveries`             | `hybrid-message-gateway-b2.test.ts` sequence/concurrency cases |
| Local deterministic reply  | B1 repository creates `telegram.send_text.v1` atomically              | local delivery PG case                                         |
| Untrusted Selarti proposal | provider-neutral codec/service and dedicated bearer endpoint          | codec and route tests                                          |
| Stable convergence         | `selarti_response_proposals.request_id` plus immutable payload hashes | exact/poison/late PG cases                                     |
| Ordered Telegram dispatch  | `PostgresOrderedTelegramOutboxRepository` lowest-unfinished barrier   | retry/unknown/reconciliation PG case                           |
| Sensitive retention        | bounded tombstone purge and terminal payload/proposal redaction       | retention PG case                                              |
| No client charge           | no message package/event/ledger writes in B2 paths                    | local and proposal PG assertions                               |

B3 budgets are intentionally outside this release. Provider activation remains blocked:
the repository has no approved official Selarti response fixture, and all B2 capabilities
default to false.
