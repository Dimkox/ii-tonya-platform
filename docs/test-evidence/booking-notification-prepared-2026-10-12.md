# Prepared booking message wire — local evidence

Uncommitted candidate, not production or exact-RC evidence.

Shared contract serializer tests:10 RED at17:42:53,10/10 GREEN at17:43:08UTC.
It emits canonical recipient/text/optional two-button markup; rejects additional
fields, invalid recipient IDs, oversized/malformed text. Token shape is not token
authorization. Contracts typecheck and scoped lint passed; contracts built/exported.

Prepared transport tests:7 RED at17:44:36 (missing method),7/7 GREEN at17:45:16,
then reviewed final8/8 at17:46:24. Added malformed JSON with matching digest and
exact rejection outcome assertions. New focused file used3runs; original HTTP
transport suite was not rerun. Existing send() remains available; prepared method
shares its internal response/deadline logic and supplies the original body string.

Checks cover exact bytes reaching fetch once, digest/bot/chat/version mismatch,
extra body fields, noncanonical whitespace and malformed JSON. Invalid requests
produce failed/request_invalid/pauseBot:false before any HTTP. All network calls
use test doubles. No Telegram credentials or provider calls used.

Independent McClintock source review accepted prepared implementation; requested
malformed JSON/full outcome assertions are implemented and green. Integrations and
shared-test typechecks, scoped lint and git diff --check passed before final
assertion-only additions; final scoped lint/whitespace also checked separately.

Hash validation is not DB authorization. Exact-wire transactional admission,
durable bot control, worker runner and production composition remain separate
incomplete work. Old stored digests must not be relabelled as exact-wire proof.
