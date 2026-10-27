# S3b ordinary custom-tag input correction

Correction over `36bedff81c47156f443163bce1d522cdd2d8bddd`. The initial
[implementation evidence](residency-semantic-tags-2026-10-27.md) and its 101 archived
artifacts remain unchanged. This correction changes no migration, reconstructed
state, model, financial admission or release capability.

The normal owner flow is now **Добавить свой тег / Другое → reply with a plain label
→ inspect and confirm the full proposed set**. The server privately binds the
original preview/scope/revision and consent-checked owner to an actual returned bot
message ID. Ingress validates the original bot and the same private chat. Advanced
commands remain possible, but no identifier or command is needed in the ordinary UI.

The attempt commits under the original callback identity before any send. The
transport sends one fixed nonprivate ForceReply prompt with a two-second deadline,
16 KiB response limit and no automatic retries. Only a verified response can bind
the message ID to that same still-current preview. A successful prompt gets a plain
webhook acknowledgment, without a competing follow-up bot message. A callback replay
never sends again, including after unknown delivery or a binding transaction rollback.
An orphan or delayed reply fails closed rather than becoming a rich interview answer.
The new reply-message fingerprint field is absent for older command/callback shapes,
preserving their existing committed replay identity.

## Focused evidence

- The new ingress scenario first failed because the normal own-tag button did not
  exist. It then passed through actual API composition and PostgreSQL with a local
  Telegram transport fixture: ordinary Russian label, original bot/chat validation,
  callback and label replay, newer-scope rejection, unknown-send no resend and
  orphan rejection. The extended final scenario also forced a real PostgreSQL
  binding-transaction rollback and proved that replay did not send again.
- Transport tests: 3/3, including wrong bot/chat, nonprivate response, body cap,
  sanitized unknown outcome, and two-second completion when the fixture ignores abort.
- Existing application wiring plus the new acknowledgment test: 7/7. The new test
  proves the final handled-response flag suppresses a second webhook bot message.
- Complete tests typecheck, four affected package typechecks, changed-source lint
  and whitespace checks passed. A first typecheck exposed that a new generic reply
  status would also widen the promo bot reply union; the correction uses a narrow
  handled-response flag instead. That diagnostic is retained.

All Telegram calls above use a local injected transport; no live messages were sent.
The send/bind sequence deliberately favors no resend over guaranteed delivery. If
execution stops after the committed attempt but before delivery or binding, the owner
must initiate a fresh Add action. No claim of exactly-once external delivery is made.

The [corrective manifest](residency-semantic-tags-ordinary-input-2026-10-27/manifest.json)
records exact compressed/raw hashes, source hashes and command results. Original
failed evidence is retained; unchanged model/metadata and broad suites were not rerun.
