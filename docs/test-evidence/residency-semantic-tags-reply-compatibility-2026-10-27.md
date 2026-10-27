# S3b ordinary interview reply compatibility correction

Bounded follow-up over `79b5d2334b7261a94621ecac15142df1b7053dab` (implementation
`4a8bd1ac1a11aadd140cd5a287b7f89135083e9b` plus coordinator documents).
The initial 101-artifact archive and first correction's 31-artifact archive remain
unchanged.

Root review found a real compatibility defect: every Telegram reply was classified
as custom-tag input, including ordinary interview replies and media answers. The
new regression reproduced this as HTTP 503 for a normal reply to an interview
question. Media and replies to the owner's own messages were also incorrectly
rejected by the overly broad classification.

Ingress now recognizes only the exact fixed tag-invitation text, shared with the
prompt sender, before applying the original bot/private-chat/message validation
and custom-tag routing. Unrelated replies retain the existing interview path and
original request fingerprint. Actual tag invitations, including orphan or stale
ones, remain on the fail-closed tag path.

Focused actual ingress/API composition/PostgreSQL proof passed **2/2 scenarios**:

- Ordinary text, photo and document replies saved as interview answers; replying
  to the owner's own message also saved. Each ran with tags enabled and disabled.
- Existing ordinary custom-tag flow remained green, including callback/label replay,
  stale scope, wrong bot/chat, unknown-send no resend, orphan rejection and forced
  PostgreSQL binding-transaction rollback without resend.

All Telegram transports were local fixtures. Complete tests typecheck, API typecheck,
changed-source lint and whitespace checks passed. No unchanged broad suite, model,
metadata reconstruction or state test was rerun. No migration, model or provider
activation changed.

The [append-only corrective archive](residency-semantic-tags-reply-compatibility-2026-10-27/manifest.json)
retains the failing and passing logs, command results, exact test source and hashes.
