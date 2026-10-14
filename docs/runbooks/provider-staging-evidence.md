# Provider-connected staging evidence

Project-owned authenticated sessions: unavailable

Local fixtures, injected transports, container health, and local smoke are not provider-connected evidence and cannot change this record.

## Capability matrix

Every external capability is default-off until its test evidence passes. The matrix records
the boundary for the 2026-09-07 test release; `BLOCKED` means no provider-connected claim.

| Capability                  | Test-release boundary                                                  | Evidence required before activation                                         |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Selarti                     | default-off; local contract fixtures only                              | authenticated outbound/response contract and unknown-outcome reconciliation |
| Planerka                    | default-off; local adapter fixtures only                               | official API contract, authenticated callbacks, and reconciliation          |
| Unified client Telegram bot | default-off; bot credentials and webhook secrets stay on the test host | bot-scoped ingress, callback, replay, and delivery evidence                 |
| Expert promo Telegram bot   | default-off; separate bot scope and credentials stay on the test host  | promo hand-off, referral attribution, callback, and delivery evidence       |
| YooKassa                    | default-off; test-shop setup is incomplete                             | merchant contract, receipt/refund, webhook, and reconciliation evidence     |
| MAX Business                | default-off; no approved API contract or credential                    | approved API contract, callback verification, and delivery fixtures         |

The `ii_tonya_sandbox` payment runtime is another local/test fixture. Its settlement or refund evidence cannot satisfy provider authentication, official contract, ingress, rate-limit, or unknown-outcome evidence in this record.

| Provider                    | Official contract/version                | Account ID hash | Sanitized fixture checksum | Ingress auth | Idempotency                 | Pre-send failure | Post-send unknown reconciliation | Rate limit   | Reviewer     | Date         | Evidence URI                         |
| --------------------------- | ---------------------------------------- | --------------- | -------------------------- | ------------ | --------------------------- | ---------------- | -------------------------------- | ------------ | ------------ | ------------ | ------------------------------------ |
| Selarti                     | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| Planerka                    | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| Unified client Telegram bot | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| Expert promo Telegram bot   | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| YooKassa by YooMoney        | merchant contract/test shop not recorded | not recorded    | local fixtures only        | not executed | local durable boundary only | not executed     | not executed                     | not executed | not assigned | not executed | `docs/runbooks/yookassa-provider.md` |

Provider staging status: BLOCKED. Production activation remains excluded from this record.

YooKassa code and direct Claw gates do not change this status: Claw is a constrained
development/test container simulating the native server, not a merchant-connected
staging environment. GitHub Actions are not used. All shipped credentials remain empty
placeholders and `YOOKASSA_ENABLED=false`; production deployment and activation are
deferred during hoster maintenance.
