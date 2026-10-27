# S3 read-only preparation

Latest owner sources control: resident-onboarding.txt, phase1-final-comprehensive.txt,
sales-technical-final-correction.txt, hashtaxonomy-v2.txt. Safety/source S1 and
private-job S2b remain prerequisites. Do not restart earlier blocks.

Existing seams inspected:

- expert_card_drafts is one row per user/application, four-state collecting/review/
  changes_requested/approved, revision and approved review pointer. Existing immutable
  reviews/published payload are only displayName/profession/city/summary. Rich private
  profile/services must be additive; don't put private contacts/media in this payload.
- PostgresExpertCardRepository.ownerAction already serializes consent/current work
  bot/paidApplication/idempotency and revision. Existing addEntry refuses approved
  drafts and wipes public payload. New versioned update flow must explicitly retain
  current reviewed/published version until replacement passes owner/safety/manager.
- submitDraft currently permits one raw entry and no complete owner preview. New
  rich-profile admission must close this bypass for new profiles while preserving
  existing approved history. Public projection SQL authority lives in0054 and0061.
- Existing tags: canonical164 hashtags_db entries,8-per-page toggle,20 confirmed max;
  no recommender/custom moderation/export. Never replace taxonomy with fake six tags.
- Existing document input is unstructured proposal/manual text parser; rich input
  needs shared typed proposal with only missing-field merge and explicit full preview.
- Existing API ingress allowlist in apps/api/src/expert-card-telegram-ingress.ts only
  card/card_answers/card_correct/card_document/card_submit/promo_proof/my_tariff/
  main_tariff/main_accept/main_invoice/tags. New commands require actual ingress proof.
- Current generic application materials enqueue at verified fee and worker delivers
  before review. Latest flow supersedes this: profile-specific material after manager
  approval. Existing legacy jobs/ambiguous receipts must be retained, never resent as
  if new. Preserve exact missing-template message and AWAITING_MATERIALS.
- readDraft/listDrafts/admin routes/client/view form existing manager UI; add bounded
  profile/service diff and return reason there, no Kanban redesign.

S3 rich implementation acceptance should include actual owner and staff ingress,
3 input modes, still-empty field proposals,3 distinct photo refs, detailed bio and
service description>=50, service results/indications/expiry/informational prices,
static online URL and offline instructions/map, complete revision-bound preview,
manager review+version diff, pending update keeps old public data, safety revision
fences, consent/deletion coverage, post-approval material flow and raw SQL bypasses.
Keep financial paid-lock/current visibility authority unchanged.
S3 semantic optimization can follow inside same block using concrete local model,
not dummy embeddings: exact/synonym100, semantic50 strictlycosine>.85, top15,
max20confirmed, no network inference or paidLLM, model/cache pinning and warm<500ms
measured. No request to owner required for routine model selection.
S4 schedule/lifecycle follows S3, canonical booking reuse, not a second slot ledger.
