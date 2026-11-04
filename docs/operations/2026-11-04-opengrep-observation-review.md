# OpenGrep observation review update — 2026-11-04

Agent security review on PR #149 (branch `fix/final-call-expire-flake`). This is
not human approval and not a finding-free scanner result. It extends the
2026-10-30 review (`2026-10-30-opengrep-observation-review.md`), whose 97 records
and rationale stay valid where unchanged.

## Inputs

- Base commit: `c45305684ae376a5f934362425a092cf74bb47d0` plus this change.
- Engine: Getzilla 2.3.1, `opengrep` binary SHA256
  `d3195b9d8d5ae93179f6aa5f5daaba6a920a5a09d38c5d5ae5e60924050210c4`.
- Raw scan: return code 1, `errors: []` (the two `PartialParsing` warnings were
  fixed in `c4530568`), 126 unique findings.
- Manifest: `engineering/opengrep-reviewed-observations.json`, 126 entries,
  44 files. Every entry was re-hashed against current source.

## Why the manifest was stale

The PartialParsing error hid classification since #123/#130. In that time:

- 91 records were unchanged (same rule, path, line, file hash).
- 6 records moved lines only (same sink code): `apps/api/src/app.ts`
  855/877/899 -> 859/881/903 and `apps/api/src/routes/telegram-webhook.ts`
  259/408/423 -> 293/442/457. The old 6 records were removed.
- 2 records kept their lines but the file changed:
  `expert-held-onboarding-repository.ts:217,220`. Both sinks are still Drizzle
  `sql` tagged templates (`provider_object_id=${response.id}`, bound values).
- 35 records are new or moved. All are listed with `evidence` pointing to this file.

## New and changed records

| Path:line                                                                                                                                                                                                                                                                                        | Rule suffix         | Category                | Reviewed behavior                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts:859,881,903`                                                                                                                                                                                                                                                                | `reflected-xss`     | `json-or-cli-output`    | Same admin JSON proxy forwards as the 2026-10-30 records 855/877/899 (`reply.send(response.rawPayload)` with copied JSON headers).                                                                                                                                                                                                                             |
| `apps/api/src/routes/telegram-webhook.ts:293`                                                                                                                                                                                                                                                    | `reflected-xss`     | `json-or-cli-output`    | `reply.send(result.reply)`; `result.reply` is typed `{method:"sendMessage",chat_id,text}`, serialized as JSON by Fastify.                                                                                                                                                                                                                                      |
| `apps/api/src/routes/telegram-webhook.ts:442,457`                                                                                                                                                                                                                                                | `reflected-xss`     | `json-or-cli-output`    | `reply.type("application/json").send(result.reply)`.                                                                                                                                                                                                                                                                                                           |
| `apps/api/src/routes/telegram-webhook.ts:866`                                                                                                                                                                                                                                                    | `command-injection` | `regex-exec`            | `/^em1\.(bookings\|slot\|balance\|support)$/u.exec(data)`: a constant RegExp, no child process or shell. Not command injection.                                                                                                                                                                                                                                |
| `expert-held-onboarding-repository.ts:217,220`                                                                                                                                                                                                                                                   | `sql-injection`     | `parameterized-sql`     | Re-hash only; Drizzle `sql` templates with bound values.                                                                                                                                                                                                                                                                                                       |
| `scripts/tag-production-release.mjs:75`                                                                                                                                                                                                                                                          | `ssrf`              | `operator-health-fetch` | Operator CLI fetch of `https://<host>/SOURCE_SHA`. **Code fixed in this change:** `--host` must now match a bare public DNS hostname (`PUBLIC_HOST`); IP literals, `localhost`, ports, paths, userinfo and fragments are rejected. Scheme is fixed to `https`. Tests: `tests/repo/tag-production-release.test.ts`. No application request reaches this script. |
| `scripts/tag-production-release.mjs:97,101`                                                                                                                                                                                                                                                      | `reflected-xss`     | `json-or-cli-output`    | `process.stdout.write` of the dry-run `gh` command and `gh` output. CLI stdout, not an HTML sink.                                                                                                                                                                                                                                                              |
| 22 Drizzle sinks in `packages/db/src/**/*.integration.test.ts` and `packages/db/src/testkit/*.ts` (authority 824/840; erasure-race 62; expiry-race 95/201/209/218/258/261; integrity 189/306/642/706; recovery 152; refund-authority-digest 137; financial testkit 126; payment testkit 184/193) | `sql-injection`     | `parameterized-sql`     | `tx.execute(sql\`...\`)`tagged templates: every`${}`value is a Drizzle bound parameter (UUIDs, timestamps, ciphertext). No`sql.raw`. Test/fixture code only.                                                                                                                                                                                                   |
| `expert-separated-sales-quote-clock.integration.test.ts:31`, `public-expert-paid-main-receipt.integration.test.ts:38`                                                                                                                                                                            | `sql-injection`     | `parameterized-sql`     | Test helper `q(text, args)` -> `pg` `query(text, args)`. Values go through `args` placeholders; `text` is a literal at each call site in the same test file.                                                                                                                                                                                                   |
| `public-expert-payment-authority.integration.test.ts:52`, `public-expert-payment-expiry-race.integration.test.ts:43`, `public-expert-payment-integrity.integration.test.ts:43`                                                                                                                   | `sql-injection`     | `parameterized-sql`     | Test helper `call(name, args)`: arguments are `$1..$n` placeholders bound via `args`; `name` is a SQL function name passed as a string literal by the test itself (e.g. `"public.public_expert_gateway_claim"`). No external input.                                                                                                                            |
| `public-expert-capability-readiness.integration.test.ts:136,142`                                                                                                                                                                                                                                 | `sql-injection`     | `parameterized-sql`     | Test-only `grant/revoke create on database`. The database name comes from `current_database()` and is quoted with `"` doubling; the role is the file constant `sender = "readiness_onboard"`. DDL cannot take bind parameters; no external input.                                                                                                              |

## Decision and limits

No exploitable defect was found in the 35 new records. One real hardening gap
(unvalidated `--host` in the release tagging CLI) was fixed in code, not
suppressed; the finding stays in the manifest because the taint path still
exists by design (operator-chosen host).

Local verification: the sha-pinned engine plus `classify()` from
`scripts/getzilla_reviewed_opengrep.py` returns
`126 reviewed observations; raw scanner status=fail; 0 unresolved`.
Any new finding, changed file hash, or changed rule/path/line stays failing
until separately reviewed. No rules, ignores, or inline suppressions changed.
