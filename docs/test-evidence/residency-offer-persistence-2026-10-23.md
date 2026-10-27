# Residency offer corrections: additive persistence

This is local synthetic PostgreSQL17.5 evidence for the approved
[correction specification](../superpowers/implementation-artifacts/spec-residency-offer-corrections.md).
No provider request, push, deployment or production activation is part of this work.

The hand-authored `0056_residency_offer_corrections.sql` preserves the literal v1
arithmetic, immutable historical quotes and accepted order snapshots. Its v2 quote
path stores structured qualification revisions, carries the earliest existing
first-offer anchor, independently stores monthly/package results and caps expiry
at the current discount stage or approved tariff validity. The separately named
24-hour operational TTL applies after240hours. Space tariffs require a separate
fresh-manager approval record; no partner fixture supplies a rate.

Current v2 payment authority is `expert_campaign_current_profile_valid(user,quote)`:
the owned quote must bind the latest qualification revision and that exact
revision's manager verification. Historical v1 quotes retain their existing
financial contract. Schedule-derived authorizations name their original explicit acceptance
and the latest real owner selection; they do not create Telegram request evidence.
The schedule source trigger checks the original request digest, bot scope, current
card, consent and original selected quote. Application/card erasure nulls live
schedule references and delivery targets while preserving the financial audit.

An append-only activation-admission fact separates verified financial settlement
from permission to publish or restore access. New facts require the canonical
processing provider event, exact stored mode/money/owner binding and current main
gates. A legitimate admitted prepaid future interval retains that fact even when
it cannot publish immediately. Later profile changes do not revoke a previously
admitted paid period. Historical v1 backfill requires exact immutable accepted
main-order/review/public-digest provenance, a canonical processed provider event
matching stored mode/money, and verification/settlement before the original
payment deadline. It preserves legitimate disconnected or future prepaid periods
without requiring an existing published projection. Unproven financial-only
settlements remain fail-closed. Existing paid
orders and provider facts are not rewritten.

The migration also supplies application-bound generic materials and proof facts,
manager Telegram pairing/callback/notification state, personal-offer refresh and
unique notification state, and an identity-free `Ready to send` log relation.
Application materials require the exact canonical receipt shape before
`delivered`; absent content remains `waiting_content`. Proof confirmation checks
paid onboarding, application ownership, current proof digest and fresh manager
authority. The original card-bound delivery path remains valid for historical work.

The supported metadata is reconstructed by replaying the committed SQL on an
isolated PostgreSQL17.5 database, then running `drizzle-kit introspect` into a
fresh temporary output directory. No schema-derived generation was used. The
snapshot is normalized using `migration-state.ts`, including positional composite
foreign keys. New Drizzle declarations also correct introspection's mismatched
composite foreign keys and use bigint for ticket money. The additive SQL-only
catalogue supplement records the affected exact functions/triggers and supported
constraint/index definitions; prior catalogue baselines remain intact.

Verification is coordinated centrally to serialize PostgreSQL work. The initial
persistence invocation failed during setup on a PL/pgSQL CASE-expression syntax
error; it was diagnosed and corrected. The first runnable attempt exposed a
seven-versus-eight input-key validation error. The next attempt exposed a test
fixture whose default tariff expired after24hours and therefore legitimately
capped the final-stage TTL; the fixture now declares two days of tariff validity.
The focused persistence file then passed3/3. An independent review subsequently
found that a global24-hour CHECK incorrectly shortened pre-day10 stage validity;
a focused regression reproduced `EXPERT_CAMPAIGN_STORAGE` before remediation.
Final targeted verification and source digests are recorded below when complete.

| Verification                                                              | Observed result                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/integration/expert-offer-v2.test.ts` initial focused matrix        | 3/3 passed (`residency-offer-v2-green3.log`)                                                                                               |
| Pre-day10 tariff-validity regression, selected case only                  | Expected RED storage rejection, then GREEN1/1 with3 intentionally skipped (`residency-stage-ttl-red.log`, `residency-stage-ttl-green.log`) |
| Final SQL replay and fresh-directory introspection                        | Passed; actual `server_version_num=170005` (`residency-metadata4.log`)                                                                     |
| `pnpm --filter @ii-tonya/db typecheck` after final supported declarations | Passed (`residency-persistence-types-final4.log`)                                                                                          |

Scoped ESLint passed for the owned repository/schema/test files
(`residency-persistence-lint-final.log`), and `git diff --check` passed after the
final supported metadata installation.

The source/snapshot provenance guard binds these exact SHA256 digests:

- `0056_residency_offer_corrections.sql`: `6605ab63ddf5ac31f7b49e5d45c93e96118e731cf9aa1a6c6d287ef1d6f01c1b`
- Parent `0055_snapshot.json`: `d6d7052022a575a9ca297e407a36a993d30e9548ae8034ab96c3e36d8cab758c`
- Normalized `0056_snapshot.json`: `b22ff021153b6a85fce4dad523921edba378be4ca518ffeb8d26c3811c0c5ec5`

The exact affected SQL-only catalogue is
`packages/db/migrations/state/0056_offer_sql_objects.json`; it includes the
append-only activation fact and preapplication cleanup triggers. Cleanup responds
to user deactivation, channel identity revocation/deletion/scope changes and
messaging-consent denial/revocation independently of application creation. It
removes payment URLs/IDs and notification receipts, cancels pending/unknown work
and preserves attempt fences and immutable financial facts. Repository inventories
pin169tables, migration56, and the actual full function/trigger names, including
names containing version digits.

Failed and successful focused logs are retained locally under
`.superpowers/sdd/residency-offer-corrections/`. Final workspace checks, the
remaining focused admission/erasure cases, independent review and the clean
branch gate belong to the coordinator evidence. Historical-populated backfill
acceptance is not claimed from an empty-database metadata replay alone.
