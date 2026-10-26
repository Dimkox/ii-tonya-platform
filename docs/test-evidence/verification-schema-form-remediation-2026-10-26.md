# Verification Schema+Form Logic review remediation — 2026-10-26

Review baseline:8fc8e34b15065b5ff058fd6d7c739b19cdb6cd98.
Contract: `docs/superpowers/implementation-artifacts/spec-verification-schema-form.md`.
Accepted findings are P1–P11; this is one coherent remediation cycle. Independent
accepted-patch verification and the final branch gate remain coordinator-owned.

## Findings and resulting behavior

| Finding                          | Remediation and verification                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 role clearing                 | Committed repository already cloned the raw patch and preserved null; the proposed clone-loss mechanism was rejected after inspection. Text role changes now share inline normalization. Real PG proves clearing/reselection, other-answer conservation and exact replay.                                            |
| P2 media/permanent failures      | Draft media requires an applicable explicit/derived document question. Unexpected media, whitespace-only follow-ups, bounded-input errors and aggregate overflow receive corrective200; no answer is silently assigned to education.                                                                                 |
| P3 document recovery/supplements | Remove/clear/replace controls recover from wrong references and the ten-file cap. Optional education has durable Skip/Back; required missing refs cannot be skipped. Post-submit text/files/captions are bounded typed update history; submitted_draft remains unchanged. Actual erasure includes a file supplement. |
| P4 policy mismatch               | Saved version or requirement mismatch remains strictly rejected for mutations. The form displays a read-only manual-review message without new-policy edit controls. PG proves unchanged draft/revision/update count. No automatic migration.                                                                        |
| P5 URL/SQL parity                | HTTPS scheme/host case is normalized; credential/whitespace/backslash URLs and prohibited text/caption controls are rejected. SQL and domain share negative cases, and uppercase HTTPS persists correctly with host projection. No URL is fetched.                                                                   |
| P6 aggregate size                | Conservative64000-byte UTF8 serialization bound applies before SQL, preserving the prior draft. Tests use cumulative multilingual captions, including the service's permanent corrective response.                                                                                                                   |
| P7 erasure index                 | Added partial user_id index for active request receipts. Actual erasure/revocation queries use this subject predicate. Retention stays under existing erasure/consent lifecycle; no TTL invented.                                                                                                                    |
| P8 flag-off denial               | Persisted cohorts receive stable200 pending messages for /tariffs, null /my_tariff reads and /start, with tariff keyboard removed. Consent paths and durable database price fences remain.                                                                                                                           |
| P9 real composition              | Fastify authenticates a real update through createExpertApplicantComposition, original consent enrollment, /start and its returned role callback; real SQL persists only owned role data, no anchor/quote/invoice. Callback replay and later flag-off behavior are covered.                                          |
| P10 environment ceiling          | Both capability/configuration mismatch directions are rejected, including a higher capability injected into disabled startup; normal enabled/disabled composition works.                                                                                                                                             |
| P11 confirmation                 | Bounded saved facts and document counts appear before immutable submission with existing editing controls. Russian role/tax/category labels retain canonical enums/callbacks. No private file IDs or long-field dumps.                                                                                               |

The final compatibility correction also preserves /start referral code, guide
status and frozen-bonus information alongside the first form controls, with no
old /tariffs instruction. It adds no financial call. The final decoder correction
acknowledges authenticated, structurally valid unsupported MIME/oversized media,
overlong form text and old disabled-form controls with corrective200 and zero
service/mutator calls; malformed metadata remains400 and authentication401.
Authenticated rate limits still apply before those corrective responses.

The optional callback-spinner suggestion stays deferred: the webhook returns a
sendMessage question; a separate live answerCallbackQuery transport/token was not
added. No manager decision, pricing/activation, OCR/social worker, S3 ingestion,
provider activation, staging/production change or live Telegram send occurred.

## Actual focused evidence

- RED logs `/tmp/verification-remediation-domain-red.log`2failed;
  `/tmp/verification-remediation-service-red.log`5failed;
  `/tmp/verification-remediation-ceiling-red.log`1failed;
  `/tmp/verification-remediation-flag-off-red.log`1failed;
  `/tmp/verification-remediation-pg-red.log`4failed/1passed. The repository mismatch
  cases already passed, and inline marker preservation passed within the combined
  role case; text normalization was the confirmed failure.
- Domain GREEN12/12 `/tmp/verification-remediation-domain-green.log`.
- Form service GREEN12/12 `/tmp/verification-remediation-service-label-final.log`.
- Applicant service GREEN28/28 `/tmp/verification-remediation-promo-compat-green.log`; the added promo-compatibility case first failed in `/tmp/verification-remediation-promo-compat-red.log`.
- Capability/composition GREEN10/10 `/tmp/verification-remediation-ceiling-final.log`.
- Decoder GREEN15/15 `/tmp/verification-remediation-decoder-green.log`, after
  RED3failed/12passed in `/tmp/verification-remediation-decoder-red.log`. No SQL
  or PostgreSQL repeat was needed for this decoder-only correction.
- Main PostgreSQL17.5 GREEN21/21 `/tmp/verification-remediation-pg-green1.log`.
- Real Fastify+PostgreSQL composition GREEN1/1 initially in
  `/tmp/verification-remediation-real-composition-pg1.log`; final GREEN1/1 in
  `/tmp/verification-remediation-real-composition-pg-final.log` uses complete loadEnv
  configuration and asserts the Russian role label from the freshly built runtime.
  Application build: `/tmp/verification-remediation-app-label-build.log`.
- One final metadata reconstruction after SQL freeze:
  `/tmp/verification-remediation-metadata-final.log`.58 hand-authored migrations,
  fresh empty-directory introspection normalized through migration-state.ts,
  174tables; additive catalogue9functions,5triggers,43constraints,12indexes.
  Snapshot/supplement/SQL hashes updated narrowly; historical SQL remains intact.
- Focused boundary/provenance5/5, migration history9/9, staged-source scope130/130;
  logs `/tmp/verification-remediation-boundary.log`,
  `/tmp/verification-remediation-history.log`,
  `/tmp/verification-remediation-tracked-scope.log`.
- Relevant builds, four affected package typechecks and tests typecheck pass.
  Initial types failures were snapshot policy-string versus constrained union,
  optional test-text narrowing and a partial config fixture; corrected without
  weakening runtime policy/configuration checks. Changed-file ESLint passes.
  Final formatting/whitespace checks are retained with the remediation checkpoint.

Only the task-owned local PostgreSQL17.5 cluster was used. Temporary test and
metadata databases were cleaned up. Failed logs remain retained; no unrelated
whole-suite repeat or full branch gate was run by the implementer. Source acceptance
is distinct from the coordinator's final review/gate and from live release evidence.

Final affected application build for promo compatibility:
`/tmp/verification-remediation-promo-compat-build.log`; affected API build for the
permanent decoder responses: `/tmp/verification-remediation-decoder-api-build.log`.
No unrelated package rebuild or broad PostgreSQL rerun followed these corrections.
