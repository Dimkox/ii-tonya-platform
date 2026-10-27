# Rich resident onboarding

Scope: S3a, specification `docs/superpowers/implementation-artifacts/spec-residency-rich-onboarding.md`. This extends the paid interview and existing work bot. It does not enable a provider or change residency prices.

## Resident workflow

`/card_mode` asks Russian questions one at a time. Reply with `/card_answer` followed by the answer; there is no need to enter JSON, a revision, or a service identifier. Valid partial answers remain saved. Services receive server-generated identifiers and exact string RUB amounts. `/card_service_add` starts another service, up to eight. An unfinished service blocks final confirmation.

`/card_checklist` returns a reusable Russian Markdown checklist. Returned labelled text, PDF and DOCX produce proposals. The existing isolated parser reads files retrieved through the original work bot. A proposal never changes the approved profile until the owner has traversed its complete preview and accepted it. Unsupported files retain their raw reference and return the specified manual-entry fallback. Unlabelled prose is not inferred by an LLM.

Upload three distinct photo references to the work bot. The normal composition retrieves original bytes, writes the private object store and verifies custody. An unavailable store preserves the original upload. Allocation without a write may be retried by resending the file; an uncertain write is never treated as verified or automatically restarted. Existing erasure obligations retain uncertain writes for deletion. Do not manually mark photos verified.

`/card_preview` presents every value in Russian, followed by individual selected-photo pages with private two-minute links. Only the current owner may obtain these pages. Every next-page and final confirmation command carries an exact revision and chained token. Send the supplied commands unchanged. Editing invalidates the preview. Final submission still requires three settled private photos, complete logistics, current safety checks and owner confirmation.

`/card_manager` records a deduplicated assistance request in the protected card queue. The queue prioritizes these requests and labels them “Нужна помощь”. It does not claim an external notification was sent. `/card` shows the current review state and exact return reason. Unsolicited owner review-status delivery remains the explicitly assigned S4 integration seam; no new generic send authority is created here.

## Staff review and publication

Use the existing card screen with a current role/session/MFA. It shows complete profile/service pages, previous approval, changed fields, original answers and protected photo links. Links are issued only on click, expire in 120 seconds and remain bearer capabilities until expiry. Switching the selected card or logging out fences late photo responses. Return requires a reason. Manager edits require the owner to preview and confirm again. Current safety warnings require the established acknowledgement.

Approval saves immutable private knowledge. Public search still uses the four-field public summary and existing main settlement, promo, consent and coverage gates. Private contacts, room links and photo capabilities are not added to the public summary. For an already paid resident, pending/rejected edits retain the prior approved visibility and renewal authority; acceptance replaces the reviewed content atomically while preserving payment history. Updates do not restart the acquisition campaign.

Only card approval creates new materials work. Old generic jobs cannot send before approval or suppress a current rich job. Historical delivered receipts and unknown attempts are retained; unknown outcomes are not resent as fresh work. Without an approved template the existing awaiting-materials state says: “Ваши материалы для рассылки будут доступны в ближайшее время”. Staff cannot manufacture delivery or payment.

## Configuration and recovery

All existing card/private-job controls remain explicit. Normal photo and document composition requires the original work-bot token and the already reviewed private-store configuration. PDF/DOCX extraction additionally requires the existing isolated parser socket. Do not run a host parser or introduce a second object store.

Geocoding defaults off. Set `RESIDENT_GEOCODE_ENABLED=true` only with reviewed activation and a non-placeholder server-side `RESIDENT_GEOCODE_API_KEY`. The endpoint is fixed to Yandex Geocoder, bounded to one in-flight request, at most five seconds and 32 KiB output. Only one exact house and finite bounded coordinates produce a map proposal. Failure/ambiguity preserves the address. Owners may supply a corrected HTTPS Yandex Maps link in the checklist without enabling this provider. Keys and addresses must not be logged. Provider contract: <https://yandex.com/maps-api/docs/geocoder-api/request.html>.

Migration0066 is hand-authored and additive. Existing drafts remain legacy until explicitly adopting rich mode; adoption is irreversible. The SQL snapshot and supplement were reconstructed by full-chain replay on isolated PostgreSQL17.5, never by `drizzle-kit generate`. Do not edit older migration bytes. For operational rollback disable new card admission/provider capability and retain existing paid projections and erasure processing; do not drop rich tables or overwrite approved versions.

Private drafts, staged answers, proposals and reviewed versions are removed by the existing erasure transaction. Media deletion leaves the existing subject-bound object-deletion obligations. Already issued signed URLs may remain usable until their short expiry. No new private read or preview is issued after original consent withdrawal.

## Local witnesses

The focused integration file is `tests/integration/resident-rich-onboarding.test.ts`. It uses the existing isolated evidence PostgreSQL17.5 instance through `II_TONYA_TEST_POSTGRES_ADMIN_URL`. The optional actual-parser case requires `II_TONYA_PRIVATE_PARSER_TEST_SOCKET`; its synthetic PDF/DOCX bytes are generated by the committed `tests/support/resident-rich-document-fixtures.ts`. Never put a credential-bearing URL in shell arguments or diagnostics.

The real-browser witness and full-chain introspection driver are retained in the ignored task evidence directory identified by the implementation evidence manifest. Browser fixtures are synthetic. They do not claim a production provider or release test. The coordinator owns independent review, final gate, push and release evidence.
