# Early bird first-send alternatives

Status: investigation only; no provider, production or credential access. The accepted owner requirement remains that deletion of a receipt contact cancels a send that has not actually started. Existing Node-to-PostgreSQL locking does not prove that property after a database connection is lost; it must remain disabled until a transport and its failure behavior are demonstrated.

## Telegram native payment

[YooKassa's Telegram instructions](https://yookassa.ru/docs/support/payments/onboarding/integration/cms-module/telegram) document Telegram `sendInvoice`, `need_email`, `send_email_to_provider`, a fiscal `provider_data` receipt, a separate payment provider token obtained via BotFather and handling pre-checkout and successful-payment updates. YooKassa says this integration does not support holds. This could avoid sending an already stored receipt contact from our application, but it does not establish that our chosen digital product is eligible for RUB payment: [Telegram's digital goods and services policy](https://core.telegram.org/bots/payments-stars) requires XTR for digital services in Telegram. Expert online profile placement appears to be a digital service; no authority has established an exception. Further, [Telegram's Bot API](https://core.telegram.org/bots/api#precheckoutquery) allows order information including email to arrive in pre-checkout and successful payment updates, so avoiding persistence and logs would require explicit controls. Do not enable RUB native invoices on this evidence.

## YooKassa invoice API

[Official invoice receipt documentation](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/invoices/receipts) says to obtain the recipient's email or phone before creating the invoice and to provide receipt data in the invoice request for the relevant YooKassa receipt configurations. A self-delivered invoice URL is not evidence that YooKassa itself collects the contact. The separate fiscalization scenario requires a configured third-party cash register and its own receipt after payment; no such configuration or privacy-safe contact path has been demonstrated.

## Remaining requirements

The compliant merchant configuration, trusted payer contact collection and disclosure cancellation, fresh-provider verification, durable operation binding, idempotent atomic settlement, refunds and production release gates remain necessary. No third-party endpoint, credentials or database extension was modified.

## Disposable PostgreSQL-native HTTP probe — 2026-10-29

A local throwaway image based on `postgres:17.5-bookworm` (server runtime asserted `17.5`) compiled `pgsql-http` at upstream commit `ee52345b5929f63a3871685f85974f34b5fa8508`. Package holds prevented the build from upgrading the PostgreSQL server/client packages. The synthetic HTTP listener and database used no customer information, provider credentials or provider endpoints. The image digest was `sha256:0efb22790c6f78f6ea54487fceb2d5fc08b3ff14212d7a1e6a512846acb36bc0`; the final local probe source is `/tmp/ii-early-http-poc/probe.cjs` (SHA-256 `768e3b10019c8e45c48b4cc5654012e19ac20805fcaa9d4d7619af2dd7af3b9f`). This source is a throwaway probe, not production code.

The sender used one PostgreSQL function to lock a synthetic contact, pause, and synchronously call `http_post`; deletion used a separate connection. Server-side completion at the local HTTP listener was the observable evidence of a request, not a proof of exact first-byte timing. Three bounded probe invocations established:

- Explicit `pg_terminate_backend` before HTTP invocation released the row lock, allowed deletion and produced zero stub requests.
- With the PostgreSQL default `client_connection_check_interval=0`, destroying the sender's client TCP connection while deletion was already blocked on the lock did **not** stop the backend from starting its HTTP request; the stub received one request before deletion completed.
- With `client_connection_check_interval=10ms`, the same orderly local socket-close scenario produced zero stub requests, but a live sender still sent one request while an already-requested deletion waited for its lock. The interval setting is periodic and [PostgreSQL documents](https://www.postgresql.org/docs/17/runtime-config-connection.html) that detection depends on kernel reporting and network keepalive behavior; this is not a guarantee under arbitrary network partitions or close immediately before send.
- Signalling `pg_cancel_backend` while the backend was demonstrably in `pg_sleep` caused that one attempt to abort before HTTP and allowed deletion. The test does not establish that an asynchronous cancellation signal wins a race with the actual HTTP invocation.
- When the stub had already observed the request and held its response, deletion waited for the backend until the backend was terminated. A normal synthetic request without deletion returned HTTP 200.

These observations **do not establish strict cancellation** when deletion is requested before actual send. In particular, a lock simply delays deletion while the sender proceeds. Neither this local proof-of-concept nor periodic connection checking or an asynchronous cancel signal authorizes production activation, installation of a database extension there, disclosure of contacts, or moving provider credentials into PostgreSQL. A separate security/architecture design and tests covering its exact cancellation linearization and recovery remain necessary.
