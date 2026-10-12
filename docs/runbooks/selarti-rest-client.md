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

Authentication token acquisition/refresh remains the trusted caller's responsibility.
Before activation, implement a durable polling bridge binding internal request,
dialogue and tenant to provider task/chat/thread/message. Preserve consent/cost
admission, response deadlines, copy/URL checks and internal requestId/threadId
validation. Existing disabled startup guards remain in force. No live generation,
provider configuration, runtime composition or database change is part of this client.
