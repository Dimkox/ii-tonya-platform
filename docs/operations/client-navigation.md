# Client Telegram navigation

This increment provides public catalog, account and privacy links. It does not
admit personal dialogue or grant any consent. The full consent factory and the
legacy free-text path remain incomplete and disabled in production.

## Configuration and activation

`CLIENT_TELEGRAM_NAVIGATION_ENABLED=false` is the default. To enable the reviewed
increment, main supplies these existing server-side settings securely:

- `TELEGRAM_BOT_TOKEN`: the verified client bot token, never a browser setting.
  Its positive safe numeric prefix is the stable bot ID. Rotation of the token's
  secret or the route key must keep the same receipt namespace for that bot.
- `TELEGRAM_WEBHOOK_SECRET`: non-placeholder, 32–256 URL-safe characters.
- `CLIENT_TELEGRAM_BOT_KEY`: non-placeholder route credential; generate a fresh
  high-entropy value within the existing 64-character constraint.
- `CLIENT_WEB_ORIGIN`: one exact HTTPS origin, without trailing slash, credentials,
  path, query or fragment. No URL comes from an update or query string.

Navigation alone needs no login, balance, consent, session capability or provider
delivery worker. `CLIENT_WEB_ORIGIN` can supply navigation links with sessions off.
When sessions are enabled, preserve the existing cabinet bot-username and verifier
requirements described in [client-web-account.md](client-web-account.md).

Navigation is mutually exclusive with client content ingress, hybrid routing,
test-expert promo/deterministic/residual/reconciliation, Selarti cost admission and
response ingress, B2 Telegram dispatch and worker outbox delivery. Environment
loading, default lifecycle preflight/dependencies and `buildApp` fail closed.
`buildApp` additionally requires the actual navigation gateway, replay reader and
matching stable bot ID, route key and webhook secret. Dependencies are never
silently replaced by an enabled stub. Existing expert/payment routes are unchanged.

Main owns exact-SHA aggregate checks, independent review, release and activation:

1. Complete those gates and install matching API/web and Nginx artifacts. Run
   `pnpm test:edge:native` on the verification host (also required by
   `pnpm verify:deploy`; native prerequisites below). Run
   `nginx -t` on the target before reload. Keep the origin, cabinet and bot identity
   consistent. Do not enable sensitive, processor, AI, booking, payment or erasure
   capabilities as a consequence of navigation activation.
2. Securely generate/install the missing webhook secret and route key, with no
   values in shell history, process arguments, evidence, logs or source control.
   Set only `CLIENT_TELEGRAM_NAVIGATION_ENABLED=true` for this increment.
3. Register the token-selected client's real webhook at
   `<origin>/v1/webhooks/telegram/client/<route-key>` with the configured secret
   token. This must not use the separate expert promo bot configuration. Use the
   approved exact `allowed_updates` list: `["message", "edited_message",
"channel_post", "edited_channel_post", "callback_query"]`, with
   `drop_pending_updates=false` and `max_connections=2`. Unsupported envelopes
   remain terminally receipted and ignored; subscribing does not enable processing.
4. Read `getWebhookInfo` back through a secret-safe operator tool: compare the full
   URL in memory, then record only configured/matches-expected booleans, pending
   count, enabled flags and release SHA. Require sorted exact `allowed_updates`
   equality with that list and `max_connections=2`; record only match booleans.
   Raw URL/error prose may contain secrets
   and must not be copied into evidence. Confirm the existing Mini App menu still
   targets `/account`. Local test replies do not prove a real Telegram delivery.

No external operation in that sequence was performed by the navigation writer.
The earlier spec's bot/webhook inventory is context, not fresh live readback.

## Request and response boundary

On the existing authenticated client POST route, `onRequest` checks the secret
header and route key before JSON parsing or DB access. Existing rate limits and
the 65,536-byte body limit remain. Structurally invalid, negative, fractional,
boolean, string and unsafe-number update IDs are rejected; AJV does not coerce
them into an integer. Client-route errors return only fixed codes; parser,
validation and service error objects/stacks are never logged or echoed here.
The installed Fastify JSON parser already has fixed invalid-JSON errors: this
change does not claim to have repaired a reproduced parser-content leak. Global
404/error prose and logger child-binding hardening are separate CT-015 work.

For every authenticated valid update ID, the gateway first atomically inserts a
terminal `webhook_inbox` receipt. Only first deliveries inspect message content.
Supported commands are exactly `/start`, `/help`, `/catalog`, `/privacy` and
`/account`, without arguments, suffixes, whitespace normalization or case folding.
Every supported command includes the same fixed warning against sending personal
history, health information, documents or other people's data before any input.
Other direct private text, captions, voice and files receive fixed refusal and
navigation. Groups/channels, edits, forwarded messages, bot senders, anonymous or
mismatched identities and unsupported update envelopes are receipted without a
reply. They never reach legacy promo, consent, identity, hashing, OCR or AI work.

Every reply has `method=sendMessage`, an ephemeral in-memory numeric `chat_id`,
fixed Russian text and an inline keyboard: catalog/privacy ordinary HTTPS URLs
and the account `web_app` button at `<origin>/account`. Telegram can then supply
Mini App initData while widget login remains off. No `parse_mode`, user-controlled
link, outbox entry, queued destination or consent mutation is introduced.

The response uses Telegram's documented
[webhook-response method](https://core.telegram.org/bots/api#making-requests-when-getting-updates).
Telegram returns no result for this method, so HTTP handoff does not prove message
delivery. A duplicate never resends, even after a lost response. The user can issue
a new command to request navigation again. No text claims Telegram erased input.

## Receipt lifecycle and replay

The only persisted event key is `client-navigation-v1:<botId>:<updateId>` with
provider `telegram`, status `complete`, UUID claim ID, null lease and standard
receipt ID/timestamps. No message, digest, route, chat/user ID, body-derived data,
token or route credential is persisted. Other webhook namespaces are unaffected.
Transactions set `lock_timeout=1s` and `statement_timeout=2s`; these are per-statement
limits, not a whole-request deadline. Failed/unknown persistence yields fixed 503
and no reply. A lost commit acknowledgement can cause a later duplicate, never a
resend or personal-content replay.

Receipts have no wall-clock TTL. They remain while that bot identity can deliver
updates. Server-composed legacy ingress must have a valid token-derived bot ID and
the same replay reader. The route checks before promo or Hybrid; Hybrid checks
before parsing/hashing; direct Hybrid persistence checks before hash validation or
identity work when configured with that identity. Errors cannot fall through.
This fence is not consent readiness for the legacy route. Before any future mode
switch, stop and drain all old instances; do not overlap navigation and legacy
deployments. Legacy activation needs its separate authority/async gates.

Receipt deletion has one executable end event: explicitly retire the bot identity,
remove its webhook, revoke its webhook credentials and bot token, disable all
ingress/polling for that identity, and stop/drain its processes. Record retirement
evidence and prohibit reactivation of the retired ID. Only then may an explicitly
authorized operator run the following against that retired identity (example ID
is synthetic; inspect the count first). No such deletion was performed here.

```sql
-- psql: set retired_bot_id to the independently verified retired numeric ID.
\set retired_bot_id 123456
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '2s';
SELECT count(*) FROM webhook_inbox
WHERE provider = 'telegram'
  AND split_part(external_event_id, ':', 1) = 'client-navigation-v1'
  AND split_part(external_event_id, ':', 2) = :'retired_bot_id';
DELETE FROM webhook_inbox
WHERE provider = 'telegram'
  AND split_part(external_event_id, ':', 1) = 'client-navigation-v1'
  AND split_part(external_event_id, ':', 2) = :'retired_bot_id';
COMMIT;
```

Rollback: disable navigation and keep content ingress/promo/delivery disabled;
remove webhook registration if required by the release procedure. Preserve all
receipts, Nginx no-spooling limits and replay fences. Do not roll back into an older
build with enabled legacy ingress that lacks the fence. No automatic replay or
receipt purge is a recovery mechanism.

For a **navigation-only deployment with sessions already off**, a flag-only
rollback is invalid: leaving `CLIENT_WEB_ORIGIN` with navigation off makes
`loadEnv` reject `client_web_configuration_incomplete`. The supported rollback
state is:

```dotenv
CLIENT_TELEGRAM_NAVIGATION_ENABLED=false
CLIENT_SESSION_ENABLED=false
CLIENT_TELEGRAM_WIDGET_LOGIN_ENABLED=false
```

Remove `CLIENT_WEB_ORIGIN` and `CLIENT_TELEGRAM_LOGIN_BOT_USERNAME` entirely from
that deployment's environment (do not set empty strings). Keep all existing
content ingress, hybrid, promo, provider and delivery flags false, as before the
rollback. Keep bot identity credentials and durable receipts; do not enable
sessions to make rollback load. Validate the resulting environment before restart.
For an existing **sessions-enabled deployment**, preserve `CLIENT_SESSION_ENABLED=true`,
origin, login username and verifier configuration; disable only navigation and
leave the private-area guards intact. This patch changes no production session
setting. Navigation links alone do not make private account functions available.

## Edge and verification scope

The client-webhook Nginx location limits bodies to 64 KiB, buffers at least 128 KiB
in memory, explicitly disables body-file mode and proxy request buffering, and
uses HTTP/1.1 upstream. Existing TLS, browser/session 8-KiB limits and content-free
logging are preserved. No request target, headers or body enters the site logs.

`pnpm test:edge:native` is the repeatable native runner, also invoked by
`pnpm verify:deploy`. It runs both `tests/container/client-navigation-edge.test.mjs`
and the existing `tests/container/client-web-edge-privacy.test.mjs`. The
verification host must provide `/usr/sbin/nginx`, or set `NGINX_BIN` to its native
Nginx executable. A missing binary or failed proof fails verification; there is
no silent skip. This is distinct from the unchanged `pnpm test:container` image
runner. Unrelated unit tests do not require Nginx.

`tests/repo/client-navigation-edge.test.ts` checks configuration text and executes
the deployment script's shell wiring with intercepted test commands to prove
invocation and failure propagation without a host binary. The native runner starts Nginx
on loopback using the actual location/logging config with fixture-only TLS/path
substitutions. It proves 64-KiB Content-Length/chunked forwarding, >64-KiB rejection,
streaming before request completion, an observed empty temp directory with zero
file-creation events, and canary-free logs including backend failure. It is local
transport evidence, not evidence of deployed TLS or target Nginx settings.

Focused results and remaining release gates are recorded in
[the spec](../superpowers/implementation-artifacts/spec-client-navigation.md).
Client landing copy now describes catalog/account/navigation, marks packages as
planned and purchase unavailable, and preserves expert/legal sections, pricing
amounts and terms. Client CTAs go directly to `/account`; expert promo links retain
their separate existing configuration. This is not completion of CT-007 or the
full consent factory.
