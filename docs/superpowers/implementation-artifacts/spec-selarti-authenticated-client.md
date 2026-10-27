---
title: "Selarti authenticated and ownership-bound REST client"
type: "feature"
created: "2026-10-13"
status: "done"
review_loop_iteration: 0
baseline_commit: "f0e125f4441d9bb5858b44ff5f3b6da4495ae34f"
context: []
---

<frozen-after-approval reason="owner explicitly delegated implementation and technical choices; provider activation and customer acceptance remain separate">

## Intent

**Problem:** The existing Selarti REST client requires a manually supplied bearer.
The configured task currently selects a different AI. Real assistant composition
needs automatic authentication and verified ownership before disclosing text.
**Approach:** Add an asynchronous factory that authenticates the configured API key,
verifies company/task/AI binding, and returns a client restricted to that binding.
This completes this prerequisite, not the still-missing durable answer bridge.

## Boundaries & Constraints

**Always:** fixed HTTPS `selarti.com/api/1.1/wf/`; verified TLS, redirect rejection,
one total 15-second acquisition deadline and 64KiB per response, including streamed
or stalled bodies. No credential/body/identifier logging or raw exception leakage.
Capture validated configuration before the first await. Obtain a fresh bearer on
each factory call; do not guess `expires` units or persist/cache tokens. Keep
existing send/read validation, unknown outcomes and no automatic POST retry.
**Ask First:** live generation, paid calls, provider mutations, exhausted test reruns.
**Never:** change provider task/AI, worker/config/DB flags, public response ingress,
cost/consent authority or existing REST implementation/tests. A ready result proves
only authenticated binding, not subscription, billing, response causality or delivery.

## I/O & Edge-Case Matrix

| Scenario         | Input / State                                                                         | Expected Output / Behavior                                                     | Error Handling                                |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| Valid binding    | Auth active company, exact task and AI owned by it; task.AI matches                   | Ready bound client; existing REST send/read use only the verified task/company | No credentials returned                       |
| Wrong binding    | Foreign company, wrong task/AI, missing or duplicate selected rows, lowercase ai only | Unavailable; zero message send/read calls                                      | Fixed safe reason                             |
| Auth failure     | Non-success, missing/invalid token or missing active company                          | Unavailable; no task/AI/message request                                        | No raw body/errors                            |
| Invalid config   | Missing/control/oversized IDs or empty/whitespace/control key                         | No network request                                                             | Safe invalid-input result                     |
| Resource failure | Redirect, non-200, oversized/invalid UTF8/JSON, stalled headers/body, endless chunks  | Unavailable within total deadline; cancel readers, including late body         | No retry                                      |
| Bound operation  | Caller supplies foreign task/company extras or mutates original config                | Original verified binding remains authoritative                                | Existing strict result semantics              |
| Send ambiguity   | Valid acquisition then send timeout/401/5xx                                           | Existing unknown result; exactly one send                                      | Never reauthenticate and resend automatically |

</frozen-after-approval>

## Code Map

- Work ONLY in `.worktrees/review-2a3484e6-20261013`, branch
  `codex/selarti-authenticated-client-20261013`; canonical repository and base above.
- `packages/integrations/src/selarti/rest-client.ts`: real bounded transport and
  ownership validation; wrap this class, do not mock or modify it.
- Official public collection documents POST `auth` body `{key}`, bearer GET
  `get_task?company_id&task_id`, GET `get_ai?company_id&ai_id`.
  Provider URL: `https://docs.selarti.com/api/collections/38595362/2sAXqwZL69?segregateAuth=true&versionTag=latest`.
- Coordinator non-generation probe96815 on2026-10-13 confirmed auth response
  `{status:'success',response:{user:{active_company},token,user_id,expires}}`;
  GET task `{status:'success',response:{task:[{_id,company,AI,...}]}}`;
  GET AI `{status:'success',response:{ai:[{_id,company,...}]}}`. All HTTP200.
  Company ownership matched; exact uppercase task.AI did not match configured AI.
- `apps/worker/src/client-async-composition.ts`: Telegram already composed. Do not
  duplicate it or claim this factory supplies missing durable Selarti correlation.

## Tasks & Acceptance

**Execution:**

- [x] `packages/integrations/src/selarti/authenticated-client.test.ts`: tests first;
      synthetic fetch boundary only, exercise actual existing REST class. Cover matrix.
- [x] `packages/integrations/src/selarti/authenticated-client.ts`: export
      `createAuthenticatedSelartiClient({apiKey,companyId,taskId,aiId,fetch?})` returning
      `{kind:'ready',client}` or `{kind:'unavailable',code}`. Ready client exposes
      `sendExternal({chatId,text})` and `getMessages({threadId,limit,offset})`; tokens
      and unrestricted underlying client stay private. IDs1..256 non-control and
      nonblank, API key1..4096 without whitespace/control. Selected task/AI rows must
      each be unique, have the exact requested ID and company; task.AI must match.
- [x] `packages/integrations/src/index.ts`: export the new factory and public types.
- [x] `docs/runbooks/selarti-rest-client.md`: describe acquisition, binding limits,
      fresh-token lifecycle and unfinished ordinary worker/polling integration.
- [x] `docs/test-evidence/selarti-authenticated-client-2026-10-13.md`: exact commands,
      outcomes, test counts and limitations. Update this spec task status only.

**Acceptance Criteria:**

- Given matching synthetic auth/task/AI responses, when a caller sends or reads,
  then the real REST client uses the verified binding and never exposes the token.
- Given foreign or unverified ownership, when acquiring the client, then no text
  can be sent, even if the original mutable options change during acquisition.
- Given an ambiguous send, when its result returns, then it remains unknown and
  neither login nor send is silently retried.

## Spec Change Log

## Verification

Author owns exactly runs1(RED)/2(GREEN) of ONLY the new focused test file;
coordinator reserves run3 after independent review. No full/multi-path suite,
old tests or pre-push gate (they rerun exhausted files). Preserve failed output.
Use `pnpm exec vitest run packages/integrations/src/selarti/authenticated-client.test.ts`.
Run integrations/tests typechecks, scoped ESLint/Prettier and `git diff --check`.
No nested agents, commits, pushes, secret reads, provider calls or production ops
by implementer. Coordinator owns release work and final independent verification.

## Coordinator closure

Final run33379 at11:27:59 UTC passed123/123, exit0, after independent review and
pre-delegation exception correction. Integrations/tests typechecks, scoped ESLint,
complete changed-file formatting and whitespace checks passed. New-file budget3/3
is consumed. Full suite, old exhausted files, hosted CI and Database Gate were not
run; no such release evidence is claimed. This status closes only the factory
implementation. Ordinary worker/polling composition and the commercial goal stay
open. Live non-generation acquisition returned binding_unverified; configured
company has only one task and no task with the configured AI.

## Suggested Review Order

- Start with captured configuration and the fresh authenticated-client result.
  [authenticated-client.ts:96](../../../packages/integrations/src/selarti/authenticated-client.ts#L96)

- Verify total-deadline cleanup and bounded response decoding.
  [authenticated-client.ts:122](../../../packages/integrations/src/selarti/authenticated-client.ts#L122)

- Check exact company, task and AI ownership before creating the restricted client.
  [authenticated-client.ts:178](../../../packages/integrations/src/selarti/authenticated-client.ts#L178)

- Keep invalid-input handling strictly before operations that can send text.
  [authenticated-client.ts:218](../../../packages/integrations/src/selarti/authenticated-client.ts#L218)

- Review snapshot limits and the still-missing response bridge.
  [selarti-rest-client.md:36](../../runbooks/selarti-rest-client.md#L36)

- Inspect real-stream and bound-delegation regression coverage.
  [authenticated-client.test.ts:75](../../../packages/integrations/src/selarti/authenticated-client.test.ts#L75)

- Compare historical and final verification, not author results alone.
  [selarti-authenticated-client-2026-10-13.md:1](../../test-evidence/selarti-authenticated-client-2026-10-13.md#L1)
