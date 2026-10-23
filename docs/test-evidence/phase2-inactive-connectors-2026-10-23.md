# Phase2 inactive VK/MAX connector preparation

Primary contracts checked on2026-10-23 by the coordinator; facts were supplied in
`spec-phase2-preparation.md` and its explicit contract refinement. This work used
public documentation/schema reads only. No provider endpoint, account, API token,
subscription or message was accessed. No credentials, SDK or dependencies were added.

## Prepared local code

`integrations/vk-community` and `integrations/max-business` contain typed inactive
ports, immutable metadata, always-disabled adapters, pure text-request builders and
strict minimal response parsers. No HTTP sender, webhook identity decoder, live
activation flag, financial import or TLS/trust-store change exists.

Disabled entrypoints reject synchronously requested activation and reject every
send/webhook with fixed provider-specific errors before reading any command/body/
header properties. They never invoke the pure builders or parsers. Proxy, fetch and
console spies verify zero property reads, zero network calls and zero raw logs.

Pure builders return frozen request **data only**. A descriptor contains the supplied
caller-owned token and must never be logged or persisted; fixtures use synthetic
strings only. Signed int64 input IDs remain canonical decimal strings and are
validated with BigInt, without Number rounding. Text ceilings use UTF-16 code units,
a conservative local bound that cannot exceed the documented character ceilings.
Unsafe or extraneous inputs fail with bounded errors.

Response parsers accept already-decoded bounded objects, not HTTP streams. They
produce only `untrusted_ack`, bounded provider-error classification or
`unsupported_response`; they confer no account ownership, authenticated ingress or
durable delivery. Unsafe numeric int64 values are rejected rather than rounded.
No provider retry, settlement, balance, coupon or referral behavior is implemented.
Future activation still needs a reviewed transport/ingress/privacy/replay design.

## Official primary facts and sources

VK uses fixed `https://api.vk.com/method/messages.send`, version5.199 and a
URL-encoded POST body containing `access_token`, `v`, `peer_id`, `random_id` and
`message`; group/community token, text≤9000. The parser supports only the documented
single-integer response variant. The `user_ids` response array remains unsupported;
no peer identity is inferred from the returned integer. Provider-error prose is
never returned or logged.

- [Official VK PHP client](https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiClient.php)
- [Official VK PHP request implementation](https://raw.githubusercontent.com/VKCOM/vk-php-sdk/master/src/VK/Client/VKApiRequest.php)
- [Official messages method schema](https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/messages/methods.json)
- [Official messages response schema](https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/messages/responses.json)

MAX uses fixed `https://platform-api2.max.ru/messages`, POST JSON text≤4000,
`Authorization` header and exactly one `user_id`/`chat_id` **query** parameter. No
query token or old host is emitted. The documented response contains `message` with
required `recipient`, `body` and `timestamp`; body requires `mid` and int64 `seq`.
Recipient requires `chat_type`; nullable/missing user/chat IDs remain absent in the
normalized untrusted data. Unknown/error envelopes remain unsupported because no
unverified error-field layout is invented. The checked official schema is0.0.33;
this is documentation metadata, not an operational API-version parameter.

- [Official POST messages documentation](https://dev.max.ru/docs-api/methods/POST/messages)
- [Official preparation page linking the schema](https://dev.max.ru/docs/chatbots/bots-coding/prepare)
- [Official MAX schema](https://raw.githubusercontent.com/max-messenger/api-schema/main/schema.yaml)

Incoming event authentication/confirmation and provider-to-platform identity
mapping remain explicitly unimplemented. No callback secret/header convention is
invented from third-party examples.

## Verification

- VK disabled adapter: RED3fail/1pass, GREEN4/4.
- MAX disabled adapter: RED3fail/1pass, GREEN4/4.
- VK text contract: initial builder RED13/13, final request/parser GREEN23/23.
- MAX text contract: RED16fail/10pass, GREEN26/26.
- Integrations typecheck, scoped ESLint, Prettier and `git diff --check`: PASS.
- Logs: `/tmp/phase2-{vk,max}-disabled-{red,green}.log`,
  `/tmp/phase2-{vk,max}-contract-{red,green}.log` and
  `/tmp/phase2-connectors-pure-{format,lint,types}.log`.

Integrations normal package build (ESM+DTS) PASS; log
`/tmp/phase2-inactive-connectors-final-build.log`. Independent connector review accepted the substantive boundaries; a stale MAX
module comment was corrected to distinguish pure helpers from absent live transport
and inbound identity verification. No unchanged unit rerun followed that comment fix. No PostgreSQL, full/multi-path suite or unchanged legacy suite ran for
this connector preparation. No live operation or release acceptance is claimed.
