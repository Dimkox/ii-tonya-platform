# Native scheduling independent review

Baseline: c207735727210660ac949b78b84cf7463519fb99.
Reviewed source: 9ce9eb23181be0a6ee54a0920fbc952d9e5aaf3e.
Evidence commit: c80ca4a82a7b2838a624f75aa57f87ce46664ce1.
Three fresh context-free read-only reviewers completed before triage. Duplicate
claims were consolidated only where the required correction is the same. Root
confirmed each source site. All six findings below are closed at corrective source b1872e94; branch gate/push remain pending.
Root verified 86 archive/raw pairs and 49 source hashes at the recorded commit;
protected local database credential is absent from all87 scanned manifest/artifacts.
No heavy root test/build/database jobs ran alongside the implementer.

| ID | Severity | Classification | Finding and required correction | Review owners |
| --- | --- | --- | --- | --- |
| R1 | high | patch | Journal0070.when1793079550433 precedes0069.when1793152800000, so normal Drizzle migrateDb skips0070 on an existing database. Change only the unshared0070 timestamp to exceed all predecessors, preserve old entries, add monotonic journal guard and prove actual populated incremental migrateDb application. Update exact journal hash registrations without weakening checks. | blind, edge |
| R2 | high | patch | resident-native-logistics.ts154 suppresses a second due row when a first transport response sets temporary bot throttle. Defer unsent temporary-control-blocked rows without consuming send attempts or creating terminal suppression; preserve real privacy/cancel suppression and unknown-outcome rules. Prove two due notices sharing a bot and later delivery after throttle/pause recovery. | blind, edge |
| R3 | medium | patch | expert-telegram-query-repository.ts333 detail callback reads mutable es.name while candidate list uses booked snapshot. After approved rename the same appointment displays different service titles. Bind actual /client detail to immutable native booked/service source, retain external behavior and execute the genuine candidate→callback detail witness after replacement. | blind |
| R4 | medium | patch | booking-notification-repository.ts416 classifies native origin only via confirmation proof. A native hold rejected/cancelled/expired before confirmation is rendered as an external-calendar not_created event. Use validated bound native slot origin for cancellation/expiry presentation, keeping immutable confirmation proof mandatory for booked. Cover expert decline, client cancel and expiry through normal worker; no fake provider facts. | blind, edge |
| R5 | high | patch | Dedicated native logistics tests instantiate repository directly; no actual createBookingNotificationRuntime cycle proves the new native.runOnce consumer. Add realPG due-native work through the production-composed runtime with synthetic transport, checking actual private message and persisted delivery state. Removing the production native invocation must make the witness fail. Preserve recovery/disabled-send behavior. | gap |
| R6 | high | patch | Integration test fixture writes at901 and1549 require an ignored task-local directory absent from a fresh checkout. Make browser export explicitly opt-in (preferred) or safely temporary, with no ordinary-test dependency on ignored task setup. Prove normal focused execution with no task fixture directory/export configuration and retain actual opt-in browser evidence. | gap |

All six are corrections within the existing frozen requirements, not new product
scope or missing owner intent. No destructive re-derivation, shared-history rewrite,
arbitrary issue quota or another permission loop. Preserve all passing source and
failed evidence. One existing implementer owns the source/test/state/evidence fixes;
root retains spec/status/coordinator/review/delivery ownership. Reviewers will recheck
assigned findings against exact corrective source and evidence. Do not rerun unchanged
broad suites: focused meaningful regression witnesses and changed relevant checks only.

## Positive preservation

Keep real Temporal/date/DST generation and strict import; initial private schedule
binding versus immediate approved-service availability; owner-scoped stable mapping;
canonical locks/buffer and final DB clock; paid visibility; immutable booked logistics;
legacy Planerka proof; original consent/identity and private delivery; actual readable
service titles and manager/browser session fencing. All historical migration SQL stays
unchanged. S4b and final combined journey remain required after this block is delivered.

## Verification to retain

Use an actual migration runner upgrade, not only manual SQL replay. The existing
journal has exactly one non-increasing pair,69→70, so a monotonic guard can protect
the whole current sequence without grandfathering a new failure. The largest prior
timestamp is1793152800000. Retain corrected source/guard hashes and original failures.
A clean ordinary integration run must not depend on .superpowers/sdd directories.
Native logistics requires a real normal composition witness; a direct repository
transport mock alone does not prove worker activation. Source is not accepted until
all six assigned review findings are closed and root branch gates pass.


## Corrective source accepted

All three original reviewers independently PASS source
b1872e94030666bf97bb50fb366caa7d5a8906b2. Blind closes R1–R4; edge closes R1/R2/R4;
verification gap closes R5/R6 and checks the actual incremental migrateDb upgrade.
No new concrete regression remains. The actual composed-runtime mutation proves
that removing native.runOnce fails delivery; source is restored byte-for-byte.
Clean-directory proof reproduced ENOENT before the opt-in fixture correction.
The full corrected native run was18/19 because a synthetic receipt counter reused
an ID; the test-only correction passes all3 affected R4 cases without the ignored
directory. Do not rewrite that failed full run as a19/19 full invocation.

Corrective evidence commit23d722b638c462ab7b75ca6ec3aa2600f53305b6 preserves66 artifacts
and50 source hashes. Root independently verifies every raw/gzip pair and committed
source pin, original manifest preservation and absence of the protected local
credential from67 scanned manifest/artifacts. ManifestSHA256:
b20f6b8bc0a18f046d5c5d9e80fbe52209a9f2db483bc669ae4ad8e16372591f.
Original86 artifacts/49 pins are retained unchanged. Other final correction proofs:
actual populated upgrade1/1 and replay; external37/37; expert queries10/10;
focused static222/222; actual browser, full workspace build/types, tests types,
changed lint/format/whitespace. Native data state remains222tables/175functions/
210triggers/1509constraints/549indexes/2extensions; only0070 journal time changed.

Root now owns canonical full branch gate, gated push and stacked DraftPR; no
hostedCI or release activation is claimed. S4b remains the next sequential block.
