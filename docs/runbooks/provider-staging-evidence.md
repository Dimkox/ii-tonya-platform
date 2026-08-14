# Provider-connected staging evidence

Project-owned authenticated sessions: unavailable

Local fixtures, injected transports, container health, and local smoke are not provider-connected evidence and cannot change this record.

The `ii_tonya_sandbox` payment runtime is another local/test fixture. Its settlement or refund evidence cannot satisfy provider authentication, official contract, ingress, rate-limit, or unknown-outcome evidence in this record.

| Provider             | Official contract/version                | Account ID hash | Sanitized fixture checksum | Ingress auth | Idempotency                 | Pre-send failure | Post-send unknown reconciliation | Rate limit   | Reviewer     | Date         | Evidence URI                         |
| -------------------- | ---------------------------------------- | --------------- | -------------------------- | ------------ | --------------------------- | ---------------- | -------------------------------- | ------------ | ------------ | ------------ | ------------------------------------ |
| Selarti              | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| Planerka             | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| Telegram             | not executed                             | not executed    | not executed               | not executed | not executed                | not executed     | not executed                     | not executed | not assigned | not executed | unavailable                          |
| YooKassa by YooMoney | merchant contract/test shop not recorded | not recorded    | local fixtures only        | not executed | local durable boundary only | not executed     | not executed                     | not executed | not assigned | not executed | `docs/runbooks/yookassa-provider.md` |

Provider staging status: BLOCKED

YooKassa code and direct Claw gates do not change this status: Claw is a constrained
development/test container simulating the native server, not a merchant-connected
staging environment. GitHub Actions are not used. All shipped credentials remain empty
placeholders and `YOOKASSA_ENABLED=false`; production deployment and activation are
deferred during hoster maintenance.
