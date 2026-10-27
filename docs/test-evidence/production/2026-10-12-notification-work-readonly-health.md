# Read-only public health during notification implementation

Date:2026-10-12. No deployment, settings, database or catalogue changes.

The browsing tool could not access https://ii-tonya.ru/ or /account. Direct curl
from the workspace then timed out at TLS negotiation for both targets: exit28,
HTTP000. These results do not establish a website outage or certificate defect.

Using the existing pinned-host BatchMode SSH deployment identity, ran the same
read-only HTTPS requests from the dedicated server157.22.187.237. Results:

- `/`: HTTP200, ssl_verify_result0.
- `/account`: HTTP200, ssl_verify_result0.

No certificate bypass, redirects override, credential output or application write.
This proves server-origin HTTPS reachability only. It does not prove independent
external/browser access, login, assistant responses, bookings, payments, current
release SHA or human acceptance. New notification candidate remains uncommitted
and not deployed; DB review fixes and final local verification remain pending.

## Follow-up during payment implementation

Read-only check through the same pinned SSH identity, session58028, exit0:

- `/`: HTTP200, ssl_verify_result0.
- `/account`: HTTP200, ssl_verify_result0.
- `/catalog`: HTTP200, ssl_verify_result0.
- GET `/v1/public/catalog`: parsed JSON with `items.length === 0`.

Only aggregate item count was printed, not public-profile payloads. No login,
booking, payment, configuration, database or deployment mutation. These requests
originated from the dedicated server. They do not prove browser rendering,
authenticated journeys, independent external reachability or candidate deployment.
The release SHA was not reread in this follow-up. The existing local browser
scripts target synthetic loopback data, not production; they were not repurposed
or rerun. Playwright was not resolvable from the workspace and its module/browser
environment overrides were unset. No browser/dependency installation was attempted.
