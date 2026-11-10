# Selarti production composition gap

Read-only contract inspection:2026-10-12. No provider generation, authentication,
message send, task update or paid request was performed in this inspection.

## Authoritative provider contract inspected

Public collection:
https://docs.selarti.com/api/collections/38595362/2sAXqwZL69?segregateAuth=true&versionTag=latest

The collection was retrieved successfully by the local HTTP client. The separate
web browsing tool could not retrieve the documentation homepage; that failure is
not evidence that the API collection or service was unavailable.

- POST `https://selarti.com/api/1.1/wf/auth`: key input; the collection has no
  example response for this operation. Do not invent the token envelope from it.
  Subsequent authorized non-generation auth probe returned200/statussuccess and
  response.token:string, response.user_id:string, response.expires:number. See
  docs/test-evidence/production/2026-10-12-selarti-auth-probe.md; expiry units and
  company/task ownership remain unverified, and no token value was persisted.
- POST `/api/1.1/wf/send_message_external`: task_id, chat_id, message and optional
  message_type. The example documents operator/bot/user and user as the default.
  Provider examples were inspected with identifying values redacted.
- The send example returns status=success and a response.thread object including
  _id, task, chat_id and company. It does not return operation_id or an AI answer.
- GET `/api/1.1/wf/get_message`: thread_id, optional message_id, limit, offset and
  start_date. The example response.message collection includes _id, thread, text,
  message_type, message_status, task and company.
- POST `/api/1.1/wf/create_thread`: task_id and chat_id. No response example was
  supplied in the inspected collection.

## Concrete mismatch with current code

`packages/integrations/src/selarti/selarti-contract-adapter.ts` expects a successful
send body containing operation_id. It models inbound all_messages/client events,
not the documented external-send thread response. Plugging HTTP directly into
that contract would not establish actual assistant-response delivery.

`packages/worker/src/selarti-request-dispatcher.ts` accepts a trusted injected
transport but contains no production provider implementation. Its reconciliation
always returns still_unknown. Existing consent/cost admission must remain in front
of any real send.

`packages/application/src/selarti-response-service.ts` intentionally requires the
internal threadId to equal its sha256 requestId. A raw provider thread ID is a
different identifier. The bridge must durably bind request/dialogue/tenant to the
provider task/chat/thread and response message, then construct the existing
internal proposal. Do not weaken that validator to accept arbitrary provider IDs.

## Required integration evidence

Prove task/company ownership and the selected agent binding before enabling new
generation. A historical AGENT-STATUS entry reports the selected task still using
an older agent; that is a lead to recheck, not current provider evidence.

Persist send admission before external effects; preserve unknown outcomes without
blind regeneration. Distinguish thread acceptance from an actual assistant reply.
Accept only correctly bound provider response messages and preserve existing
copy, URL, privacy and deadline checks. Deliver and settle through the existing
idempotent internal flow. No unsigned webhook or provider text may grant balances.

Implement actual HTTP composition, durable request correlation and response
retrieval before activation. Existing injected ports and disabled flags are not
completed commercial assistance. This remains required by the full-product goal,
independently of the ongoing calendar implementation.

## Startup gate replaced

The unconditional `selarti_response_official_fixture_required` throw and the
hardcoded `selartiResponseIngress=false` projection were replaced by the
documented all-messages fixture. `SELARTI_RESPONSE_INGRESS_ENABLED=true` can
start when the shared secret, client bot key, and `SELARTI_TASK_ID` are set.
The webhook URL and flags are in
`docs/operations/selarti-all-messages-webhook.md`.

The bridge still builds the internal proposal (`threadId` equals the sha256
`requestId`) and keeps copy, URL, consent, and deadline checks. Raw Selarti
ids stay out of that validator. `B2_TELEGRAM_DISPATCH_ENABLED` remains a
separate default-off flag. `SELARTI_RESPONSE_POLL_ENABLED` is a separate
default-off `get_message` fallback and is not a substitute for the webhook.

Route and unit tests cover the documented payload, URL and bearer auth,
ignored user messages, one-chat correlation, message_id idempotency, and extra
fields. Proposal acceptance, consent, and Telegram dispatch stay on their
existing paths and flags.
