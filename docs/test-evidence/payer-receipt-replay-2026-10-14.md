# Payer receipt metadata replay — 2026-10-14

Status: one bounded review-fix wave on source `054ee692a1d58081fd0f2332b27c2be84350f815` is implemented and statically checked for local handoff. Initial GREEN2 evidence below is historical, not verification of this wave. Adapter run3 was consumed as REVIEW RED; fourth adapter run is NOT authorized, so there is no post-fix GREEN. Expanded PostgreSQL cases are unrun; final3 remains reserved for coordinator after narrow review. No review/final-acceptance, release or full-checkout completion claim.

Environment preflight session19497: exit0, Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0. Linked worktree clean before this task; branch codex/receipt-metadata-replay-20261014. No .env is present or needed for synthetic verification.

## Test budget

| File                                                               | RED1                                      | GREEN2                         | final3                                                              |
| ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| tests/integration/payer-receipt-replay.test.ts                     | exit1: 5 failed / 10 passed, 16:04:01 UTC | exit0: 15 passed, 16:07:29 UTC | reserved                                                            |
| packages/integrations/src/yookassa/receipt-metadata-replay.test.ts | exit1: 36 failed / 36, 16:03:40 UTC       | exit0: 36 passed, 16:07:05 UTC | REVIEW RED exit1: 23 failed / 45 passed, 16:24:46 UTC; 3/3 consumed |

## Bounded review-fix wave

- Source confirmed live: `054ee692a1d58081fd0f2332b27c2be84350f815`; same branch/worktree, no other source writer. Coordinator owns spec/plan. Current task instruction supersedes the initial run3 allocation only for the adapter.
- Confirmed findings: metadata disclosure checks presence/identity only and can send malformed values; awaiting `markUnknown` can expose its private rejection. Admission already commits both operation and attempt as unknown. Fix only the metadata/payer disclosure branch; preserve legacy/refund validation, v1 digest and atomic admission.
- Fresh `pwsh -File scripts/check-development-environment.ps1`: exit 0. No PostgreSQL run planned in this wave.
- Official schema evidence supplied by coordinator: [YooKassa OpenAPI YAML](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml), linked from [official OpenAPI guide](https://yookassa.ru/developers/using-api/openapi-specification). `Phone` is a string with pattern `[0-9]{4,15}`, E.164 description and example `79000000000`; `Email` has format email and maxLength254. Reuse the repository's capture email validator. For phones, validate the entire string as optional `+` followed by4–15 digits, preserving existing plus-prefix fixtures without normalization. Local web open could not render octet-stream; a bounded direct document fetch timed out with partial YAML, so it was not treated as a successful independent schema verification.
- Before product edits, added invalid email/phone, failed-bookkeeping sanitization, explicit legacy preservation, real committed-then-lost acknowledgement (in-memory adapter fixture), and a gated concurrent-loser regression in the existing adapter test file. Renamed the original fake rejection test to honestly identify pre-commit failure.
- REVIEW RED run3 invocation: `pnpm exec vitest run packages/integrations/src/yookassa/receipt-metadata-replay.test.ts`; exit 1, 23 failed / 45 passed (68 total), 16:24:46 UTC, before product edits. All20 malformed-value cases reproduced POST/binding instead of unknown/no-send; all3 bookkeeping-rejection cases exposed the private storage error. No import/setup failure. New lost-acknowledgement, concurrent loser, valid-phone bounds and legacy-preservation cases passed. Full output: ignored `.superpowers/sdd/payer-receipt-replay-20261014/adapter-review-red3.log`. All3 adapter slots are consumed. No fourth run or disguised equivalent is authorized.
- Implemented only in `payment-adapter.ts`: newly admitted metadata/payer disclosure validates email with `payerReceiptCaptureRequestSchema.shape.email` and phone with the bounded whole-string rule above. If disclosure or its validation fails, a rejecting `markUnknown` cannot replace the sanitized `YooKassaUnknownOutcomeError`. Durable admission remains consumed. The legacy branch, client receipt construction, refund path, v1 digest and atomic admission implementation are unchanged.
- Expanded the existing PostgreSQL file with a real referral grant of100000 minor units created through issuance, redemption and synthetic verified settlement. Non-overdue receipt-bound replay compares exact original reservations/allocations and full stored order, grant, binding, payment-attempt and provider-operation rows after expiry/redaction, with no plaintext access. A separate overdue case preserves existing expiry behavior: only expected expiry fields and one release of the original100000 reservation may change; repeated replay must leave every row unchanged and cannot release twice. Its isolated historical fixture shifts both order creation/deadline timestamps; no product clock or expiry code is changed.
- Added real-repository failed-disclosure, failed-bookkeeping and lost-admission-acknowledgement retry cases through fresh adapter/repository instances. The lost-ack fixture awaits the actual committed admission before throwing, then compares full stored rows and asserts unknown/no provider ID, no repeat disclosure and zero transport. A controlled concurrent loser runs while the winner awaits disclosure and must neither read contact nor POST. These PostgreSQL additions have **not been executed**; coordinator owns final3.

### Review-wave static verification

All commands below exited0 after the source/test edits. No suite, standalone runtime probe or disguised test rerun accompanied them.

- `pnpm --workspace-concurrency=1 --filter @ii-tonya/db... -r --sort run build` (contracts, domain, integrations, db); output retained at ignored `.superpowers/sdd/payer-receipt-replay-20261014/review-build.log`.
- `pnpm --workspace-concurrency=1 --filter @ii-tonya/db... -r --sort run typecheck`.
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`.
- `pnpm exec eslint packages/integrations/src/yookassa/payment-adapter.ts packages/integrations/src/yookassa/receipt-metadata-replay.test.ts tests/integration/payer-receipt-replay.test.ts`.
- `pnpm exec prettier --check` on those three TypeScript files and this evidence file, following formatting.
- `git diff --check`.

Current review-wave source/test hashes (static checks only; not post-fix runtime acceptance):

```text
39b16ddb47a45eb630ea4b50e4b2e1a717eecc51e194b54e8b03b3acd401a26a  packages/integrations/src/yookassa/payment-adapter.ts
ad0aaec8c0a239d6b430c3ed0d81fc425094082f25956a30632cf1d82cdc9681  packages/integrations/src/yookassa/receipt-metadata-replay.test.ts
8a157a3b9db286782b914e80281fea01677b0db5a1e707bf8369790f57ebf6a1  tests/integration/payer-receipt-replay.test.ts
```

## Initial implementation ledger (historical source054ee692)

- Fresh environment check: `pwsh -File scripts/check-development-environment.ps1 -RequireDocker`, exit 0; Node24.21.0, pnpm11.9.0, PostgreSQL test URL supplied by the spec; no env file read.
- Frontmatter context loaded fully: `AGENTS.md`, `docs/agents/expert-residency-team.md`. Spec and existing plan read fully. Baseline and assigned branch confirmed live.
- Pre-flight: one task, no cross-task interface conflicts. Retained authority must preserve contact kind then opaque reference in the digest; refund code is outside the change.
- Spec precedence: only RED1/GREEN2 in each new file; no full-suite, baseline-suite, helper-induced rerun, subagent, remote operation or old-file execution. Coordinator owns independent review and final3. The existing evidence file is the durable execution ledger.
- Adapter RED1 invocation: `pnpm exec vitest run packages/integrations/src/yookassa/receipt-metadata-replay.test.ts`; exit 1, 36 failed / 36, 16:03:40 UTC. Behavioral failures show pre-admission contact reads, unavailable bound replay, ignored metadata and first-disclosure failures not consuming admission. No import/setup failure. Full output retained under ignored `.superpowers/sdd/payer-receipt-replay-20261014/adapter-red1.log`. RED also exposed one incorrect fixture expectation: the existing client sanitizes HTTP500 as `yookassa_unknown_outcome`, not `yookassa_http_500`. Corrected that expectation before GREEN2, preserving the existing classification.
- PostgreSQL RED1 invocation: `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya:local-placeholder-only@192.168.128.2:5432/ii_tonya pnpm exec vitest run tests/integration/payer-receipt-replay.test.ts`; exit 1, 5 failed / 10 passed (15 total), 16:04:01 UTC. PG17.5 assertion and isolated migration setup passed. Failures are missing metadata and replay denial after key loss/expiry/redaction; authorization and fresh-order guards passed. Full output under `.superpowers/sdd/payer-receipt-replay-20261014/postgres-red1.log`.
- Product edits followed both RED results. Added retained authority type/query and strict payer capability; admission now precedes payer disclosure; replay checks and refund path remain intact. Removed only the prior-order live-contact authorization. The old capture file has exactly one changed assertion and remains unrun.
- Builds: `pnpm --workspace-concurrency=1 --filter @ii-tonya/db... -r --sort run build`, exit 0 (contracts, domain, integrations, db). Matching package `typecheck` command and `pnpm exec tsc --noEmit -p tsconfig.tests.json` both exit 0.
- Initial scoped lint exit 1: five unused arguments/destructuring bindings in the two new test files. Corrected fixtures to validate request arguments and construct the legacy command explicitly; no product change needed.
- Adapter GREEN2 invocation: `pnpm exec vitest run packages/integrations/src/yookassa/receipt-metadata-replay.test.ts`; exit 0, 36 passed, no skips, 16:07:05 UTC. Full output under `.superpowers/sdd/payer-receipt-replay-20261014/adapter-green2.log`.
- PostgreSQL GREEN2 invocation: `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya:local-placeholder-only@192.168.128.2:5432/ii_tonya pnpm exec vitest run tests/integration/payer-receipt-replay.test.ts`; exit 0, 15 passed, no skips, 16:07:29 UTC. Isolated PostgreSQL17.5 migrations and teardown completed. Full output under `.superpowers/sdd/payer-receipt-replay-20261014/postgres-green2.log`.
- Final scoped `pnpm exec eslint` over the nine TypeScript files below: exit 0. `pnpm exec prettier --check` on the same nine files: exit 0. Tests typecheck repeated after the fixture-only lint edits: exit 0. `git diff --check`: exit 0. No source/test change followed GREEN2 before the initial054ee692 commit; the review-wave edits above supersede that checkpoint.

## Initial GREEN2 source hashes (SHA256, historical)

```text
a4b49dd018756d5459b508c6e2ef12f38c04b8294be681f40e69684b1336760d  packages/db/src/repositories/payer-receipt-contact-repository.ts
62f856efd492be099ec32cda5e68a71250b7d477c3add451384211faa8a4efdf  packages/db/src/repositories/expert-campaign-order-repository.ts
e05e7a6d3806837ddecf651c575856ec0869d31a3d8782d53aaa6fe280e0ac5b  packages/integrations/src/yookassa/operation-port.ts
25c08bcd83582d43193059371662c1f99d0cf9485facf2ff11a6c3364f7ef4e8  packages/integrations/src/yookassa/payer-receipt-source.ts
3e98717d24abb57af8788d04e600bc0553a791429dd867e6cd1a84679c55673b  packages/integrations/src/yookassa/payment-adapter.ts
2526776be27c4e0ca97733e4199b76a0515a1c53088b355448b1c97d69f61101  packages/integrations/src/index.ts
789ecf9c2684e318a7b6a69119eb06d0150bfab12817c9b1b80a6ba38086933d  packages/integrations/src/yookassa/receipt-metadata-replay.test.ts
90a8bf5076de2ba8f3bdd3fe9e7f9d8dbe85ad3184e03a951aa97093401bb172  tests/integration/payer-receipt-replay.test.ts
485a9c67b686e56b00f12eb6d11d0990104515a25ff0806974e9779d63ef6638  tests/integration/payer-receipt-capture.test.ts
```

## Initial GREEN2 behavior and compatibility evidence

- The repository metadata method selects only contact ID/kind through the existing exact composite order/quote/contact/user bindings. It neither selects ciphertext/key material nor invokes a vault or checks disclosure expiry. Real PostgreSQL tests retain the same opaque metadata before expiry, after expiry and after actual cleanup redaction, including with absent or throwing vaults.
- Order replay retains current active user/expert and verified-expert checks, original quote ownership, policy/quote idempotency checks and exact selected-contact binding. Only the prior-order live-contact authorization was removed. The new tests compare the original order and complete stored order/ledger/allocation/binding rows; wrong selection/quote/user, reassigned expert and inactive/unverified owner fail. Fresh orders still reject absent/wrong keys, expired contacts and redacted contacts without financial writes.
- The payer wrapper always exposes metadata capability; missing, null, undefined, malformed or throwing metadata fails closed before admission, contact lookup or provider transport. Explicit contact-only consumers remain on the legacy path.
- Fixed email and phone digest fixtures pin the byte-compatible `yookassa-request-authority-v1` JSON layout, including nested property order. Command UUID remains `5e4f4023-82d8-5085-a48f-92e30b3e0739` for the fixed command. A legacy-created admission is replayed by the payer metadata source with the same digest.
- New payer sends execute metadata lookup -> committed admission -> matching plaintext lookup -> one POST -> binding. Missing/throwing/invalid/mismatched disclosure preserves a consumed unknown admission and performs no POST; a retry performs no second contact lookup. Existing unbound admissions remain unknown. Bound admissions only GET, validating provider ID, order, amount, currency, mode and HTTPS confirmation with no plaintext lookup.
- The end-to-end PostgreSQL regression uses the real operation repository and real YooKassa client with an injected synthetic transport. It admits/binds one POST, expires and redacts the receipt, then replays the same order and unchanged provider operation through one GET with no vault/contact lookup.
- HTTP400 remains terminal failure; HTTP500 remains sanitized unknown outcome. Refund implementation is unchanged. No new ciphertext, replay snapshot, schema or migration was added.
- `tests/integration/payer-receipt-capture.test.ts:418` changes only the obsolete replay-denial assertion to exact original-order equality. That file was **not executed**; it is included only in static checks.

## Review, limitations and recovery

- Coordinator returned the confirmed review findings addressed in this wave and reported all reviewers closed. This implementer spawned no subagents. Narrow review of this wave and final acceptance remain coordinator-owned; neither is claimed complete.
- Adapter run3 is consumed by REVIEW RED; a fourth run still requires explicit owner approval. PostgreSQL has used RED1/GREEN2 only; coordinator retains final3 for the expanded file after narrow review. Do not rerun old suites or use renamed/copied tests or standalone probes to bypass these limits. There is no hosted CI here; no exact-SHA hosted CI, Database Gate or release-readiness claim is made.
- Initial PostgreSQL GREEN2 financial-preservation evidence covered cash-only orders. Nonzero-credit, overdue once-only release, full persistence snapshots and controlled concurrency cases have now been added but remain unrun. Their runtime behavior is the remaining concrete verification uncertainty; static checks alone do not settle it. Existing expiry/release and fresh-order credit calculations are unchanged.
- Pre-existing terminal provider-status handling for already-bound checkout is deliberately unchanged and deferred in coordinator-owned `docs/superpowers/implementation-artifacts/deferred-work.md`; a confirmation URL is not settlement authority. No material policy decision is made here.
- Full API checkout composition and first-disclosure-after-deletion policy remain outside this fix. Metadata is retained identity only, not evidence of consent/address verification or authority to disclose expired data. No production/provider access, feature activation, push, merge or deployment occurred.
- Recovery: coordinate any revert. Reverting this review wave alone restores054ee692, including its two confirmed defects; reverting the initial implementation restores the prior replay limitation. Neither action requires a migration rollback or changes the authority of existing provider admissions. Retain admissions and provider IDs; a failed replay or rollback never authorizes a new POST.
- Coordinator-owned spec, plan and deferred-work edits are left unchanged and excluded from this wave's commit. This wave contains only `payment-adapter.ts`, the two existing replay test files and this evidence file. The old capture-test assertion belongs to the initial commit and is unchanged in this wave.

### Safe operator guidance: unknown or unbound admission

Treat an unknown/unbound admission as consumed, including when disclosure or bookkeeping failed or the admission acknowledgement was lost. Through an independently authorized diagnostic process, inspect only non-PII order, attempt, operation and provider-object IDs plus statuses; escalate unresolved outcomes to the responsible payment/reconciliation owner. Do not inspect/log plaintext receipt contacts, ciphertext, credentials or raw private errors for this procedure. No real-data inspection was performed for this work.

Never delete or reset the admission, rotate its idempotency key, or issue a new POST to bypass uncertainty. Absence of a provider ID, a failed GET, contact expiry/redaction, a sanitized error or a rollback is not proof that no payment exists. Any recovery that could resend requires independently established resolution and separate authorization under the existing reconciliation policy; this fix creates no new retry permission or manual bypass.

Old suites are exhausted. The old capture-test expiry assertion was intentionally updated, but that file was not run. Full API composition tests remain separate and unused. Local results are not hosted CI or Database Gate.

## Execution decisions

- Metadata replay is already required by the approved payment composition design. It does not approve the unresolved first-disclosure-after-deletion semantics.
- Preserve legacy contact-only sources but never use them as fallback inside the payer source.
- One implementer owns source/tests; coordinator owns preparation and later independent review/final verification. No simultaneous writers.
- Docker Compose project ii-tonya-receipt-replay-20261014 owns a dedicated PG17.5 instance. Testkit creates and drops isolated child databases. Other existing project/test containers are untouched.
- The internal Docker network did not publish a loopback port (`port` returned `:0`); do not treat that as a listening endpoint. Host-side read-only pg connection succeeded at192.168.128.2:5432 with server_version_num170005. Synthetic admin URL: `postgresql://ii_tonya:local-placeholder-only@192.168.128.2:5432/ii_tonya`.
