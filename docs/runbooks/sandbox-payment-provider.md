# Sandbox payment provider runbook

Status: **TEST-ONLY / NOT RELEASE READY**. Provider-connected staging is `BLOCKED`; production is `NO-GO`.

This entrypoint simulates expert-residency checkout, an approved settlement, and an approved refund without a provider SDK, external network call, or provider credential. It is not a production payment adapter and must never be composed by `apps/api` or included in the native production release closure.

## Preconditions

- Run only on the Claw test host in the constrained `1 CPU / 1 GiB` profile.
- Use an isolated PostgreSQL database. Never point `SANDBOX_DATABASE_URL` at a production or shared application database.
- The sandbox migration must create the exact marker `ii_tonya_sandbox_v1`; startup readiness checks the marker before serving traffic.
- Set `II_TONYA_RUNTIME_MODE=sandbox` exactly. All live integration flags remain disabled.
- All provider credential variables are present only as empty placeholders. Do not copy `.env` files, tokens, approval secrets, or real account identifiers.
- Use two distinct authenticated admin sessions for request and approval. Do not pass actor IDs in request payloads.

## Canonical container execution

The authoritative lifecycle is `scripts/run-sandbox-container-smoke.sh`. It validates immutable source/image identity, starts the isolated internal PostgreSQL service, applies only the sandbox migration, validates the marker, exercises checkout and the two-admin settle/refund flow, verifies authoritative settlement/reversal facts, and performs bounded cleanup.

```bash
export SOURCE_SHA="$(git rev-parse HEAD)"
export VCS_REF="$SOURCE_SHA"
export SOURCE_ARCHIVE_SHA="<sha256 produced by the isolated source bundle step>"
export SANDBOX_IMAGE_REF="ii-tonya-sandbox-smoke:$SOURCE_SHA"
bash scripts/build-sandbox-image-offline.sh
bash scripts/run-sandbox-container-smoke.sh
```

Do not substitute mutable tags. `compose.sandbox.yaml` requires `II_TONYA_RUNTIME_MODE=sandbox`, an isolated `SANDBOX_DATABASE_URL`, and empty provider credential placeholders. The runtime has a read-only root filesystem, dropped capabilities, no Docker socket, and no production network.

## Expected lifecycle

1. Checkout creates an opaque `sbxpay_…` payment and atomic idempotency record. Viewing its URL cannot mutate payment state.
2. One admin requests the exact transition; a different eligible admin approves it.
3. The transition consumes the exact approval and commits payment version, append-only event, and audit evidence atomically.
4. One bounded delivery attempt verifies the canonical event and submits it to the existing provider inbox settlement or reversal path.
5. A downstream failure returns sanitized `delivery_pending`; the durable event remains pending for explicit reconciliation. There is no background retry loop in the API.
6. Reconciliation uses the same event ID and digest. Sandbox tables never write ledger, reward, residency, or refund facts directly.

## Containment and rollback

On an error, stop immediately, preserve only sanitized IDs/digests and timestamps, and do not retry with real credentials or a shared database. Run the script cleanup/trap and confirm zero task containers and processes. Remove the isolated sandbox Compose project and database volume only after recording the failure evidence. Rollback is removal of the sandbox image/Compose project and reversion of the sandbox-only branch; production API, worker, migrations, and database are not rollback targets because they are not part of this runtime.

If a native production bundle inventory contains `@ii-tonya/sandbox-api`, `@ii-tonya/sandbox-payments`, sandbox routes, or `createCanonicalExpertResidencyPaymentEventVerifier`, treat it as a release-blocking isolation incident. Quarantine the bundle, keep production `NO-GO`, and rebuild only after the static and packaged-closure guards pass.

## Current blocking record (2026-08-13)

At source `7214ae93a04e99993b190dfd881c34bd1eced22a`, no sandbox image was produced. Offline pnpm hydration timed out after 480 seconds and a narrowed attempt after 240 seconds on Claw. Cleanup returned zero containers/processes. `SBX-TST-009` and sandbox packaged-runtime checks remain unexecuted. Production has since moved to a native bundle, so the former reserved production-image smoke is obsolete; native release evidence is tracked separately in `docs/test-evidence/claw/887c462065bc8d4f480b5474135638a5bc063b8c/release.md`. See `docs/test-evidence/claw/sandbox-payment-provider-20260813/verification.md` for the historical sandbox checkpoint.
