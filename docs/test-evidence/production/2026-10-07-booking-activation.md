# Booking composition activation evidence

Candidate `d0a34370b72e57bf56bf0a9806d31432d5931fa0`; remote RC readback matches.
This corrects the conflict between Telegram navigation and the local booking
worker. Config tests reproduced the failure then passed32/32; independent config
review accepted the correction. All content/external processor prohibitions remain.

Native/web builds completed. Packaged entrypoint imports passed without bootstrap
or provider calls. Both manifest signatures verified. No SQL delta from previous
live `b4bac0637548a7abe3e1178f442a3304423d667b`.

| Manifest              | SHA256                                                             |
| --------------------- | ------------------------------------------------------------------ |
| native-release.sha256 | `bfaf7c9781541ffff80842348f94aa4e7620b774d3aef039146f1fc38a6e69bb` |
| web-release.sha256    | `1a1d1d369a85afad65005986dbfc23535f59a2425cd157a01d1cbbdd35c739ff` |

Artifacts: ignored `.native-release/client-web-d0a34370b72e57bf56bf0a9806d31432d5931fa0/`.
Operational helpers: `/tmp/ii-tonya-booking-activation.BmIJgf/`, pinned previousb4bac06.

## Activation boundary and recovery

Enable only catalogue, booking owner read/cancel, new verified-session grants and
the topic-allowlisted local worker. Reserve creation stays false; empty catalogue
is owner-accepted. Do not enable external processing, personal-content intake,
payments or erasure. Actual Telegram login still needs authentic-user evidence.

The activation script first validates candidate config and read-only inventory,
captures a root-owned runtime backup, checks for drift, then installs/restarts.
Independent operational review found multi-unit is-active accepted either unit;
both calls were corrected to require each service separately. Feynman accepted
bounded static closure, with no remaining findings in that review scope.

Success requires API readiness plus a fresh completed-cycle worker heartbeat in
its private tmp namespace, stable MainPID and both services individually active.
A fresh empty cycle is not proof of a real catalogue request or successful booking.

After activation failure, reconcile runtime, processes, issued grants and booking
state before retry/restoration. Never use pre-activation zero counts as evidence
that a later rollback is safe. Disable creation/issuance first and retain compatible
owner reads/cancellation. Keep the matching binary and configuration backups.

## Execution status

Source rollout exited0; native and web now match the candidate. Three transient
connection-refused retries preceded readiness during restart. The temporary nginx
check unit had already unloaded at reset-failed; cleanup was subsequently checked.

Activation dry-run passed on the deployed code with grants0/services0/active
reservations0. Explicit apply exited0 with status activated; this includes the
fresh completed-cycle heartbeat, stable worker PID, API readiness and separate
service checks described above. Runtime backup is
`/etc/ii-tonya/runtime-before-booking-d0a34370b72e57bf56bf0a9806d31432d5931fa0.env`.
These inventory counts are pre-activation, not a safe-rollback assertion afterward.

Real Chrome checks against this SHA passed: catalogue/account/consent/my-data and
public home/privacy/offer pages, mobile layout, keyboard landmarks, seven no-script
routes, anonymous private401, forged proof401 and oversized proof413. Browser
errors0 and unexpected external requests0. Public catalogue remains empty.
Authentic Telegram login is NOT observed; no synthetic production user was created.
Erasure remains unavailable. This is runtime activation evidence, not full product
acceptance or proof of actual reservation creation.

No full suite, exhausted PG/browser file, factory integration or external Trust CI
claim. Full product acceptance remains open. Further recovery must preserve owner
reads/cancellation; do not run the pre-activation rollback helper blindly after new
session grants may have been issued.
