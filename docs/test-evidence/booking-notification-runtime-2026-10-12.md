# Booking notification runtime and capture evidence

Local uncommitted candidate. No production or exact-RC claim.

## Worker lifecycle

apps/worker/src/booking-notification-runtime.test.ts:2 RED,2 GREEN, expanded final
6/6 at17:54:06UTC. Independent review accepted forwarding and deadline coverage.
Tests exercise production runtime wrapper, immediate stop, original shutdown
deadline after delayed cycle, drain before DB close, drain error and drain timeout.
Already-started SQL is not cancelled; no durable receipt-spool guarantee.

## Configuration

packages/config/src/booking-notifications.test.ts:8 RED,8 GREEN, expanded17cases
run3 failed7 due invalid syntheticbotID123. Correctedfixture123456, explicit
fourth-unit-run allowance,17/17passed17:57:46UTC. Runtimeguards not weakened.
Tests isolate callback/recovery dependencies and policy, including positive send
without new admission and capture without HTTP. NoPG/concurrency exception.

## Actual main factory

apps/worker/src/booking-notifications.test.ts:2RED/1pass,3GREEN, final8/8 at18:02:18.
Independent review found envadmissionfalse still invoking backlogcapture; wrapper
corrected before finalrun. Recovery-only test spies actual repository completion,
prohibits capture and fetch. Main test uses actual mainfactory/runtime/notification
composition, syntheticDB and unrelated-job doubles; it asserts recovery and DBclose.
Control preflight is read-only, allows existing paused control without unpausing,
and refuses missing control when sending/admissionenabled. No liveprovider calls.

## API reservation-origin composition

apps/api/src/booking-notification-capture.test.ts:run1 3failed andrun2 2failed/1pass
from incomplete existing session/catalog fixture capabilities. These are not
behavioral RED proof of origin logic. Correctedfixture run3 3/3 at18:04:29.
Reviewerrequested isolatedmissingbot/policy cases; explicitfourth-unit allowance,
4/4passed18:06:31UTC. Real constructor subclass records passedoptions; positive
origin is configuredbot/currentpolicy, admissionoff doesnot attach origin. This
doesnot independently prove transactionalDBcapture, covered by separatePGwork.

## Remaining

DB0045wireadmission fixes remain under review before finalPGexecution. Historical
T2/T3fixtureprovisioning and latestsnapshot assertions changedwithout rerun due
exhaustedbudgets; previouspasses are not evidence for their changedversions.
End-to-end providerconfirmedjourney, privacyretention/erasure, release/rollback
compatibility, remainingproductrequirements and humanacceptance remain open.
An envadmissionflag is not a global producer disable: durableDBgate must also be
disabled explicitly; see commercial-review-release runbook. Catalogue stays empty.
