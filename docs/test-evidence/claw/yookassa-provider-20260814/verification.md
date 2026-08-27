# YooKassa provider Claw verification — 2026-08-14

Status: **CODE CHECKPOINT PASS / MERCHANT ACTIVATION BLOCKED**.

Tested code SHA: `17bd0f941dd8272378411ddba551e6ed11f56efa`.
Environment: retained `ii-tonya-test-yookassa` Claw container using the existing
`/home/pall/app-stack` PostgreSQL service. No GitHub Actions, image rebuild, production
container, production SSH, merchant credential, or provider network call was used.

## Executed evidence

| Gate                                          | Result               |
| --------------------------------------------- | -------------------- |
| terminal webhook mismatch causal RED          | 3 failed / 15 passed |
| terminal webhook mismatch GREEN               | 18/18                |
| encrypted recovery focused foundation         | 28/28                |
| migration `0024` full PostgreSQL schema gate  | 7/7                  |
| default-off recovery runtime focused gate     | 45/45                |
| lease-fenced recovery PostgreSQL gate         | 5/5                  |
| shared-claim snapshot race causal RED         | 3 failed / 14 passed |
| shared-claim snapshot race GREEN              | 17/17                |
| recursive payment scope boundary              | 113/113              |
| integrations and DB ESM/DTS builds            | PASS                 |
| targeted Prettier, ESLint, `git diff --check` | PASS                 |

The first PostgreSQL recovery attempt truthfully stopped before behavior because its
isolated fixture created only migration `0023`. The fixture was corrected to apply the
provider-operation statements from committed migration `0024`; the single corrected run
passed 5/5. No green run was repeated.

## Non-evidence and blockers

- YooKassa credentials, test shop, contract, fiscal approval, and provider callbacks are
  absent.
- Consent purpose/policy, recovery key reference, retention, enablement, and recovery
  window remain empty placeholders.
- No concrete production key-reference resolver is composed.
- Provider staging remains `BLOCKED`; production deployment remains deferred during
  hoster maintenance.

This record permits code review and a default-off merge only. It does not authorize
merchant activation or deployment.
