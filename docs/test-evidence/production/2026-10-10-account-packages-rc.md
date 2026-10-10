# Account packages RC — published

Published API and web: `43a93e2131cde6bb09a6825fc5b83dfbf91fc600`.
Account: https://ii-tonya.ru/account.
PR: https://github.com/Dimkox/ii-tonya-platform/pull/100.

Source implementation: `78ebbc51b75b8da6906256867283ca8bf95cc2b8`.
RC base: published web `e25865194c2a3527884cad94f50208cccda501bd`.
Live native at preflight: `aae05c06fdc76e74ccbd77de233d3dd7dc74efcb`.

## Scope and authority

Owner requested RC preparation and publication after local account implementation.
The candidate contains only package readout and the already-published login change.
Paid-policy calculation, paid-order repository, migration0042 and their exports
are deliberately excluded. Existing schema0041 is sufficient.

Payments and providers remain disabled. No real charges, synthetic customer grants,
consent changes, production migration or customer-account creation are authorized.
After the explicit scoped request, the owner instructed “Делай прод”, authorizing
API/web publication without unavailable hosted CI/Database Gate and one additional
exact-candidate run of each of four package test files. Authorization was recorded
before mutation: https://github.com/Dimkox/ii-tonya-platform/pull/100#issuecomment-6100710215.
This is a new scoped exception, not reuse of the prior web-only exception.
Missing hosted checks remain UNVERIFIED. GitGuardian success is not application CI.

## Verification

Exact RC passed DB5, API8, client18 and browser1 tests on2026-10-10, one invocation
per file under the new permission. All four authorizations are consumed. PostgreSQL
was disposable Compose17.5, replayed only through0041, and was removed afterward.
No focused reruns without new permission. Original independent code review remains
applicable: implementation/test files match reviewed78ebbc5 byte-for-byte.
Production read-only preflight: both release links match above, readiness reports
postgres/migrations/workerLease/adapters true. No runtime values were printed.

Known limitation: shared PostgreSQL pool acquisition has no deadline; query/lock
timeouts start after connection acquisition. This pre-existing issue is not fixed
by the read-only account feature. Real Telegram identity acceptance is unverified.

## Release execution and recovery

- Built a clean isolated checkout of the exact source commit, offline/frozen pnpm.
  Native build records Git archive SHA256. Web built from the same clean checkout.
- Native/web checksums, SBOMs, provenance and local-key Cosign verification passed.
  No transparency-log verification is claimed. Artifacts retained at
  `.native-release/account-packages-43a93e2131cde6bb09a6825fc5b83dfbf91fc600/`.
- Fermat reviewed the locked switch/rollback script. Signal handling and HTTP
  deadlines were corrected; read-only service checks do not require sudo.
- Initial attempt failed before any switch because web-releases is root-owned.
  Old links/readiness remained intact. Corrected only new-directory creation to
  the existing sudo install owner/mode pattern. Empty first-attempt directory and
  original script were preserved, not confused with a successful deployment.
- Final attempt verified remote checksums, exact SOURCE_SHA, byte-identical
  migration directories, unchanged runtime.env digest, API process working
  directory and active services. Only API restarted; worker remained running.
- Both links now select43a93e2. Readiness reports all four checks true, /account
  returns200, and unauthenticated package GET returns401 with no private payload.
- Real Chrome loaded the published account over verified TLS: expected source,
  working login handoff, no automatic Telegram navigation, no application writes
  or JavaScript errors. Telegram navigation was intercepted; real user login and
  authenticated production balance acceptance remain unverified.

Ops scripts: `/tmp/ii-tonya-account-release.hwz92Z/`. No migration service, runtime
flag, systemd unit or database content change was made by this release. Existing
API shutdown/startup briefly refused connections before readiness succeeded.

Under `/opt/ii-tonya-platform/.release-operation.lock`, restore current to
`releases/aae05c06fdc76e74ccbd77de233d3dd7dc74efcb` and web-current to
`web-releases/e25865194c2a3527884cad94f50208cccda501bd` via temporary symlinks and
same-directory atomic renames, then restart only ii-tonya-api.service and verify
readiness and served SOURCE_SHA. Previous directories remain intact. No rollback
drill or full commercial-product acceptance is claimed.
