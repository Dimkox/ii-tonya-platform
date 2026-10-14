# Payer receipt metadata replay — 2026-10-14

Status: implementer GREEN2 passed; awaiting coordinator independent review and reserved final3. Base821996cf09cb8149648f9d925694041bad386f08. No release or full-checkout completion claim.

Environment preflight session19497: exit0, Node24.21.0, pnpm11.9.0, Docker29.9.0, Compose5.6.0. Linked worktree clean before this task; branch codex/receipt-metadata-replay-20261014. No .env is present or needed for synthetic verification.

## Test budget

| File                                                               | RED1                                      | GREEN2                         | final3   |
| ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------ | -------- |
| tests/integration/payer-receipt-replay.test.ts                     | exit1: 5 failed / 10 passed, 16:04:01 UTC | exit0: 15 passed, 16:07:29 UTC | reserved |
| packages/integrations/src/yookassa/receipt-metadata-replay.test.ts | exit1: 36 failed / 36, 16:03:40 UTC       | exit0: 36 passed, 16:07:05 UTC | reserved |

## Implementer execution ledger

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
- Final scoped `pnpm exec eslint` over the nine TypeScript files below: exit 0. `pnpm exec prettier --check` on the same nine files: exit 0. Tests typecheck repeated after the fixture-only lint edits: exit 0. `git diff --check`: exit 0. No source/test change followed GREEN2.

## Verified source hashes (SHA256)

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

## Behavior and compatibility evidence

- The repository metadata method selects only contact ID/kind through the existing exact composite order/quote/contact/user bindings. It neither selects ciphertext/key material nor invokes a vault or checks disclosure expiry. Real PostgreSQL tests retain the same opaque metadata before expiry, after expiry and after actual cleanup redaction, including with absent or throwing vaults.
- Order replay retains current active user/expert and verified-expert checks, original quote ownership, policy/quote idempotency checks and exact selected-contact binding. Only the prior-order live-contact authorization was removed. The new tests compare the original order and complete stored order/ledger/allocation/binding rows; wrong selection/quote/user, reassigned expert and inactive/unverified owner fail. Fresh orders still reject absent/wrong keys, expired contacts and redacted contacts without financial writes.
- The payer wrapper always exposes metadata capability; missing, null, undefined, malformed or throwing metadata fails closed before admission, contact lookup or provider transport. Explicit contact-only consumers remain on the legacy path.
- Fixed email and phone digest fixtures pin the byte-compatible `yookassa-request-authority-v1` JSON layout, including nested property order. Command UUID remains `5e4f4023-82d8-5085-a48f-92e30b3e0739` for the fixed command. A legacy-created admission is replayed by the payer metadata source with the same digest.
- New payer sends execute metadata lookup -> committed admission -> matching plaintext lookup -> one POST -> binding. Missing/throwing/invalid/mismatched disclosure preserves a consumed unknown admission and performs no POST; a retry performs no second contact lookup. Existing unbound admissions remain unknown. Bound admissions only GET, validating provider ID, order, amount, currency, mode and HTTPS confirmation with no plaintext lookup.
- The end-to-end PostgreSQL regression uses the real operation repository and real YooKassa client with an injected synthetic transport. It admits/binds one POST, expires and redacts the receipt, then replays the same order and unchanged provider operation through one GET with no vault/contact lookup.
- HTTP400 remains terminal failure; HTTP500 remains sanitized unknown outcome. Refund implementation is unchanged. No new ciphertext, replay snapshot, schema or migration was added.
- `tests/integration/payer-receipt-capture.test.ts:418` changes only the obsolete replay-denial assertion to exact original-order equality. That file was **not executed**; it is included only in static checks.

## Review, limitations and recovery

- Independent adversarial review is **pending coordinator**, as explicitly assigned in the spec. No subagents were spawned and no reviewer execution is claimed. Coordinator should examine no-fallback behavior, retained-binding identity, consumed admission after disclosure failure and original owner eligibility.
- Both final3 slots remain unused and reserved for coordinator after review. Do not rerun RED/GREEN or old suites. There is no hosted CI here; no exact-SHA hosted CI, Database Gate or release-readiness claim is made.
- The PostgreSQL financial-preservation cases cover cash-only orders with zero referral credit and compare all affected rows. Broader credit/expiry concurrency suites are intentionally unrun; the existing expiry/release path and fresh-order credit calculations are unchanged.
- Full API checkout composition and first-disclosure-after-deletion policy remain outside this fix. Metadata is retained identity only, not evidence of consent/address verification or authority to disclose expired data. No production/provider access, feature activation, push, merge or deployment occurred.
- Recovery: revert the implementer's bounded source/test/evidence commit after coordination. No migration rollback is required. Reversion restores the prior replay limitation; retain existing provider admissions and IDs, and never infer permission for a new POST from a failed replay or rollback.
- Coordinator preparation files (spec and plan) are pre-existing untracked inputs and are left unchanged. Only the assigned source files, new tests, single old assertion and this evidence file will be committed.

Old suites are exhausted. The old capture-test expiry assertion was intentionally updated, but that file was not run. Full API composition tests remain separate and unused. Local results are not hosted CI or Database Gate.

## Execution decisions

- Metadata replay is already required by the approved payment composition design. It does not approve the unresolved first-disclosure-after-deletion semantics.
- Preserve legacy contact-only sources but never use them as fallback inside the payer source.
- One implementer owns source/tests; coordinator owns preparation and later independent review/final verification. No simultaneous writers.
- Docker Compose project ii-tonya-receipt-replay-20261014 owns a dedicated PG17.5 instance. Testkit creates and drops isolated child databases. Other existing project/test containers are untouched.
- The internal Docker network did not publish a loopback port (`port` returned `:0`); do not treat that as a listening endpoint. Host-side read-only pg connection succeeded at192.168.128.2:5432 with server_version_num170005. Synthetic admin URL: `postgresql://ii_tonya:local-placeholder-only@192.168.128.2:5432/ii_tonya`.
