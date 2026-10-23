# Block A PostgreSQL storage evidence

Source baseline: `8b41802cd0156f8596fbf0e1ba67890f2ed969f2`.
Local implementation evidence only; no release/provider acceptance.

## Contract and authority

Migration0052 adds reusable `promo_` codes with128-bit randomness in a namespace
separate from qualified referral codes and client coupons. Registrations bind a
Telegram identity digest globally across bots and keep an immutable UUID owner /
inviter. Two unique active registrations create one waiting-content guide work
item and one100-point frozen indication; registration writes no financial ledger.
The indication is suppressed in reads once a100000-kopeck qualified reward grant
exists for the inviter, so it cannot be presented as another100+1000 reward.

The PostgreSQL repository re-resolves exact private Telegram identity and original
current messaging evidence under the existing consent barrier for every active
command. Stable bot ID / update request keys share a durable operation/digest fence
across registration, tariff listing, quote and application. Quote creation reuses
the existing campaign engine inside the same transaction. Application creation
checks owner, term and actual database expiry and creates ID-only manager work.

Unknown entry creates minimal unresolved enrollment with an immutable first promo
candidate. No attribution, guide or indication exists before explicit redemption
of a scoped approved consent presentation. No approved copy returns an inactive
slot. Pending windows refresh after24hours without changing the first candidate.
Only token digests are persisted; exact replay acknowledges without minting a new
token. Blocked/ambiguous mappings are never merged or revived.

## Erasure disposition

`PostgresPrivacyRepository.startErasureAtomically` removes promo queues, indications,
codes and enrollment before identity deletion. Registration digests are cleared;
only inactive UUID ownership / inviter tombstones remain, preventing reassignment
of existing accounts. Accepted bot/update receipts lose user ID and request digest,
retaining a PII-minimal replay tombstone so a redelivered old update cannot create
a replacement account. A fresh explicit update may start a new enrollment. Guide
work cannot report delivery without a nonempty actual receipt; no sender or PDF is
fabricated. Inviter user/code share locks serialize qualification with erasure.

## Verification and bounded invocation ledger

- Environment preflight, including RequireDocker: PASS (Node24.22.0, pnpm11.9.0,
  Docker29.9.2, Compose5.6.1).
- Owned Compose project: `ii-tonya-phase1-promo-20261023`, PostgreSQL17.5-bookworm.
  No shared/customer database or provider request used.
- New `tests/integration/phase1-promo.test.ts` RED1: missing repository, as expected;
  `/tmp/phase1-promo-red1.log`.
- GREEN2:11/15 passed. Four fixture failures preserved in
  `/tmp/phase1-promo-green2.log`: invalid `withdrawn` projection literal, two attempts
  to retire append-only legal documents, and an incorrect expected tariff label.
  Corrected with `revoked`, fresh isolated content databases and canonical approved
  document insertion, and authoritative `Про` respectively. No guard was weakened.
- Final3 CONSUMED at14:32:01UTC:14/15 passed. The new expired-quote fixture
  failed PostgreSQL42P18 on an untyped `jsonb_build_object` idempotency-key parameter;
  `/tmp/phase1-promo-final3.log`. Lead added explicit `::text`; independent reviewer
  accepted the correction and found no other inference gaps. Corrected fixture is
  UNRUN. All3 slots consumed; a fourth invocation requires explicit owner authority.
- DB build (ESM+DTS), DB typecheck, owned scoped ESLint/Prettier and whitespace:
  PASS. Final post-review aggregate evidence belongs to the lead.
- Migration snapshot/catalogue/manifest reconstruction is owned independently by
  the Block A inventory reviewer; no schema-derived generation was used.

The new focused file covers unknown enrollment/current consent, first-candidate
retention and refresh, private/cross-bot ownership, cross-user replay, denied replay,
concurrent qualification, no financial grant or fabricated PDF, immutable source
quotes/owner-bound manager handoff (expired-quote rejection is still unverified), forced inviter-inactivation lock wait,
erasure and old-update tombstones. Independent source reviews accepted the corrections. Local implementation acceptance
remains pending the specifically authorized corrected-fixture runtime check.
