# Production read-only preflight — 2026-10-12

Scope: server liveness and public anonymous-page availability. Not authenticated acceptance, a new deployment, payment verification or human review.

## Observations

- SSH identity: `ii_tonya` at the verified existing deployment host. Strict host-key verification retained.
- Remote `systemctl is-active ii-tonya-api ii-tonya-worker nginx`: all three active.
- Remote `http://127.0.0.1:3000/health/ready`: ready; postgres, migrations, workerLease and adapters true.
- HTTPS from the deployment host: root200, account200.
- HTTPS SOURCE_SHA: `43a93e2131cde6bb09a6825fc5b83dfbf91fc600`.
- Native and web symlinks independently resolve to the same43a93e2revision. The live `.previous-release` file names `releases/48009f9ce4de9f8258eede8d59b950899eafd0a8`; its suitability for a future rollback was not established.
- The visible systemd timer list has no named application PostgreSQL backup timer. No inference is made about hosting snapshots, cron-based backups or another backup service. Repository disaster-recovery drill evidence remains unavailable.
- DNS from the development environment resolves ii-tonya.ru to the same deployment address.

## Browser verification did not pass

Used a fresh temporary Chrome headless profile, without customer credentials. The first root-page navigation reached Chrome's error page with `ERR_NETWORK_CHANGED`. A second navigation to `/account` returned `net::ERR_TIMED_OUT`. The independent development-host curl attempt timed out after15seconds with HTTP000. The web browsing connector could not access the destination either.

The same server remained reachable by SSH and served HTTPS200 when requested from the server itself. These results distinguish functioning server-side services from unproven browser reachability; they do not establish the cause of the development environment's HTTP failure. No TLS verification was disabled. No login, checkout, appointment creation or customer message was attempted.

The Chrome process was closed through the DevTools protocol. Its debugging endpoint was then checked and was no longer reachable. No browser session remains available as evidence of a running check.

A follow-up browser attempt using an SSH forwarding path also timed out. A curl
probe through the configured proxy to that forwarded endpoint returned CONNECT403;
no proxy rule or TLS check was bypassed. The tunnel was terminated and both browser
profiles removed. A final request to the normal public HTTPS address through the
configured proxy timed out after10seconds. External browser acceptance remains
unverified; the separate successful server-side checks are not substituted for it.

## Release interpretation

Do not mark the published client journey verified. Repeat browser acceptance from a working network, including authenticated account and complete authorized scenarios, before human-review readiness. No product release or feature-flag mutation occurred during this preflight.

The private requirements registry transfer is separately recorded in the all-tab spec's registry-and-release companion. It is not a product deployment.
