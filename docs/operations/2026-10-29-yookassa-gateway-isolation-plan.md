# YooKassa gateway isolation: deployment preparation

Status: **design and local evidence only; no live capability**. The experimental Python
gateway is not a production transport and its CLI refuses activation. This document
neither installs a service nor authorizes a live merchant call. Its requirements must
be implemented and independently reviewed before an operator attempts a target rollout.

## Existing target and evidence

Production uses native systemd API/worker services, system PostgreSQL and nginx, not
Docker: see [native deployment](../runbooks/native-production-deployment.md). The
[YooKassa runbook](../runbooks/yookassa-provider.md) records the provider as blocked;
its observed settings are historical and must be checked afresh without displaying
secrets. The native deployment script controls only API, worker and migration units;
it does not currently install, stop, fence, verify or roll back a gateway service.
Do not assume its rollback covers any proposed gateway or database changes.

Locally `python3 scripts/experimental/yookassa_gateway/docker_isolation_probe.py`
passed with synthetic services in two Docker `--internal` networks, and removed its
own resources. This demonstrates direct connectivity denial in that disposable
Docker topology. It does not test the native target, nftables, actual gateway,
provider TLS, credential access, PostgreSQL authority, or revocation ordering.
`python3 scripts/experimental/yookassa_gateway/egress_fence.py --synthetic-probe`
failed locally because network namespace creation was denied; this is not a pass.
`--dry-run` only prints example nftables rules and never installs them.

## Required target design and acceptance evidence

1. Create a separate service identity and Unix socket with an explicit owner, group,
   permissions and peer authentication. The API and worker have no merchant secret,
   no permission to impersonate the gateway identity, and no alternate provider
   route. Gateway code runs non-root with empty capabilities, no-new-privileges,
   protected filesystem and bounded access to its own durable state. Ensure no
   writable executable or privileged helper can bypass these restrictions. Locking
   a replaceable file or merely checking a readiness flag is insufficient.
2. Store the merchant credential in a reviewed secret facility readable only by the
   gateway identity (or systemd credential handoff), separate from the common
   `runtime.env`. Restrict its owner, permissions, backup and rotation procedure;
   never place its value in arguments, source, logs, evidence or diagnostic output.
   Verify effective access from actual process identities, including privileged
   agents and scheduled jobs, without printing credential material. Remove legacy
   credentials from other processes only through a reviewed rotation plan.
3. Apply target-specific default-deny egress that cannot be modified by the service
   and has no direct or proxy bypass through DNS, loopback, IPv6, Unix sockets,
   alternate namespaces or other machines. Explicitly account for the required
   database and local IPC flows. Permit only the reviewed YooKassa destination and
   port; validate TLS hostname and certificate independently of IP allowlisting.
   Address changes require a reviewed update and fresh negative/positive probes.
   The example UID-based nftables generator is not an installable production policy:
   UID rules alone cannot restrict root, other identities, other hosts or Unix proxies.
4. Establish a single writer and crash-recovery authority resistant to process restart,
   lock replacement, state truncation and alternate instances, with a trustworthy
   durable anchor. Demonstrate the actual revocation and expiry sources, including
   direct SQL paths, are fenced before first network write. Current experimental
   local locks, in-memory tombstones and restart disarming do not establish that
   production invariant. Test concurrent deletion, expiry, partial writes, process
   death and unknown provider outcome, against the exact target architecture.
5. Require exact-SHA CI and database gates, independent adversarial review, approved
   consent and fiscal policy, provider test-shop evidence, trusted webhook peer and
   authoritative GET verification, payment reconciliation, secret rotation and
   operator sign-off. Exact target binary, systemd properties, network policy and
   command output must be included in sanitized evidence; a synthetic probe or
   a healthy systemd unit is not merchant or readiness evidence.

## Read-only target inventory after explicit access authorization

These commands are examples for a target operator; they show service metadata, not
secret values. Do not run them against production merely because this plan exists.

```sh
readlink -f /opt/ii-tonya-platform/current
systemctl show ii-tonya-api.service ii-tonya-worker.service \
  --property=User,Group,MainPID,NoNewPrivileges,CapabilityBoundingSet,ProtectSystem,ProtectHome,PrivateTmp
systemctl status ii-tonya-gateway.service --no-pager
```

A missing gateway service is an expected failed inventory result, not a passing check.
Privileged firewall and credential-access checks must be separately designed for the
actual platform, record only sanitized facts, and prove both allowed and forbidden
paths from the actual identities; `nft list ruleset` can expose unrelated configuration
and must not be copied wholesale into evidence. Never inspect or print process
environments, credential file contents, provider payloads or tokens.

## Rollout and rollback design, still to implement

Prepare a reviewed gateway unit and native deployment integration with a bounded
stop and verified process identity, immutable release selection, dedicated secret
handoff and an independently controlled network policy. Exercise install, restart,
crash and rollback on an isolated native target before live operation. The deployment
must start disabled and verify all constraints before accepting a payment request.
The gateway unit has not been integrated into the deployment controller and no tested stop/recovery command exists;
operators must not invent or treat a placeholder command as a working kill switch.

On an incident, use the future reviewed admission-stop control and confirm from the
actual process/network boundary that no new sends can start. Preserve payment IDs,
idempotency keys, encrypted recovery material and unknown outcomes. Resolve pending
provider states through the existing authoritative reconciliation procedure; never
assume a timeout means failure, issue a fresh key, erase financial history, or replay
receipt data after revocation. Roll back application binaries only after confirming
schema and financial-state compatibility; otherwise keep admission disabled and roll
forward. Follow native deployment recovery/marker rules and coordinate gateway,
firewall and credential rotation with the deployment controller. No tested target
rollback procedure exists yet.

## Native Python shipping and launcher gap

The candidate experimental gateway uses Python standard-library facilities including
`ssl`, Linux Unix sockets and `fcntl` locking, and SQLite for local experimental
journals. No third-party Python package is imported by these components. This source
observation does not establish a supported target Python version, a trustworthy local
journal, or production compatibility. Python, OpenSSL, CA trust and SQLite versions
and their security-update owner must be explicitly pinned or attested for the target;
TLS verification must use approved system CA material. The existing deployment
contract documents Node 24, not an installed or pinned Python runtime.

`BoundGateway.create_ipc_server(address, auth_key, nonce_registry, allowed_pids,
confirmation_hosts)` is a construction interface used in experiments. It is not a
launcher. There is no reviewed production boot/configuration contract, credential
handoff, process/peer identity lifecycle, persistent fencing authority or integration
with systemd socket activation. In particular a socket unit cannot safely be assumed
to work until the launcher explicitly consumes and validates inherited descriptors.
The standalone gateway CLI remains disabled; the separate launcher requires existing state and PostgreSQL authority. Do not point a production unit at a missing
entrypoint or replace it with `/usr/bin/false` and label the result a deployable
service. A default-off `deploy/systemd/ii-tonya-yookassa-gateway.service` exists; there is no socket-activated unit. The service is not installed or controlled by the current deployment script.

For a future release, implement and test a launcher that starts disabled, binds
exact reviewed configuration and secret references without putting secret values in
arguments or logs, limits and authenticates peers, validates durable state and
network fencing, and refuses to serve on any missing prerequisite. A truthful
readiness signal requires these capabilities rather than process existence. The
launcher must define startup/restart behavior for unknown prior attempts, revocation,
expiration and safe stop; do not let automatic restart reauthorize a send.

The native build script now includes the gateway Python sources and readiness SQL alongside the Node API/worker, migrations, validation script and `deploy/systemd`. This packaging has not yet been validated by a complete native release build. The
deploy script installs and coordinates only API, worker and migration units. Before
shipping a real gateway, change the native bundle, signed checksum/SBOM/provenance,
preflight and migration-compatibility validation to account for the approved Python
runtime and all gateway files; verify the artifact contents and exact SHA on a
separate target. Include a reproducible interpreter/runtime sourcing and update
policy, securely isolated Python import path, ownership and filesystem permissions,
CA configuration, and no mutable current-working-directory imports. System Python is
acceptable only after target inventory, compatibility and patch ownership are
established; vendoring a runtime requires the same integrity and lifecycle evidence.

The deployment controller must be extended and tested to stop socket admission
before stopping the gateway, confirm the actual process exited, install and restore
matching socket/service versions, and preserve state during rollback. Existing
`systemctl stop` commands are not yet a tested gateway kill switch. Verify on a
synthetic native target that disabling admission, stopping the listener and service,
and denying egress actually prevent new sends; test already-in-flight requests and
unknown outcomes separately. Never deploy solely because unit syntax parses.

## Peer restart and systemd readiness

The gateway's trusted local peer principal is its dedicated configured client UID
plus the authenticated IPC handshake. Configuration `allowed_pids: null` permits
that UID's processes after a normal restart; a nonempty PID list optionally narrows
access and requires coordinated updates when processes restart. An empty list is
invalid. This accepts all correctly authenticated processes of that UID; PID reuse is
not treated as an independent boundary against processes already sharing that UID.
Gateway and client UIDs must differ, and the IPC key must only be readable by the
intended peer identity and gateway. Target UID assignment, secret access and peer
process isolation remain deployment checks.

The unit uses `Type=notify`: the launcher sends `READY=1` after protected state and
nonce registry open, PostgreSQL authority readiness succeeds, and the actual IPC
listener reports bound while its serving thread is alive. Invalid configuration,
unavailable authority, failed bind or missing notify socket prevents successful
startup. This confirms those startup conditions at that instant; it does not prove
external egress isolation or end-to-end provider, webhook or payment readiness.
