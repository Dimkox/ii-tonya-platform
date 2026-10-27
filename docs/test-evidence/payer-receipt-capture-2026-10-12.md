# Payer receipt capture implementation evidence

Baseline: d7ec2897462947e76bc4f258398b77817fe5900a.
Spec: `docs/superpowers/implementation-artifacts/spec-payer-receipt-capture.md`.
Context frontmatter is empty; spec and linked plan read fully.

## Execution ledger

- Identity confirmed: canonical remote, branch `codex/planerka-api`, matching baseline.
- RequireDocker preflight passed: Node 24.21.0, pnpm 11.9.0, Docker 29.9.0.
- Existing shared documentation changes are outside ownership and preserved.
- Ruling: spec forbids nested agents, commits, full suites and old tests; these
  explicit constraints override the generic build/executing-plans skill defaults.
- Migration journal ends at 49; index 50 is available at inspection.
- Capture authority is purchase-bound fiscal processing, not verified ownership.

## Test invocation ledger

Coordinator final3 on2026-10-13 after Euclid scoped acceptance, separate single-file
commands with synthetic isolated PostgreSQL admin URL (no provider calls):
- vault24786 exit0,3/3 at00:22:46UTC; budget3/3 exhausted.
- config29228 exit0,9/9 at00:22:48UTC; budget3/3 exhausted.
- Chrome14693 exit0,9/9 at00:22:49UTC; budget3/3 exhausted.
- API19491 exit0,3/3 at00:22:50UTC on final0050; budget3/3 exhausted.
- PostgreSQL16552 exit0,8/8 at00:22:51UTC including deterministic bound-expiry
  lock crossing; budget3/3 exhausted. All five final files32/32 passed.
Shared package rebuilds prohibited during this window; payment source writer
notified. Old exhausted files and repo guards not executed.

- Browser GREEN2 session20823 exit0,6/6 passed at00:07:28UTC. Four actual Chrome
  journeys: uncertain capture, uncertain checkout, logout during capture and
  unavailable capability; two client boundary tests. Budget2/3.

- API GREEN2 session23294 exit0,3/3 passed at00:07:10UTC. Real PG capture,
  receipt-required cookie+bearer routes, raw duplicate rejection, provider-absent
  zero-order behavior, selected generic contact source and bearer replay passed.
  Budget2/3. This also executes corrected SQL envelope validation successfully.
- Metadata regeneration61596 exit0 after SQL correction:122/808/42/74 inventory;
  snapshot d86b9da531403c7206c448a3d72e2d6f1f3cdef4bfe9faa304c49853aa1772af,
  SQL catalogue7bf8c1d2805f885a9a622a940f2a7aa374e915c9951c85306174a5d4f2dff2d6.

- PG GREEN2 session84960 exit1,1/8 passed at00:05:59UTC. Catalogue/provenance
  passed; first capture failed sanitized PAYER_RECEIPT_UNAVAILABLE, six following
  fixtures collided on PRO active interval. Budget2/3; no author rerun.
  Diagnose from owned PG logs/source, fix fixtures and implementation before review.
- Cause confirmed in owned PG logs: PostgreSQL regex rejects repetition bound400.
  SQL now separates length45..405 from alphabet regex; fixture shares one canonical
  PRO tariff instead of overlapping repeated inserts. Corrected PG cases UNRUN.
  Metadata regenerated from fresh SQL replay after this SQL correction.

- Config GREEN2 session17298 exit0,9/9 passed at00:05:50UTC. Budget2/3.

- Vault GREEN2 session91388 exit0,3/3 passed at00:05:36 UTC Oct13.
  Authenticated binding/key/ciphertext mutations and rotated keys exercised.
  Budget2/3, no author rerun.

- Browser/client RED1 session33457 exit1,0/2 passed, missing capture API.

- PG RED1 session6684: 0/3 passed, missing repository API assertions. Existing
  migrations replayed successfully on isolated PostgreSQL17.5; new behavior not
  yet exercised. Owned container `ii-tonya-payer-receipt-test-20261012`.

- API RED1 session57004: 0/2 passed, missing required-service API assertions;
  collection succeeded, financial behavior not yet exercised.

- Config RED1 session11453: 1/9 passed, eight expected config behavior failures.

- Tests typecheck passed before RED (`tsc --noEmit -p tsconfig.tests.json`).
- Vault RED1 session67110: 0/3 passed, missing exported capability assertions;
  collection succeeded. This proves missing API, not yet crypto behavior.

Each of five new files has RED1/GREEN2 allocated to
the implementer; final3 belongs to the coordinator after independent review.

## Correction handoff — 2026-10-13 (current)

Stable source is ready for coordinator rereview; this is NOT final acceptance.
This section supersedes the initial handoff's old-fixture remaining work and
fingerprints. No Vitest execution occurred during these corrections. All five new
files remain at2/3; final3 remains coordinator-only. Exhausted old files were edited
under explicit authorization, not rerun.

Exact correction scope:

- `apps/web/src/expert-campaign-view.ts`: authoritative expired/failed/settled
  outcomes clear the attempted-purchase freeze, permitting fresh calculation.
  Old checkout/contact remain disabled until a fresh quote; quoted and uncertain
  outcomes retain their replay freeze.
- `apps/web/src/payer-receipt-browser.test.ts`: actual browser scenarios now
  assert expired/failed/settled → fresh quote, fresh email capture, new quote/contact
  IDs and idempotency keys. Existing uncertain replay/logout assertions remain.
  Current file has nine tests; revised scenarios are unrun.
- `tests/integration/payer-receipt-capture.test.ts`: expiry fixtures reseal
  ciphertext with valid persisted AAD and explicitly authenticate it. The bound
  expiry test observes two blocked PostgreSQL selectors before expiry, crosses
  expiry using the database clock while holding the row, proves cleanup skips
  that now-eligible locked row, then checks source rejection, binding rejection,
  same-command ordinary checkout replay rejection, redaction and order retention.
  The overlapping binding call uses the actual transaction selector directly
  (not the whole checkout transaction's separate 250ms contention budget).
  This eight-case PG file remains unrun after corrections.
- `packages/integrations/src/yookassa/payer-receipt-vault.test.ts`: tampered
  identity/timestamp values are schema-valid and independently round-trip before
  testing original ciphertext rejection. Same-material key alias substitution
  exercises authenticated key ID; single-valued kind/basis schema rejection is
  distinguished from authenticated-data rejection.
- `apps/web/src/expert-campaign-browser.test.ts`: existing ordinary checkout
  fixture supplies email and mocks capture; exact checkout payload includes only
  opaque receiptContactId plus quote/key. Uncertain failure preserves retry freeze
  and existing no-payment-link/no-false-paid assertions.
- `tests/integration/expert-campaign-api.test.ts`: provider-absent fixture now
  supplies a structurally valid receiptContactId, preserving503 and zero-write
  assertions rather than weakening them to accept400.

Review-feedback and TDD guidance informed the targeted fixes; explicit no-test-run
instructions take precedence over rerunning revised regression tests.
Only the view is a runtime source change in this correction pass. No migration,
provider, authority, key configuration or deployment changes were made here.
Coordinator-owned repository guards and AGENT-STATUS were not edited by this writer.

Static verification, all exit0:

- Environment preflight: Node24.21.0 / pnpm11.9.0 accepted.
- Format/scoped lint session61363.
- Revised tests typecheck session71575 (`tsc --noEmit -p tsconfig.tests.json`).
- Web build session38907.
- Final six-file ESLint, web typecheck and `git diff --check`: session98222.

No active command handles remain. Historical GREEN2 results below are not
exact-current-source behavioral evidence. Next step is full independent rereview,
then coordinator-reserved final3. PG timing/locking assertions and revised browser
recovery remain executable but unverified; old fixture edits remain unrun under
their exhausted budgets. No claim of release readiness is made.

## Current file fingerprints (SHA-256)

Coordinator packaging check88104 found two JSON formatting failures; scoped
ESLint42699 passed. Formatting34296 preserved parsed JSON values exactly
(deepStrictEqual before/after), without SQL/runtime changes. Manifest references
updated to formatted byte hashes. Behavioral final3 predates this formatting-only
change; no further Vitest execution authorized or claimed.

```text
9cf9b337a6783b6e9715fe1fb908a45f7698403e3fd86e1ae34e15a18713db4a  apps/api/src/app.ts
266eb57012e6a259b3d0adb93cc07df01d760b5348fd87db4792b6d05b943569  apps/api/src/expert-campaign-composition.ts
bf079ab8ef0bac7ff1e6aa4c1123b2bcc625afd9be3fa9070a8a96e0846c10fa  apps/api/src/routes/expert-browser-session.ts
86e34a3b9812875885198ef668818c57a31bfd84dd95f1842f2d8151e2bd69bf  apps/api/src/routes/expert-referral.ts
02a309cdd6ba0a84359ea71e54c810f6f8a5dd932b1b52a7440e5ada67297bf7  apps/api/src/server.ts
f8f9f9b1a60a7d7f21f97d0f9426c40233f041b3310f05bafab1d924edd3b195  apps/web/src/expert-campaign-client.ts
c9c0fe6c7c0eb799435553693c381cada5a2250bd55cb6407e251db8c4a01f2e  apps/web/src/expert-campaign-view.ts
1c5df6d27c621b33459823a4484361bbba997c973ce851ab9ef8d64085ca7a8a  apps/worker/src/main.ts
604112074a67bef51dbeca4a0d23140b047c368e9aca7eb4a2a5a295601346eb  apps/worker/src/runtime.ts
6494b624776768a70f864804bb0a0af12e242bfae933568d745ff427e5185969  packages/application/src/index.ts
0f0ae64960c41984d1c66ccc12d84072ad9e6d08aa4ffbd69b57d7ae67a62a73  packages/config/src/env.ts
c4789472ed0a39f360f0924830dc5e55a2bc13fdfd434c25cf73aaf205ce384e  packages/contracts/src/expert-campaign-quotes.ts
8c0cab0db4feec8d3fd625b167133de58c86b83af7ced08d126c42fe24d5fa52  packages/db/src/index.ts
984b3797687aecde3338481a757bd6174d4be1413f763fdb0d6cf141d95249d3  packages/db/src/repositories/expert-campaign-order-repository.ts
4a2ea122d689b396d1100c9e4565593a23178ac4f51fcaa44f6eb6b220e379b7  packages/db/src/schema/index.ts
d2518f5b6a8b0004d7ee58f8100bc2cb3693254425bf7b1d3e3d91eaee2dcfe0  packages/integrations/src/index.ts
f3b17d92c2311b4f1e7477b36a2bf2e5bac8485e5df7e1bac7dc1d0ac21fb3a1  apps/api/src/payer-receipt-composition.ts
5a831a23521308ece9d170b67a039d81422d2cc95fd28a042947a8d21a1abc4a  apps/api/src/payer-receipt-production.test.ts
dd6417f0c8d65ec7b9a72827ca1bb99f4e98902be1ad2fa5d6109d9e7464949e  apps/web/src/payer-receipt-browser.test.ts
090593c35f21083f2ec845bc0fa327a18c9469a049d95653f8096e48da073092  packages/application/src/payer-receipt-capture-service.ts
c63cc75069b27359ae2ee20c9301d08efc53ea3968838b64026aef0adfe5c478  packages/application/src/payer-receipt-required-campaign-service.ts
dd1ed1dd6efd29b6995ca6d4294f0d21790293c9e47b7fa505278ef3277d8d91  packages/config/src/payer-receipt-config.test.ts
1628d74f9048a5c6b87e281a22fb7be4fc377b1d58ae0fe6c60008b316798c4e  packages/config/src/payer-receipt-config.ts
8b7d962e9465d42f804982ba78d8c29347df8dddac60059f91b560de7adaffad  packages/db/src/repositories/payer-receipt-contact-repository.ts
5bf5a14b9a218b0d39cd606efaac0ee4c3e311376ee70170ca573f0984e97986  packages/db/src/schema/payer-receipt-contacts.ts
6ad654da46447e339f1beca611dece1279d2b76a13a64672b7fd40cad5431abb  packages/integrations/src/yookassa/payer-receipt-source.ts
22b0288af697e7d8812641983f48b1aa89153ff80239e46a7eda089e0d963e6c  packages/integrations/src/yookassa/payer-receipt-vault.test.ts
189c14e45c2836ad9914719f937a0f3b966849d5933ac845b3a33dcf375134dd  packages/integrations/src/yookassa/payer-receipt-vault.ts
9a0b20ebeb809eb9abbadac29d4b8ed512f7e0fbdfb4bc7efb9e423265a4a1fe  tests/integration/payer-receipt-capture.test.ts
0ee9f8836bdd9a7f42c43fe2d6d30a1b76934c214db8502b18ebdb9673737ed4  .env.example
bfaeb278183a8fefe2c9bd14e094618a15de754a02be1fd11d25f4dfd5d04399  packages/db/migrations/0050_expert_receipt_contact_bindings.sql
3d5fd5e3027617af4402cf8d21aa32dc1b758b6af4d0ac153116df438c3269cb  packages/db/migrations/meta/_journal.json
f3bc44aa46cf4aa1f78c0682d5e1957fd62b961febb0d65440831b0fff33d1f3  packages/db/migrations/meta/0050_snapshot.json
6a5473befe28851655729a979cef7d595ff72fd17959a63515da857440417cfd  packages/db/migrations/state/0050_sql_objects.json
dcaaebcc1758173562505cce8315b6a276cf5490ffa2467d37b5e290c6626b45  packages/db/migrations/state/0050_manifest.json
f623c2c462d10e2a0089913f745b8bb65f1746300cd28ab1931cd016be8ab78c  apps/web/src/expert-campaign-browser.test.ts
c582790f09c44bdac0ddf540345d1dc1c79c1242645042b2ccea934170904dd2  tests/integration/expert-campaign-api.test.ts
```

## Acceptance status (initial handoff; corrections above supersede)

### Compatibility correction before stable handoff

Source inspection found the shared PG fixture resets all user-related tables with
TRUNCATE CASCADE. Removed two discretionary truncate guards from migration50 to
match existing campaign append-only table conventions; INSERT/UPDATE/DELETE
invariants remain enforced. Otherwise every old PG fixture reset would fail.
No old test was edited or run. Regenerated metadata after this SQL-only change;
prior API GREEN2 exercised identical row guards but not this final migration hash.

### Stable implementer handoff — 2026-10-13

Implementation is ready for coordinator review, NOT accepted or release-ready.
Every new test file is2/3. No author test allocation remains; all final3 runs
belong to the coordinator after full independent review.

Delivered: dedicated AES256GCM capture vault/key rotation, explicit config,
authenticated capture, immutable receipt-required order binding, browser+bearer
no-bypass composition, generic contact source, browser uncertainty/logout fencing,
and ordinary worker retention cleanup. Legacy consent source is unchanged.

Static evidence (exit0):

- Sequential builds: contracts61659, integrations46410, application67092,
  config62139, DB12814/58469/70838 (each later build followed source changes),
  API6870, app-worker10520, web50979.
- API typecheck39188, web+worker-library52935, DB+app-worker23380;
  tests54041 before RED, expanded17129/16255/38664, final20867 after corrections.
- Scoped ESLint40436, later modified-file format/lint/diff46085/32382;
  full owned-file formatting23748. No old/full/multi-path Vitest suite ran.
- Final migration reconstruction58319 exit0 on fresh isolated PostgreSQL17.5:
  122 tables,808 constraints,42 functions,72 triggers. All SQL replayed;
  fresh-directory introspection normalized against catalogue definitions.
  Prior reconstructions52845/61596 are superseded by this final SQL state.
- Coordinator relayed Euclid preliminary crypto/config source review without a
  concrete finding; no full-increment acceptance or review tests claimed.

Remaining coordinator work and limits:

1. Review the complete stable source, including post-lock expiry checks, capture
   replay, SQL relationships/redaction, browser uncertainty and ordinary wiring.
2. Run the reserved final3 for each new file. Corrected PG8-case file is UNRUN:
   race, cleanup and legacy replay acceptance remains unverified. API GREEN2
   proved capture/binding/source with the corrected regex, but preceded removal
   of the two extra truncate triggers; it is not exact-final-SQL test evidence.
3. Update owned repository guards: history-integrity newest49→50 at line194 and
   table inventory120→122 at line287; add50 to state-baseline iteration at line67.
   Both old guard files were deliberately neither edited nor rerun.
4. Reconcile exhausted old ordinary-flow fixtures without reintroducing bypass:
   `apps/web/src/expert-campaign-browser.test.ts:67` assumes checkout has only
   quote/key and supplies no receipt email; `tests/integration/expert-campaign-api.test.ts:392`
   expects503 for a contact-less ordinary checkout (new strict contract returns400).
   Existing synthetic legacy API/service entry points remain available. Old tests
   were not changed or consumed under the new-files-only ownership contract.
5. Deployment retention/key choices, external provider activation, exact release
   checks and production migration remain outside this handoff. No secret/provider
   call, activation, commit, push or production change occurred.

Owned synthetic PG container is retained for coordinator final3:
`ii-tonya-payer-receipt-test-20261012`, PostgreSQL17.5 on127.0.0.1:32768.
Use synthetic `II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://receipt_test:receipt_test@127.0.0.1:32768/receipt_test`
for the API and integration files; the testkit creates/drops isolated child DBs.
The ignored reconstruction script is under
`.superpowers/sdd/2026-10-12-payer-receipt-capture/reconstruct.ts`.
No command or test session remains running at handoff.

## Initial handoff fingerprints (superseded)

```text
9cf9b337a6783b6e9715fe1fb908a45f7698403e3fd86e1ae34e15a18713db4a  apps/api/src/app.ts
266eb57012e6a259b3d0adb93cc07df01d760b5348fd87db4792b6d05b943569  apps/api/src/expert-campaign-composition.ts
bf079ab8ef0bac7ff1e6aa4c1123b2bcc625afd9be3fa9070a8a96e0846c10fa  apps/api/src/routes/expert-browser-session.ts
86e34a3b9812875885198ef668818c57a31bfd84dd95f1842f2d8151e2bd69bf  apps/api/src/routes/expert-referral.ts
02a309cdd6ba0a84359ea71e54c810f6f8a5dd932b1b52a7440e5ada67297bf7  apps/api/src/server.ts
f8f9f9b1a60a7d7f21f97d0f9426c40233f041b3310f05bafab1d924edd3b195  apps/web/src/expert-campaign-client.ts
8635c2f4fc10898c45edd127bedf04df03057a756477fe50db24b73322c0b2cd  apps/web/src/expert-campaign-view.ts
1c5df6d27c621b33459823a4484361bbba997c973ce851ab9ef8d64085ca7a8a  apps/worker/src/main.ts
604112074a67bef51dbeca4a0d23140b047c368e9aca7eb4a2a5a295601346eb  apps/worker/src/runtime.ts
6494b624776768a70f864804bb0a0af12e242bfae933568d745ff427e5185969  packages/application/src/index.ts
0f0ae64960c41984d1c66ccc12d84072ad9e6d08aa4ffbd69b57d7ae67a62a73  packages/config/src/env.ts
c4789472ed0a39f360f0924830dc5e55a2bc13fdfd434c25cf73aaf205ce384e  packages/contracts/src/expert-campaign-quotes.ts
8c0cab0db4feec8d3fd625b167133de58c86b83af7ced08d126c42fe24d5fa52  packages/db/src/index.ts
984b3797687aecde3338481a757bd6174d4be1413f763fdb0d6cf141d95249d3  packages/db/src/repositories/expert-campaign-order-repository.ts
4a2ea122d689b396d1100c9e4565593a23178ac4f51fcaa44f6eb6b220e379b7  packages/db/src/schema/index.ts
d2518f5b6a8b0004d7ee58f8100bc2cb3693254425bf7b1d3e3d91eaee2dcfe0  packages/integrations/src/index.ts
f3b17d92c2311b4f1e7477b36a2bf2e5bac8485e5df7e1bac7dc1d0ac21fb3a1  apps/api/src/payer-receipt-composition.ts
5a831a23521308ece9d170b67a039d81422d2cc95fd28a042947a8d21a1abc4a  apps/api/src/payer-receipt-production.test.ts
39fd929d05d15a55ee295a22d36a1b89b6931db05b3940272c450b71f41b84a9  apps/web/src/payer-receipt-browser.test.ts
090593c35f21083f2ec845bc0fa327a18c9469a049d95653f8096e48da073092  packages/application/src/payer-receipt-capture-service.ts
c63cc75069b27359ae2ee20c9301d08efc53ea3968838b64026aef0adfe5c478  packages/application/src/payer-receipt-required-campaign-service.ts
dd1ed1dd6efd29b6995ca6d4294f0d21790293c9e47b7fa505278ef3277d8d91  packages/config/src/payer-receipt-config.test.ts
1628d74f9048a5c6b87e281a22fb7be4fc377b1d58ae0fe6c60008b316798c4e  packages/config/src/payer-receipt-config.ts
8b7d962e9465d42f804982ba78d8c29347df8dddac60059f91b560de7adaffad  packages/db/src/repositories/payer-receipt-contact-repository.ts
5bf5a14b9a218b0d39cd606efaac0ee4c3e311376ee70170ca573f0984e97986  packages/db/src/schema/payer-receipt-contacts.ts
6ad654da46447e339f1beca611dece1279d2b76a13a64672b7fd40cad5431abb  packages/integrations/src/yookassa/payer-receipt-source.ts
2e5fe6380751bb187d84e7e15039c0eca6bf6f3bbec8723d4409c79c4230c2bd  packages/integrations/src/yookassa/payer-receipt-vault.test.ts
189c14e45c2836ad9914719f937a0f3b966849d5933ac845b3a33dcf375134dd  packages/integrations/src/yookassa/payer-receipt-vault.ts
bf1706307f54e863e457c6b5e9e440c178d3fdf3662b412f929c7847785e4b97  tests/integration/payer-receipt-capture.test.ts
0ee9f8836bdd9a7f42c43fe2d6d30a1b76934c214db8502b18ebdb9673737ed4  .env.example
bfaeb278183a8fefe2c9bd14e094618a15de754a02be1fd11d25f4dfd5d04399  packages/db/migrations/0050_expert_receipt_contact_bindings.sql
3d5fd5e3027617af4402cf8d21aa32dc1b758b6af4d0ac153116df438c3269cb  packages/db/migrations/meta/_journal.json
f1f5bf259842296bb4a61844af649987b8113ab311a53726910cbd34349c4fdc  packages/db/migrations/meta/0050_snapshot.json
d8452989805f4a17defb50f5a63a74a89343b1e68f9fecc750542d32306af5d0  packages/db/migrations/state/0050_sql_objects.json
7c8295d47c9b235da4f7f3eafbb3ad6922001fa83728528e2dafc8b772020353  packages/db/migrations/state/0050_manifest.json
```
