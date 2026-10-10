# Account packages RC — prepared, not deployed

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
User was separately asked to allow this API/web release without unavailable hosted
CI/Database Gate and one additional exact-candidate run of each of four package
test files. That request is pending; prior web-only exception does not cover API.

## Verification

Original implementation passed DB5, API8, client18 and browser1 tests, scoped
build/typecheck/lint checks and independent review. Those results are not exact-RC
test evidence. Focused budgets are exhausted; no reruns without explicit approval.
Production read-only preflight: both release links match above, readiness reports
postgres/migrations/workerLease/adapters true. No runtime values were printed.

Known limitation: shared PostgreSQL pool acquisition has no deadline; query/lock
timeouts start after connection acquisition. This pre-existing issue is not fixed
by the read-only account feature. Real Telegram identity acceptance is unverified.

## Release and rollback plan

Build only an exact committed archive with frozen dependencies. Retain checksums,
SBOM and signed provenance. Review a guarded, locked API/web switch before mutation.
Do not run the generic deploy script unchanged: it starts the migration service.
Retain previous native and web release directories. On readiness or identity
failure, restore previous links and restart API using the prior native release.
Do not change payment/provider flags, systemd configuration or database schema.
Readiness and anonymous account checks do not prove authenticated customer login.
