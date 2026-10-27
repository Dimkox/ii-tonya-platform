# Selarti native REST client

`SelartiRestClient` accepts a server-supplied bearer token and optional fetch
implementation. It sends user messages through `sendExternal` and reads bound
message pages through `getMessages`. The origin is fixed to HTTPS selarti.com.
Every request has a total 15-second deadline and a 64 KiB response limit.

Provider contract provenance: the [Selarti public collection](https://docs.selarti.com/api/collections/38595362/2sAXqwZL69?segregateAuth=true&versionTag=latest),
inspected 2026-10-12, documents external-send thread acceptance and message reads.
See [the recorded contract inspection](../operations/2026-10-12-selarti-composition-gap.md).
The 4096-character text bound, 64 KiB total response byte bound (including ignored
metadata), and maximum offset 10000 are application limits, not claimed provider
limits. A future bridge may reduce the read limit to fit a page within the byte
bound; a read failure or oversized page never authorizes resending a POST after
an unknown send outcome.

`accepted` means only that the returned thread matches task/company/chat.
It is not an AI response. `unknown` must be reconciled without resending.
Only local invalid input or an injected transport's `before_write` failure yields
`not_applied`; the caller owns any bounded retry policy. HTTP errors, including
429, do not prove non-application. Reads never retry and reject the entire page
if any row is malformed or foreign. Message type/status are uninterpreted values;
pages make no ordering, exhaustion, or request-response correlation guarantee.

## Authenticated ownership-bound acquisition

`createAuthenticatedSelartiClient({apiKey, companyId, taskId, aiId, fetch?})`
captures validated configuration before its first await and obtains a fresh bearer
on every call. It POSTs `auth` with `{key}`, requires a successful response with
a valid token and `response.user.active_company` matching the configured company,
then uses that bearer for GET `get_task?company_id&task_id` and GET
`get_ai?company_id&ai_id`. Each result must contain exactly one row with the exact
requested ID and company. The task's uppercase `AI` must match the configured AI;
lowercase `ai` cannot establish the binding.

Binding verification is a point-in-time snapshot, not a lease. Reacquire before
each bounded dispatch batch and after any provider configuration change. The
ownership GETs and a later send are not atomic: provider configuration can change
between them, so a ready client cannot guarantee that the provider retains the
same binding when it processes a message. There is no inferred token TTL.

IDs must be well-formed strings of 1–256 characters, nonblank and without control
characters. The API key must be 1–4096 characters without whitespace or control
characters. IDs are preserved exactly and encoded in query parameters. Invalid
configuration makes no network request. Acquisition uses the same fixed HTTPS
origin, default verified TLS and redirect rejection, one total 15-second deadline
across all three requests, and a 64 KiB byte bound per response. Streamed bytes,
stalled headers/bodies and late bodies are bounded or cancelled; JSON must be valid
UTF-8. An injected fetch implementation must preserve verified TLS.

The result is either `{kind: 'ready', client}` or `{kind: 'unavailable', code}`.
Safe codes are `invalid_input` (configuration), `authentication_failed` (invalid
auth envelope), `binding_unverified` (ownership or task/AI mismatch), and
`acquisition_failed` (transport, deadline or response resource/decoding failure).
No raw diagnostics, provider bodies, credentials or identifiers are logged or
returned on failure. The ready client exposes only `sendExternal({chatId, text})`
and `getMessages({threadId, limit, offset})`; the token and underlying REST client
remain private. Caller-supplied task/company extras cannot override the verified
binding. These methods delegate to the real `SelartiRestClient`, preserving its
response validation and outcome semantics.

Tokens are neither persisted nor cached; `expires` is not interpreted. A ready
client keeps its acquired token for its lifetime. A timeout, 401 or 5xx on a send
remains `unknown`; acquisition and sends never retry automatically. A later fresh
factory call does not authorize replaying a prior ambiguous send.

A ready result proves authenticated binding only. It does not establish a
subscription, billing status, answer causality or delivery. The recorded
2026-10-13 non-generation provider probe found that the configured task's `AI`
did not match the configured AI, so that configuration must remain unavailable.
This factory does not modify provider configuration or activate a runtime.

Before activation, implement a durable polling bridge binding internal request,
dialogue and tenant to provider task/chat/thread/message. Preserve consent/cost
admission, response deadlines, copy/URL checks and internal requestId/threadId
validation. Ordinary worker composition and polling integration remain unfinished.
Existing disabled startup guards remain in force. No live generation, provider
configuration, runtime composition or database change is part of this client.
