# Production transfer + migration preflight — cb07bd18

- date_utc: 2026-09-18
- source_sha: `cb07bd1821d8106b0b0088b17bcf305662a1b792`
- live `current`: `releases/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`
- `.previous-release`: `releases/233f3cf72e45e47117948ad5615b603252801e40`
- production `current` **not** switched
- `/etc/ii-tonya/runtime.env` **not** rewritten
- payments remain `PAYMENTS_ENABLED=false`

## Transfer (step 4)

Local `sha256sum -c` and `cosign verify-blob` against
`release-cosign-claw-2026-09-17.pub`: Verified OK.

BatchMode `ii_tonya@ii-tonya.ru` copied the five artifacts to
`/opt/ii-tonya-platform/incoming/ii-tonya-cb07bd1821d8106b0b0088b17bcf305662a1b792/`
and rechecked `sha256sum -c` on the host. Extracted only into `incoming/.../tree`
(not `releases/<sha>`), so a later `deploy-native-remote.sh deploy` can still
create the immutable release directory.

## Runtime env (step 5)

`scripts/validate-runtime-env.sh` against `/etc/ii-tonya/runtime.env`:

| Check | Result |
|---|---|
| NODE_ENV=production, DATABASE_URL sslmode=verify-ca | PASS |
| fail-closed `*_ENABLED` / providers | PASS (`PAYMENTS_ENABLED=false`, `PAYMENT_PROVIDER=disabled`, others false) |
| `MIGRATION_COMPATIBILITY_APPROVED_SHA` matches `cb07bd18` | **FAIL** (still `7498ce656e1e49fe2d92c83f02d9667eb3f86b9b`) |

`ii_tonya` cannot read `runtime.env` (mode 600 `root:root`); validation ran as
root. Values were not copied to Claw `.env`.

## Migration preflight (step 6, read-only)

Prod drizzle ledger: **39** applied hashes. Incoming journal: **39** tags
(`0000_mvp` … `0038_test_expert_trial`). Tag lists equal. SHA-256 of every
`*.sql` in live `current/migrations` vs incoming tree: **identical**.
`expert_residency_orders` and `expert_residency_provider_operations` exist.
**No pending SQL** for this SHA.

Restore drill (dump/restore) was not run. Database was not migrated.

## Stop line

`deploy-native-remote.sh deploy` will refuse until
`MIGRATION_COMPATIBILITY_APPROVED_SHA` in `/etc/ii-tonya/runtime.env` is set to
`cb07bd1821d8106b0b0088b17bcf305662a1b792`. That edit and the `current` switch
were not done.
