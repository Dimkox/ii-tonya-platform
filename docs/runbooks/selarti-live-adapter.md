# Selarti live adapter and Telegram callback replay store

## Selarti (`apps/api/src/live-selarti-adapter.ts`)

- Outbound: uses the documented REST client (`docs/runbooks/selarti-rest-client.md`),
  fixed origin `https://selarti.com`, `POST auth` then `send_message_external`.
  A fresh authenticated client is acquired per send. No `SELARTI_BASE_URL` is added.
- Required env when `SELARTI_ENABLED=true`: `SELARTI_API_KEY`, `SELARTI_WEBHOOK_SECRET`,
  `SELARTI_COMPANY_ID`, `SELARTI_TASK_ID`, `SELARTI_AI_ID`.
- Outcomes: provider unavailable -> `not_applied` (retryable only on auth acquisition
  failure); accepted -> `applied`; any unknown/throw -> `unknown_outcome` (no blind retry).

### Assumptions (not in Selarti docs — confirm with Selarti)

- Inbound webhook signature: HMAC-SHA256 over `${timestamp}.${body}` with
  `SELARTI_WEBHOOK_SECRET`, headers `x-selarti-signature` / `x-selarti-timestamp`,
  max age 300 s, max body 64000 bytes. Payload decoded by `SelartiContractAdapter`.

## Telegram callbacks

- Secret header `X-Telegram-Bot-Api-Secret-Token` is checked in constant time by the route.
- `update_id` dedupe: existing `webhook_inbox` unique (provider, external_event_id).
- Callback query replay: `PostgresTelegramCallbackReplayRepository` stores
  sha256(callback id) in `webhook_inbox` with provider `telegram_callback`.
  Only active experts (via `channel_identities`) are accepted. No new migration.
