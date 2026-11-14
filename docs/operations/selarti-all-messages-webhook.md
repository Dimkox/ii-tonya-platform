# Selarti all-messages response webhook

The live path today is the Selarti Telegram channel on `@ii_tonya_expert_bot`,
task `ii-tonya-expert`. This webhook is the alternative API path. It stays
off until `SELARTI_RESPONSE_INGRESS_ENABLED=true`. The default is false.

To enable it, put the shared secret in the URL. Selarti's form has no header
field. Add an integration of type «Another», webhook type «All messages»,
and paste this URL with the real shared secret in place of `<SECRET>`:

```text
https://ii-tonya.ru/v1/webhooks/selarti/responses/<SECRET>
```

`https://ii-tonya.ru/v1/webhooks/selarti/responses?token=<SECRET>` is also
accepted. The secret is `SELARTI_RESPONSE_SHARED_SECRET`: 32–256 characters
from `[A-Za-z0-9_-]`, not a placeholder. `Authorization: Bearer <SECRET>`
still works for callers that can set a header. Selarti's form cannot.

When this alternative is turned on, the Selarti task is type «Web» with a
channel of type «Page messenger», and the integration above is type
«Another» / «All messages». Copy that task's id into `SELARTI_TASK_ID`.
Outbound user messages use
`POST https://selarti.com/api/1.1/wf/send_message_external` with that `task_id`
and `chat_id` equal to the dialogue `external_chat_id`. Selarti then POSTs
`wh_type=all_messages`. `external_chat_id` is our `chat_id`.

## Environment

Enable response intake without sending Telegram replies:

```text
SELARTI_RESPONSE_INGRESS_ENABLED=true
SELARTI_RESPONSE_SHARED_SECRET=<SECRET>
SELARTI_TASK_ID=<task id copied from Selarti>
CLIENT_TELEGRAM_BOT_KEY=<existing client bot key>
B2_TELEGRAM_DISPATCH_ENABLED=false
SELARTI_RESPONSE_POLL_ENABLED=false
```

`SELARTI_RESPONSE_INGRESS_ENABLED` accepts the documented all-messages body.
Unknown extra fields are ignored. `user` messages return 200 and are not
turned into proposals. `bot` and `operator` messages are matched to one
pending `selarti.request.v1` row for that chat and task, then passed to the
existing proposal validator as an internal `{version, requestId, dialogueId,
threadId: requestId, text}` body. Raw Selarti message, thread, and task ids
do not enter that validator. Repeating the same `message_id` is a duplicate.
Telegram delivery of the accepted text stays behind
`B2_TELEGRAM_DISPATCH_ENABLED` and stays off until that flag is turned on by
itself.

Optional fallback, default off:

```text
SELARTI_RESPONSE_POLL_ENABLED=true
SELARTI_ENABLED=true
SELARTI_API_KEY=<server-only key>
SELARTI_COMPANY_ID=<company id>
SELARTI_AI_ID=<ai id>
SELARTI_WEBHOOK_SECRET=<existing live-adapter secret>
```

The poller calls `get_message` for pending requests whose send stored a
provider thread id. The clock it compares is the `started` delivery attempt
written before the outbound HTTP call, not the later row that stores the
thread id. It ingests a bot or operator row when that row's `Created Date`
is in the same second as that send start, or later, and the thread has
exactly one open request across the whole pending set. A page without dates,
an older reply, or two open requests on one thread is skipped. It does not
run unless the flag is true, and it does not turn Telegram dispatch on.
Leave it false until the webhook path has been checked against a
non-production task.

## Rollback

Set `SELARTI_RESPONSE_INGRESS_ENABLED=false` and
`SELARTI_RESPONSE_POLL_ENABLED=false`. Restart the API and worker. In-flight
proposals already accepted remain in `selarti_response_proposals`; no balances
move on this path. Do not delete webhook inbox rows to "replay" a message:
the proposal row is the delivery authority.
