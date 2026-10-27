# Residency correction exact guard registration

Authority: the frozen [correction contract](../superpowers/implementation-artifacts/spec-residency-offer-corrections.md).
This local increment grants no provider activation, deployment or automatic charge.

Fourteen explicitly reviewed relations enter the independent residency and database
inventories. They implement qualification facts, preserved owner selection,
application-bound delivery/proof, trusted staff transport, owned offer projections
and immutable activation admission:

- `expert_application_material_jobs`
- `expert_application_promo_confirmations`
- `expert_application_promo_proofs`
- `expert_main_activation_admissions`
- `expert_manager_telegram_callbacks`
- `expert_manager_telegram_notifications`
- `expert_manager_telegram_pairings`
- `expert_offer_profile_verifications`
- `expert_offer_profiles`
- `expert_offer_schedules`
- `expert_personal_offer_notices`
- `expert_personal_offer_state`
- `expert_promo_ready_logs`
- `expert_space_tariff_approvals`

Migration0056, snapshot56 and its exact SQL catalogue supplement are pinned by
individual content hashes. The journal hash changes only for its contiguous56
entry. PostgreSQL17.5 replay/introspection and the independent169-table inventory
remain required; earlier SQL/snapshot pins and historical gaps are unchanged.

Three exact transport routes are registered: staff profile verification, one-time
trusted staff pairing, and the signed manager bot webhook. The route classifier
now also inspects expert Telegram webhooks, so an unreviewed manager suffix or
lookalike is rejected. Public profile input cannot supply a user identity or price.

The integrations barrel adds the bounded manager notification transport export;
its hash is updated after semantic review. Existing verifier authority import and
export guards remain unchanged. It grants no payment verification primitive.

The first whole repository run exposed two changed-content pins and the protected
profile route. Staging the new files before the tracked-source recursive check
then exposed the exact new relation/artifact/pairing inventory. Registration adds
only those reviewed names and hashes. Existing negative probes are retained; new
probes reject changed artifact bytes, route suffixes and relation/migration
lookalikes. No executable path is excluded and no broad source allowlist is added.
