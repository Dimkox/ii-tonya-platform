# Booking callback composition — local evidence

Candidate: uncommitted changes on codex/planerka-api, base HEAD
690797db64fd80aa1aeccea8003543de470d8c16. This is not exact-release-SHA evidence.
No real Telegram requests, live credentials, production migration or deployment.

## Transactional callback authorization

`tests/integration/booking-notification-callbacks.test.ts`:

- Run1 17:23:22 UTC: 34 failed / 6 passed. Behavioral issuer failures plus fixture failures.
- Run2 17:27:57 UTC: 41/41 passed. Subsequent rollback assertion strengthened.
- Run3 17:33:55 UTC: 41/41 passed, including rollback and post-lock expiry.

Run3 used the retained isolated PostgreSQL17.5 test container. The environment
check with RequireDocker passed. The expiry test observes pg_blocking_pids against
the owning transaction while the credential is still valid, then holds the lock
until after database expiry. The rollback case fails after callback consumption
inside the transaction. Budget3/3 exhausted. No historical test-file reruns.

Independent McClintock review accepted the scoped implementation and strengthened
race proof. Coverage includes persistent pair issuance/reuse, frozen identity and
receipt bindings, fresh post-lock database time, consumption/transition atomicity,
and audit-bound authenticated replay. No new migration in T3.

## API routing and acknowledgement

`apps/api/src/routes/booking-notification-callback.test.ts`: run1 18fail/1pass;
run2 19/19; final run3 25/25 at17:30:34 UTC. Both routes authenticate before JSON
parsing; canonical bad-MAC rejection occurs before DB lookup; duplicate updates
still reach transactional authorization. Stalled ACK returns at3000ms and aborts
its signal without repeating the transition. API unit transaction doubles do not
prove database atomicity; the separate PG evidence above covers that scope.

`apps/api/src/booking-callback-ack.test.ts`: 7 behavioral RED, then7/7 GREEN at
17:32:12 UTC. Fixed Telegram HTTPS endpoint, no redirects/retries, cancellation,
discarded response body, no propagation/logging of errors containing bearer URL.
The service, not the transport helper, owns its deadline. Scoped review accepted.

## Real application composition

`apps/api/src/booking-callback-composition.test.ts`: run1 2fail/1pass. The missing
service/guard assertions failed; formatting failed objects additionally invoked
disabled proxy methods and caused four unhandled errors. Later assertions avoid
formatting those proxies. Run2 3/3; reviewed expanded run3 7/7 at17:36:20 UTC.

Expanded tests build the actual application with actual default lifecycle and
inject authenticated HTTP with a real signed ct2 token. The composed service calls
the actual repository using an instrumented DB double; missing linkage returns403
with exactly one DB read. Each missing key material/bot key/token/webhook secret
is isolated. This does not prove a live provider call or an end-to-end booking.

Server composes shared inbox, PostgreSQL callback repository, local hash-capturing
issuer, reviewed vault, transactional booking service and ACK helper. App forwards
explicit capability and service to Telegram routes. Legacy booking ingress stays
disabled. Application rebuild resolved stale DTS missing replayed; API typecheck,
shared test typecheck, scoped lint and whitespace checks subsequently passed.

## Configuration and remaining release obligations

Config implementer reports55/55 GREEN on run2 following55 RED. Files are env.ts,
booking-callbacks.test.ts and .env.example. Independent McClintock scoped review
accepted config, tests and callback example settings without actionable defects.
Coordinator rebuilt current config and reran API/shared-test typechecks: exit0.
Default-off capability must not turn on legacy integrations or new admission.
Real key provisioning/rotation retention is a separate release step.

T4 delivery runner and exact rendered-wire digest binding are not implemented.
Retention/erasure, production compatibility/restore, full customer journeys,
remaining specification requirements and human acceptance are not established
by this evidence. Catalogue remains empty. Full product goal remains open.
