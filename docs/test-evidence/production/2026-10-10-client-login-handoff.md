# Published client login handoff

Web source: `e25865194c2a3527884cad94f50208cccda501bd`.
Native source, unchanged: `aae05c06fdc76e74ccbd77de233d3dd7dc74efcb`.
Previous web: `bf99509a28c0afaa0ca06fe9e88e4333218a156c`.
URL: https://ii-tonya.ru/account.

## Authority and verification limits

After the explicit question about deploying only the login fix without missing
application CI and Database Gate, the owner answered “Все делай”. This exception
is limited to this web release; DB, payments, native services and provider flags
remain unchanged. The exception was recorded before deployment on
https://github.com/Dimkox/ii-tonya-platform/pull/99#issuecomment-6098810862.
Missing external checks remain UNVERIFIED. GitGuardian, local checks and release
signatures are not Trust CI. Getzilla is not installed; its consumer plan ran.

## Evidence

- Normal pre-push gate passed for the source commit in the prior turn.
- Narrow independent source review by James: no blocking findings.
- Local Chrome regression final run passed1/1; logical budget3/3 exhausted.
- Exact Git archive built with offline frozen pnpm dependencies; SBOM and
  source/archive provenance produced. No mutable working-tree build was shipped.
- Cosign3.0.6 downloaded from its pinned release and checked against published
  checksums. Artifact manifest signed and verified with the existing release key;
  offline local-key verification intentionally excludes transparency-log evidence.
- Mill independently reviewed the atomic web-only switch/recovery script.
- Remote checksums passed, SOURCE_SHA matched, native link stayed unchanged,
  services stayed active, and readiness JSON reported every check true.
- Live Chrome final run exited0: actual published account/controller and anonymous
  session endpoint; explicit click targets the expected client bot; no automatic
  navigation, application writes or JS errors. Telegram navigation was intercepted,
  so this does not prove Telegram authentication or successful Mini App launch.
- Initial live assertions passed but profile cleanup failed ENOTEMPTY. That failed
  log remains; bounded cleanup retries were added and final invocation2 passed.

Ops and logs: `/tmp/ii-tonya-login-release.XqpGw0/`.
Artifacts: `.native-release/client-web-e25865194c2a3527884cad94f50208cccda501bd/`.

## Recovery and remaining work

Under `/opt/ii-tonya-platform/.release-operation.lock`, atomically restore only
web-current to `web-releases/bf99509a28c0afaa0ca06fe9e88e4333218a156c`, then verify
served SOURCE_SHA and readiness. Previous release retained; no rollback drill claimed.
Upload staging removed after checksum/identity confirmation; recoverable from the
signed local package. Owned browser profiles removed; no customer data was created.

Read-only Telegram checks previously confirmed the bot identity, account Web App
menu, configured webhook and zero pending updates. Direct production-host Telegram
probe failed; Claw probe succeeded. Neither substitutes for genuine user acceptance.
Booking reads are enabled in runtime, reserve is disabled, public catalogue empty.
Anonymous bookingAvailable=false is identity-dependent, not a global feature flag.
Real login, real offers/availability, booking, provider integrations and payment
acceptance remain incomplete. Demo data must not become a real paid offer.
