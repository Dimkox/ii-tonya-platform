# Local semantic tag recommendations

S3b extends the existing paid private work-bot interview. It changes no financial
admission, publication, provider flag, hosting limit or production configuration.

## Owner workflow

- `/tags` retains the full paged catalogue. Its count includes normalized unique
  selections across the profile and all complete/staged services.
- `/tags_recommend профиль`, `/tags_recommend услуга 1`,
  `/tags_recommend текущая` and `/tags_recommend ожидающая 1` name the precise
  replacement scope. The current staged service can receive tags before it is complete.
- The preview shows the complete proposed replacement, including retained choices,
  with removable preselection. At most15 newly recommended candidates include
  format metadata and explicitly attributed method associations. They are advice,
  never evidence of clinical qualifications. Existing selections remain unchanged
  until the owner confirms the displayed set.
- “Добавить свой тег / Другое” opens an ordinary Russian ForceReply field. The owner
  replies with one label, sees it in the full proposed set, then confirms the set.
  The private preview binds the original attempt to the returned bot message ID;
  ingress first recognizes the fixed tag invitation text, then requires that exact
  bot message in the same private chat. Unrelated replies retain ordinary text,
  photo and document interview intake, including when tags are disabled. No token,
  identifier or command syntax is required in the normal flow. The advanced
  `/tags_custom <preview-token> <label>` command remains supported.
  BLOCKER refuses it. WARNING, including `#приворот`, remains visible to the
  manager. Unknown labels are pending until a fresh support/security manager decides
  them with a reason for the exact current rich revision. No custom label is inserted
  into the global catalogue. Any later revision requires a new decision.
- Changes invalidate owner/manager confirmation; the immutable old live version is
  preserved. Older approved profiles with more than20 tags remain intact. A new
  version may only remove a strict subset until it reaches20; all additions and
  whole-card confirmation/review remain blocked above20. The owner must deselect any
  additional format recommendation before confirming such a reduction.
- Newly inactive or newly blocked selections can be removed one scope at a time.
  Repair compares scoped occurrences, so removing the first occurrence of a repeated
  obsolete tag is progress even if the unique count stays unchanged above 20.
  Repair cannot add or move selections, modify unrelated answers, or authorize
  another blocked field. Whole-card confirmation and approval still require valid
  selections. Catalogue deletion validates its original row separately from the
  accompanying revision-only invalidation.

A stale preview, changed catalogue or safety publication, or changed semantic model
cannot commit. Callback tokens rotate on each edit. Original Telegram update identity
is checked before allocating a preview or calling the helper. Repeat acknowledgments
still recheck ownership/consent; erasure deletes private previews and decisions.

The ordinary-input attempt commits before a single bounded Telegram prompt send.
Only a verified returned message ID can then bind to the still-current attempt.
The prompt contains fixed nonprivate text; transport has a two-second deadline and
16 KiB response cap. Unknown delivery, process interruption or binding rollback
leaves no accepted reply binding. Repeating that original callback never sends
again; the owner can explicitly request a fresh invitation. Orphan/stale replies
cannot fall through into interview answers. A successful send gets only a webhook
acknowledgment, so no second bot message competes with the ForceReply field.

## Provisioned helper

The optional `RESIDENT_SEMANTIC_SOCKET` connects to an already provisioned Unix socket.
The API never launches processes/containers and receives no Docker socket. Missing or
invalid capability gives explicit exact-only/manual selection, with no fabricated
semantic score and no new paid-activation gate.

`compose.semantic-tags.yaml` provisions one UID1000 process with no network, read-only
root, dropped capabilities, no-new-privileges, one CPU,320MiB memory/swap ceiling,
16PIDs and8MiB temporary storage. The existing256MiB Node ceiling is unchanged.
Socket directory must be owned by UID1000 and mode0700, shared read-only with Node.
Only the helper receives a read-only model mount. Deployment/provisioning and model
redistribution are separate from this local proof.

Build-time dependencies are hash pinned in `runtime/semantic-tags/requirements.txt`.
`assets.json` records exact installed Python/dictionary/numpy file hashes; startup
verifies them and package versions before loading the model. The Docker base image
is digest pinned. No runtime model/package download exists.

Selected model: publisher's Navec `navec_news_v1_1B_250K_300d_100q.tar`,26,634,240bytes,
SHA256 `f07270833d78523edc5781538d67038e95b43975e4a7ae757c693b687f9cbfca`.
Publisher source: <https://storage.yandexcloud.net/natasha-navec/packs/navec_news_v1_1B_250K_300d_100q.tar>.
[The publisher README](https://github.com/natasha/navec) describes the news corpus and
300-dimensional quantized vectors. [Its repository license](https://github.com/natasha/navec/blob/master/LICENSE)
is MIT; no separate model/corpus-specific license grant was identified in that
README. Do not present a local digest as an upstream signature or a license opinion.
Retain package license notices in the built image; exact package license metadata
is recorded in `assets.json`. Model bytes are deliberately outside Git.

Russian processing uses pinned Razdel and PyMorphy3 dictionary bytes. Case,ё,
whitespace,# and underscores normalize consistently. Exact words/phrases and approved
synonyms/morphology score100; real finite cosine strictly above0.85 scores50.
Associations have a separate kind and score0, rank below exact/semantic hits and name
source provenance. A specialized phrase is not semantically represented when any
meaningful token lacks a vector. Negated clauses and lone name/place clauses are
conservatively omitted. This deliberately trades recall for transparent manual choice.

Bounds:16,000characters,512tokens,128clauses,40tokens/semantic clause; at most512public
catalogue rows/32terms each. The Node adapter caps wire bodies at10MB, recommendation
round-trips at400ms and preparation/restore at5s. The helper is single-request with
queue4, a5s request alarm, and no private lemma/query cache. It precomputes public
terms at startup and registry changes. Model/tokenizer/normalization/source/assets
and actual taxonomy/synonym/weight/provenance bytes identify each generation.

`tag_embeddings_cache` is one bounded PostgreSQL row holding actual validated300d
unit vectors and generation/model/taxonomy identity, not metadata alone. A complete
replacement is published transactionally. Catalogue share lock and cache advisory
lock prevent mixed generations; a restarted/stale helper validates and restores the
published cache. Corrupt or mismatched cache is never used for semantic claims.

## Staff and recovery

The existing protected card interface shows every current custom decision and reason.
Its mutations retain current session/MFA/revision fencing. The JSON export action is
`GET /v1/admin/expert-cards/catalogue-export`; the existing `catalog_admin` assignment
is required from current database session authority, including fresh MFA. It returns
only the bounded public catalogue, active/inactive flags, synonyms, weights and
provenance. It includes no resident private content. Both UI operations discard
responses from an obsolete logged-out session.

To recover a helper failure, keep exact/manual selection available, re-provision the
pinned artifacts outside Git, restart the dedicated helper and restart/initialize the
API public cache. Registry edits trigger a complete rebuild on the next request.
Never edit old migrations or rewrite immutable profile versions. Add migration0069
and its journal entry together; `drizzle-kit generate` remains forbidden. The additive
state snapshot/supplement was reconstructed from hand SQL on isolated PostgreSQL17.5.

Integration tests do not write browser fixtures by default. To regenerate the local
synthetic browser witness explicitly, set `II_TONYA_SEMANTIC_BROWSER_FIXTURE` to a
file in an existing temporary directory. The archived browser witness includes its
original fixture; normal tests require no `.superpowers` evidence directory.
