# Published interactive customer demo

Web source: `bf99509a28c0afaa0ca06fe9e88e4333218a156c`.
Native source, unchanged: `aae05c06fdc76e74ccbd77de233d3dd7dc74efcb`.
Public route: https://ii-tonya.ru/demo (also `/demo/`).

Normal RC push gate passed. Exact-commit archived-source build, SBOM/provenance,
Cosign manifest signature and remote checksums passed. Hegel independently
reviewed web-only atomic switch/recovery; no blocking defect. No native, runtime,
database or service configuration changes. Readiness remained all true.

Live Chrome used verified TLS with host resolution pinned to157.22.187.237.
Passed selection, reservation, repeated actions, simulated payment, illustrative
consent, synthetic export, withdrawal, cancellation, clear and reset. Direct
navigation to `/demo/` and reload returned clean state. Actual served SOURCE_SHA
matched the candidate. Application API calls0, JavaScript errors0, mobile
overflow false. Screenshot inspected. This is DOM-action smoke, not exhaustive
touch-device, genuine payment, authenticated-account or BFCache acceptance.

Logs, rollout script and screenshot:
`/tmp/ii-tonya-customer-demo-release.fQojmR/`.
Signed retained artifacts:
`.native-release/client-web-bf99509a28c0afaa0ca06fe9e88e4333218a156c/`.
Local implementation/review evidence is in the two customer-demo reports.

Recovery: under `/opt/ii-tonya-platform/.release-operation.lock`, restore only
web-current to `web-releases/aae05c06fdc76e74ccbd77de233d3dd7dc74efcb` with an
atomic symlink replacement. Verify served SOURCE_SHA and readiness. Native and
database stay unchanged. Previous web retained; no live rollback drill claimed.
Upload staging removed after identity/checksum verification; recoverable from
the signed local artifacts. Build temporary directories were removed by helper.

No real booking, payment, consent, deletion, customer account or invitation email
was created. No personal contact data entered source or demo output. Demonstration
state is browser-memory only; downloaded synthetic files remain on the visitor's
device until they remove them. Full commercial-product acceptance remains open.
