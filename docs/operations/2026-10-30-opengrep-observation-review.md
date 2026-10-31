# Independent review of OpenGrep observations — 2026-10-30

Reviewer: `/root/final_payment_review`, independent of the disposition adapter
implementer. This is an agent security review within the authorized repository
work, not a claim of human approval, a production release approval, or a passing
raw scanner result.

## Exact reviewed inputs

- Repository baseline: `1df0d7b9c5c4db1c244c12d4525470bf1275c738`.
- Branch: `codex/early-bird-wave1-main-sync-20261029`; source changes were
  uncommitted at review time.
- Initial summary scan: `/tmp/early-bird-opengrep-fresh-20261030.json`, SHA256
  `97da35aa6faa244fa3ba1564bd358084e70b25d8da376541c753700c234c8ba0`.
- Final complete raw scan envelope:
  `.getzilla/runtime/opengrep-review-2ae1b552a5c0ec2fc3c165a65a300644.json`, SHA256
  `30b411f227d62c1ecc2d08831a53c323cea8579492e26ff75d9c87fec6558523`.
  Its `raw_stdout` SHA256 is
  `0fc733319ee728df47964e8b1aa6a2ef47ae4ecf178b908655f7e0fe9f87c591`.
- Reviewed record manifest:
  [`engineering/opengrep-reviewed-observations.json`](../../engineering/opengrep-reviewed-observations.json),
  SHA256 `314bb68190223c01418fe456cb3abf444afac60c1a6d676d99e8e5091d1a1e00`.

Every one of the manifest's 97 entries was checked against the fresh scan's
exact rule ID, repository-relative path, and current line number. All 97 full-file
SHA256 values match current source, covering 32 distinct files. There are no
duplicate records, missing observations, or additional observations. The full
per-record paths, rules, lines, hashes, and reviewed classifications are the
`entries` array of the exact manifest identified above; this approval applies to
each of those records and no others.

The fresh set is identical to the prior 97-observation report at
`/tmp/early-bird-quality-opengrep.json`. A TypeScript AST traversal independently
located all 94 JavaScript/TypeScript call sites at their reported source spans.
The three Python calls and their loader construction were inspected directly.
The fixture constant refactor did not change the reviewed sinks or their
security boundaries. There are six new observations and 91 baseline-equivalent
observations. Changed-file baseline mappings are `app.ts` lines 855/877/899 to
baseline lines 834/856/878, and `expert-held-onboarding-repository.ts` lines
217/220 to baseline lines 251/254.

## Per-record classification rationale

| Manifest category        | Count | Evidence and boundary                                                                                                                                                                                                                                                                             |
| ------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regex-exec`             |    16 | All calls are `RegExp.exec`, including two receivers bound to constant regular expressions. There is no child-process or shell invocation at these sinks. The rule's generic `$CP.exec` pattern matches regex methods.                                                                            |
| `parameterized-sql`      |     5 | The arguments are Drizzle `sql` tagged templates, with values bound separately rather than interpolated into executable SQL. The imported Drizzle implementation emits placeholders and parameter arrays for these values. No `sql.raw` or inline-parameter conversion occurs at these sinks.     |
| `domain-command-execute` |     2 | `apps/api/src/routes/expert-referral-admin.ts:400` invokes the authenticated admin domain service with an actor and command object; `apps/sandbox-api/src/routes.ts:269` invokes the transition workflow with a command object. Neither call is a database execution API or accepts a SQL string. |
| `json-or-cli-output`     |    69 | 61 calls return JSON objects through Fastify; five forward JSON response bytes with preserved or explicitly assigned JSON content type; three write CLI stdout/stderr. None is an HTML rendering sink.                                                                                            |
| `ruamel-roundtrip`       |     3 | Both skill scripts construct `ruamel.yaml.YAML(typ="rt")`, without adding unsafe constructors or registering Python classes. The calls are not the unsafe PyYAML API.                                                                                                                             |
| `operator-health-fetch`  |     2 | `scripts/smoke.mjs:24,27` intentionally fetch health endpoints at the operator's local CLI `--base-url`. Only HTTP(S) is accepted and embedded credentials are removed. No application request selects this URL. This is a trusted operator boundary, not a network allowlist.                    |

The five JSON byte forwards are `apps/api/src/app.ts:855,877,899` and
`apps/api/src/routes/browser-account.ts:532,580`. The latter explicitly selects
JSON content type; the former forwards responses from the internal admin JSON
APIs and copies their response headers. The three CLI writes are
`scripts/assert-ci-db-results.mjs:82,88` and
`scripts/preflight-expert-referral-migration.mjs:32`.

The five parameterized SQL observations are
`apps/api/src/payer-receipt-production.test.ts:301,358`,
`packages/db/src/repositories/consent-evidence-repository.ts:130`, and
`packages/db/src/repositories/expert-held-onboarding-repository.ts:217,220`.

The ruamel loader behavior is documented by the project's
[official API documentation](https://yaml.dev/doc/ruamel.yaml/api/): its
round-trip loader derives from the safe loader and lacks arbitrary Python-object
construction. The reviewed scripts use that loader explicitly and do not add
custom constructors.

The six newly introduced observations are:

| Path and current line                                                           | Rule suffix                    | Reviewed behavior                 |
| ------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| `apps/api/src/routes/owner-pricing-approved.ts:63`                              | `javascript.command-injection` | Bearer-token regular expression   |
| `apps/api/src/routes/owner-pricing-approved.ts:91`                              | `javascript.reflected-xss`     | JSON approval object              |
| `apps/api/src/routes/owner-pricing-approved.ts:157`                             | `javascript.reflected-xss`     | JSON grant object                 |
| `packages/integrations/src/yookassa/early-bird-deferred-checkout-sender.ts:131` | `javascript.command-injection` | Decimal amount regular expression |
| `scripts/assert-ci-db-results.mjs:82`                                           | `javascript.reflected-xss`     | CLI stdout                        |
| `scripts/assert-ci-db-results.mjs:88`                                           | `javascript.reflected-xss`     | CLI stdout                        |

## Decision and limits

**Historical scan-completeness blocker, resolved by the final raw scan:**
independent inspection of the initial retained raw engine
output found a `PartialParsing` warning (code 3) for
`apps/api/src/server.ts:232`, concerning an inline TypeScript import type. The
summary report did not expose that warning. The ignored raw-evidence envelope
`.getzilla/runtime/opengrep-review-700820598206ac53102f6f8fff3dee21.json` has SHA256
`08f18cd08f2213d144ab583a4b9172839cedf144cae806de6e71fa8ee8647125` and contains
97 findings plus that warning. That scan did not establish complete parsing;
the warning was not dispositioned as informational and its evidence is retained.

The final raw scan identified above was inspected independently after the inline
type was replaced by the named `TestExpertTrialMetricEvent` type import. The
current `apps/api/src/server.ts` SHA256 is
`5efc5a982ae2e351957b722e95ffbdb65b085357da5f801dec1aa861f9167ff0`.
The raw engine returned code 0 with `errors: []`, exactly 97 unique findings,
and unchanged original severities: 95 `ERROR`, two `WARNING`. Every raw
`check_id`/`path`/`start.line` tuple matches the reviewed manifest. All 32 current
source-file hashes still match its 97 records; no new, missing, duplicate, or
stale record was found. The envelope also records the same reviewed manifest
SHA256. The parser-completeness blocker is therefore closed for this final scan.
This does not change the raw quality result into a finding-free result.

The exact 97 manifest entries are independently reviewed as 95 semantic false
positives and two intentional operator CLI network operations. Their
classifications are unchanged after the fixture refactor. No exploitable
security defect was established among these observations; no unknown or newly
unreviewed finding is included in this decision.

This supports source-bound informational dispositions for these exact records
only. Original scanner results and severities must remain available. A new
finding, changed file hash, changed rule/path/line, duplicate record, invalid
record, or scanner/tool error is outside this approval and must remain failing
until separately reviewed. This report does not independently certify the
adapter's implementation or authorize a scanner bypass.

The reviewer ran no tests, application requests, or scanner rerun, and changed
no product code, scanner engine, rules, global ignores, inline suppressions, or
disposition records. Work consisted of reading the supplied reports and source,
static AST/source comparison, independently computing hashes, and writing this
review. This is not an exhaustive application security audit, CI result, or
production verification.
