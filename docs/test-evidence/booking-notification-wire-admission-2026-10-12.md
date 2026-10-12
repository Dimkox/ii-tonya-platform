# Booking wire admission — final local evidence

Uncommitted candidate based on690797db64fd80aa1aeccea8003543de470d8c16.
No release SHA, provider activation, production migration or deployment.

## Execution

tests/integration/booking-notification-wire-admission.test.ts:

- Run1: collection failure,0tests; no behavioral proof.
- Run2:14/14behavioral RED before implementation.
- Independent source reviews by McClintock and Hubble found late429 throttle loss,
  conflicting late outcome blocking completion, and a historical rollback fixture
  missing explicit botcontrol. Implementer corrected all; both source closures
  accepted before the final run.
- Run3 at18:10:12UTC:37/37PASS,7.09seconds total. Budget3/3 exhausted.

Preflight RequireDocker passed. Existing isolated PostgreSQL17.5 container verified
running at192.168.112.2, synthetic credentials only. No old exhausted suites rerun.

## What the evidence proves

Exact prepared wire is generated and hashed within authoritative admission;
persisted encrypted callback pair is authenticated;9real-vault AAD tampering cases
consume no attempt. Shared botcontrol pause/throttle applies across repositories.
Late429 preserves full retry_after while leaving uncertainty/manual and no resend.
Late conflicting outcomes are durably acknowledged without blocking completion.

Combined synthetic journey uses real repository, issuer/vault, renderer and
transport with a fetch double: reserve → exact prepared request → matching receipt
→ authenticated bound ct2 transaction → synthetic provider completion → one
delivered client confirmation. HTTP bytes equal the admitted body; no confirmation
before calendar completion and no second admission afterward.

The journey calls callback and calendar repositories directly, not webhook/API or
main worker runner. Separate runtime tests cover wiring; no single live-provider
or independent browser end-to-end acceptance is claimed.

## Migration and limitations

Implementer reconstructed0045 state on17.5, checked prior45SQL hashes and0044
artifacts unchanged; independent review checked0045 journal/predecessor/manifest.
This does not prove PG16 production compatibility or backup restore.

Historical T2/T3 fixtures now explicitly provision controls; T2 latest-state check
now targets0045. Those modified historical files have NOT been rerun because their
budgets are exhausted. Their earlier GREEN results cannot prove changed fixtures.
Control-lock expiry-wait, concurrent multi-reservation batch stress and full live
journeys remain separate evidence gaps. Privacy/retention, remaining commercial
requirements, RC checks, rollback drill and human acceptance remain open.
