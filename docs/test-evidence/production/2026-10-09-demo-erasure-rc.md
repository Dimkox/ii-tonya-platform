# Demo catalogue and erasure status RC

Published native and web: `aae05c06fdc76e74ccbd77de233d3dd7dc74efcb`.
Previous: `b658b5c15c6992b7596569ab2311ed4a9971d2a6`.
Remote branch: `rc/client-consent-factory`. Normal pre-push gate passed.

## Verified

- Node24 / pnpm11.9.0 environment check passed.
- Clean exact-commit native build and archived-source web build passed.
- Packaged API/worker imports under `--jitless` passed.
- Both Cosign signatures and all uploaded bundle/SBOM/provenance checksums passed.
- Additive0041 applied with 3s lock / 30s statement / 90s process limits.
  Migration journal42 and validated composite request/job-subject FK confirmed.
- API, worker and nginx active; worker heartbeat fresh; all readiness checks true.
- Public DNS/TLS SOURCE_SHA returned exact RC at2026-10-09T09:52:07Z.
- Browser attempt2 reached six public/account/legal pages and asserted six clearly
  fictional cards, no booking links/buttons and no mobile horizontal overflow.
- Anonymous erasure-request/export reads return401; unknown receipt returns403.

## Limits and failed attempts

Creation remains off (`CLIENT_ERASURE_REQUESTS_ENABLED=false`); privacy remains on.
No production erasure request was seeded. Physical erasure worker is uncomposed.
No authentic Telegram login, authenticated export or deletion completion claimed.

Deployment attempt1 failed before connecting to PostgreSQL. Shell sourcing split
the unquoted DATABASE_URL at `&`. Native `process.loadEnvFile` fixed the cause;
read-only preflight confirmed no schema/runtime change before attempt2. Reviewer
Hegel found no blocker in the corrected premigration resume. Attempt2 succeeded.

Browser run1 failed with a cleanup race masking its primary error. Run2 failed
because the probe expected400/404 for an unknown receipt; the actual403 matches
the route contract and was independently confirmed using curl. Run3 encountered
local Chrome `net::ERR_NETWORK_CHANGED`. No fully green browser run is claimed.
Logs and script remain under `/tmp/ii-tonya-erasure-release.dFzbz1/`.

## Recovery

Previous native/web artifacts and root-owned runtime backups remain on the host.
Creation is disabled, and no requests were accepted during this rollout. Retain
the additive schema; never use a down-migration or destructive database restore.
Prefer status-capable native RC with creation disabled and prior web if needed.
After any acceptance, prior b658b5c native is not compatible with receipt reads.
The one-shot deployment script cannot resume after successful migration without
a separate state-aware procedure. No live recovery drill is claimed.

Signed local artifacts remain in
`.native-release/client-web-aae05c06fdc76e74ccbd77de233d3dd7dc74efcb/`.
Factory/Trust CI was excluded by the owner; these are not hosted CI attestations.
