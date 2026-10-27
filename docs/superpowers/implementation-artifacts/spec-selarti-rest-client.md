---
title: 'Selarti provider-native REST client'
type: 'feature'
created: '2026-10-12'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '690797db64fd80aa1aeccea8003543de470d8c16'
context: []
---

<frozen-after-approval reason="owner-delegated development scope; human product acceptance remains separate">

## Intent

**Problem:** The existing Selarti adapter expects operation_id, but the official
external-send API returns a thread. It cannot directly support real assistant replies.
**Approach:** Add a provider-native HTTP client for external send and message reads,
with strict task/company/chat/thread binding and bounded transport. This is a
prerequisite for the durable response bridge, not completed AI delivery or activation.

## Boundaries & Constraints

**Always:** fixed HTTPS selarti.com origin; authenticated bearer supplied by trusted
server composition; no logging of credentials, bodies or identifiers. Preserve
existing adapter, consent/cost checks, response validator and disabled startup guards.
No automatic POST retry. Outcome uncertainty is explicit and never called success.
**Ask First:** live message generation, paid API calls, credential rotation, task/agent
changes, or additional runs of exhausted tests. Read-only public docs need no request.
**Never:** infer an AI answer from thread acceptance, treat provider thread ID as
internal requestId, use real client data in tests, change runtime flags, database,
worker/API composition or other implementer's files. Catalogue remains empty.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| External send | Valid trusted task/company/chat and text | One POST send_message_external with message_type=user; accepted only if returned thread binds all three | No invented operation ID |
| Foreign acceptance | Wrong task/company/chat or missing thread ID | Unknown send outcome, never accepted | No retry |
| Message read | Bound thread/task/company; bounded limit and offset | GET get_message; normalize only required fields, keep message_type/status without inferring bot completion | Foreign/malformed row rejects entire page |
| Input error | Empty/control IDs, oversized text, invalid paging or bearer | No HTTP invocation | Fixed safe error code |
| POST error | Timeout,5xx,malformed JSON,redirect,oversized/stalled body | Unknown | No resend; raw response not exposed |
| GET error | Same failures | Read failure | No hidden retries |
| Definite pre-write | Injected TransportFailure before_write | Not applied for POST | Caller owns bounded retry policy |
| Resource bounds | Slow headers/body or unbounded/empty chunks | Total15s deadline and64KiB byte limit enforced while reading | Abort/cancel; safe error |

</frozen-after-approval>

## Code Map

- `packages/integrations/src/selarti/selarti-contract-adapter.ts`: legacy operation_id
  contract; leave unchanged. Its429 treatment is opt-in, not provider proof here.
- `packages/worker/src/selarti-request-dispatcher.ts`: trusted injected request port;
  durable correlation/composition is later work, not owned by this client.
- `packages/application/src/selarti-response-service.ts`: internal proposal validator;
  retain sha256 request/thread rule and copy/URL checks.
- `packages/integrations/src/planerka/client.ts`: bounded HTTP pattern reference;
  neither source nor exhausted tests may be changed/run for this task.
- `docs/operations/2026-10-12-selarti-composition-gap.md`: provider evidence and
  permanently disabled response-ingress gate. Do not remove gate in this increment.
- Public collection inspected2026-10-12:
  https://docs.selarti.com/api/collections/38595362/2sAXqwZL69?segregateAuth=true&versionTag=latest.
  POST `/api/1.1/wf/send_message_external`: response `{status,response:{thread}}`,
  thread fields `_id,task,chat_id,company`. GET `/api/1.1/wf/get_message`: response
  `{status,response:{message:[]}}`; rows `_id,thread,task,company,text,message_type,
  message_status`. Extra provider metadata is ignored, never returned/logged.

## Tasks & Acceptance

**Execution:**
- [x] Create `packages/integrations/src/selarti/rest-client.test.ts` first. Cover
  every matrix row with synthetic responses and an injected fetch; count all runs.
- [x] Create `packages/integrations/src/selarti/rest-client.ts`: constructor accepts
  bearer token and optional injected fetch; methods sendExternal({taskId,companyId,
  chatId,text}) and getMessages({taskId,companyId,threadId,limit,offset}).
  ID strings bounded1..256 and no control characters; text1..4096; limit1..100,
  offset0..10000 integers. Token nonempty without whitespace/control characters.
- [x] Return discriminated send outcomes accepted(threadId), not_applied or unknown;
  reads return validated page or safe error. Preserve provider message type/status
  as bounded strings for later trusted interpretation. Do not claim pagination
  exhaustion, ordering, or response-request correlation from a page alone.
- [x] Export through `packages/integrations/src/index.ts`; document that auth-token
  acquisition/refresh and durable polling bridge remain required. No new dependency.

**Acceptance Criteria:**
- Given foreign thread/message ownership, when parsing succeeds structurally, then
  binding validation still rejects it and no answer is accepted by the platform.
- Given an ambiguous POST, when method returns, then exactly one call occurred and
  its outcome cannot be confused with a definite rejection or AI response.
- Given existing disabled application configuration, when this library is built,
  then no provider flag or production factory is changed.

## Spec Change Log

- 2026-10-12: Implemented client, synthetic tests, exports and runbook. Frozen
  requirements unchanged. Focused test budget 3/3 consumed: run 1 failed collection
  (missing implementation, not behavioral RED); run 2 passed 42/42; run 3 passed
  47/47. Independent review remains pending; no reviewer tool is available in this
  session. No commit, live API operation, runtime integration or activation.

## Design Notes

Prefer a separate native client over weakening the old operation_id schema or
fabricating that field. Trusted bridge will later persist request/thread/message
correlation and pass a normalized internal proposal through current safeguards.
Bearer authentication is an injected server dependency; the public auth operation
has no documented response example, so token acquisition is not guessed here.
Unknown HTTP status, including429 without provider proof of non-application, stays
unknown for POST. Read failure does not authorize a repeated generation request.

## Verification

- `pnpm exec vitest run packages/integrations/src/selarti/rest-client.test.ts`:
  focused RED then GREEN, maximum3 invocations; no broad suite/multi-path command.
- `pnpm --filter @ii-tonya/integrations typecheck`: exit0.
- Scoped ESLint/Prettier and `git diff --check`: no failures.
- Independent adversarial review before commit or runtime integration. This draft
  Coordinator completed delegated design review after notification T1 handoff;
  this is the next sequential implementation slice, not a live activation.
