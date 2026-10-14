# Expert entry activation — 2026-10-14

Status: entry configuration and bot menu active; final verification15:29UTC. Owner delegates technical activation
and requests an externally accessible product. This operation enables already
deployed authenticated entry; it does not authorize identities or money movement.

## Observed prerequisite state

Production native/web are d00d24593493cb348a25abf0eec0318a1c018ddf.
Expert session implementation passed its owner-authorized extra PG24/browser8
checks on Oct13; those allowances are exhausted and must not be rerun.
Actual API session flag is false. Authenticated bot menu read at14:55UTC returned
commands, not a WebApp. Read-only DB inventory at14:56:34UTC found zero experts,
zero verified experts and zero verified expert Telegram mappings; session table
exists. The first inventory probe failed module resolution, not a DB assertion.
Using the deployed DB package corrected that diagnostic without a database write.

## Approved technical scope

- Set only EXPERT_SESSION_ENABLED, EXPERT_TELEGRAM_BOT_KEY, EXPERT_WEB_ORIGIN,
  EXPERT_TELEGRAM_LOGIN_BOT_USERNAME and EXPERT_TELEGRAM_WIDGET_LOGIN_ENABLED.
- Verify installed expert token with getMe; derive stable bot scope from its ID.
- Use https://ii-tonya.ru; leave browser widget false without domain acceptance.
- Preserve every unrelated runtime value, release selector, provider key and flag.
- Restart API/worker only after guarded installation and keep the VPN unchanged.
- After service acceptance, replace the expert bot's default commands menu with
  a WebApp button for https://ii-tonya.ru/expert/account. Preserve prior menu.
- Do not create experts, map identities, approve profiles, issue synthetic user
  sessions, send chat messages, change consent, create bookings or call payments.

## Guarded procedure and recovery

Non-secret helper: .native-release/expert-entry-20261014/activate.mjs.
Remote private stages: first /home/ii_tonya/expert-entry-20261014.QdA5bC;
corrected retry /home/ii_tonya/expert-entry-20261014.K3VOXR, each mode0700.
Prepared runtime copies and state are0600 and never copied into Git or this report.
Prepare checks deployed identity, bot identity, existing menu, runtime validation
and actual baseline process environments. Apply takes the existing deployment
lock, requires unchanged runtime hashes and PIDs, retains original settings,
and verifies readiness, both actual environments and advancing worker heartbeat.
Root-owned, temporary oneshot units run the reviewed helper. Runtime replacement
uses a same-directory exclusive file, retained uid/gid,0600-to0640 permissions,
fsync and atomic rename. Rollback requires an exact original/candidate hash.
Acceptance rechecks process IDs, restart counts and environments after probes.
Menu writes and restoration revalidate getMe against the prepared bot ID and use
one verified token snapshot throughout, not a fresh token from a later process.
Failed activation restores the guarded original and restarts both applications.
Unknown bot writes are followed by a read, not a blind resend. Explicit restore
also restores the menu, but refuses an intervening operator menu/runtime change.
Configuration/service recovery precedes menu recovery so bot unavailability
does not prevent recovery of the application settings.
Restore accepts the exact candidate or original hash with the existing apply
marker. It reports application recovery before menu recovery; a Telegram failure
therefore permits a guarded resume without overwriting unrelated settings.

Acceptance requires anonymous expert-session available=true/authenticated=false,
widget=false, exact bot binding, public browser entry and confirmed bot menu URL.
Those checks do not prove a real expert can enter: no verified profile exists.
Full customer checkout and the new YooKassa RC104 are outside this activation.

## Preparation and review

Independent reviewer Peirce found three initial blockers: direct file replacement,
possible bot-token change between preparation/menu, and stale process acceptance.
The helper now uses atomic replacement, immutable verified bot credentials and
post-probe process checks. A follow-up found non-resumable menu rollback; restore
now accepts the guarded original hash and reports application recovery separately.
Final narrow review accepted the corrected helper, including missing-key checks
on recovery and preservation of partial-recovery stdout. No product test allowance
was consumed. That static acceptance did not establish successful activation.

Local syntax and unit validation passed. Prepare51673 passed on production:
the existing bot identity and commands menu matched, baseline process environments
matched the runtime, candidate loadEnv validation passed, and only the five
listed entry fields changed. Private original/candidate copies are retained in
the remote0700 stage, each0600. No live runtime/menu write occurred in prepare.
Prepared helper SHA256:
4e9514e269f795bce6fc23ca5b39b31d93bbbd156acc895902472e56443a88f7.

## First activation and preserved recovery evidence

Attempt35914 at15:15:24UTC failed with the final reviewed helper
4c3d223101a0307b40afad70824fd88852978a9366f1d9fdd43c802c865a304d.
The original inner failure was masked by the wrapper; its precise cause is NOT
known. A fresh15:16:45UTC read confirmed runtime exactly equals the original
hash, both actual process session flags false, API425337/worker425338 active and
ready HTTP200, VPN route11082 unchanged. No menu write was attempted.
The failed attempt, original copies and its apply marker remain in the first stage.

Read-only root probe in the same service confinement at15:19UTC passed process
environment, cwd and worker-heartbeat access. This rules out persistent access
failure in that observed context, not every transient error. The old verifier
read process state immediately after Type=simple restart, before readiness.
The retry waits for bounded readiness and exact expected process state before
acceptance, retains all post-probe checks, and reports the original sanitized
failure phase/code before recovery. It uses a new stage/marker/PID snapshot;
it does not erase or reuse the first failed attempt's marker.

## Final activation and public evidence

Narrow independent review accepted the startup-wait/diagnostic correction.
Read-only full verify-original in the actual root-service confinement passed at
15:21:54UTC without changing original settings. Final helper SHA256:
487110087ac2075f3b0b46e81c1b6069fb66ffdaacc91b9c19fdb1e24db97f97.

Second apply49667 succeeded; retained apply-result.json at15:23:12UTC records
API426218/worker426207, both expected actual environments, exactd00, readiness
and advancing heartbeat. Expert anonymous session is available=true,
authenticated=false, widget=false. No profile or permission was created.
Public mobile Chrome85437 at15:23:57UTC confirmed HTTP200, enabled login button
and Telegram-menu instructions, no JS errors and zero mutating requests.

Installed token identifies @ii_tonya_expert_promo_bot; this is the confirmed
expert-session binding from the authoritative runtime, not an inferred username.
Menu invocation48974 exited after its write-start marker without a result
artifact. Do not invent an acknowledged write. Independent read45227 at15:27:11UTC
returned ok=true, type=web_app, exact https://ii-tonya.ru/expert/account URL and
expected button text. Desired current menu is therefore verified without a resend.

Cleanup76712 removed exactly three owned temporary units (apply/restore/probe)
and the installed helper after stopped-state, ownership and content-hash checks.
Copies are recoverable from both private stages and the local ignored artifacts;
original/candidate credentials remain0600 inside0700 stages. No logs, application
data, canonical runtime or VPN profile was deleted. Final check15:29:19UTC again
passed exactd00, unchanged API426218/worker426207, actual environment, session
availability, readiness and advancing heartbeat. VPN423677 remains active,
NRestarts1 from the earlier incident; this does not establish indefinite stability.

For rollback, reinstall the matching helper and restore unit from private stage
K3VOXR, reload systemd, then start the restore unit. It requires exactd00 and an
exact original/candidate runtime hash, so it refuses to overwrite later changes.
Application recovery is verified before menu recovery. Do not reuse the first
attempt's install marker or silently reset its failure evidence.

Durable sanitized result: docs/test-evidence/production/2026-10-14-expert-entry-activation.json.
No authenticated expert journey, real payment, booking or full product acceptance
is claimed. The inventory was empty; a real confirmed profile is still required.
