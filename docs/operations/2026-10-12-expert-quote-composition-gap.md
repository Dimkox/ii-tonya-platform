# Expert quote composition gap — 2026-10-12

Scope: current codex/planerka-api checkout, baseline690797db plus uncommitted
calendar work. Read-only inspection; no billing, provider or production mutation.

## Current correction —2026-10-12

The historical absence-of-storage statements below describe earlier inspection,
not the current candidate. Immutable anchor/quote storage now exists with
67/67 focused PG checks, and strict transport schemas with48/48. Quote-bound
checkout and campaign settlement dispatch are in implementation under
`docs/superpowers/implementation-artifacts/spec-expert-campaign-checkout.md`.
No promo/API/provider activation or deployed price protection is established.
Keep the historical findings as provenance, not a reason to rebuild quote storage.

## Next runtime dependency — authenticated expert entry

Current direct source inspection after checkout handoff:

- `apps/api/src/routes/expert-referral.ts` still accepts tariffVersionId for both
  quotes and checkout. It does not consume the strict saved-quote transport schema.
- `apps/api/src/app.ts` registers these routes only with expertApi dependencies;
  enabled referral/residency flags without expertApi fail startup.
- `apps/api/src/server.ts` does not construct expertApi. A new application port
  alone would therefore repeat the existing composition gap.
- `apps/api/src/expert-principal-resolver.ts` defines an opaque bearer lookup,
  but current findByTokenHash references are the interface and test doubles, not
  a DB-backed session issuer/resolver wired into the server.
- Client-session issuance is explicitly audience ii-tonya-client, proof scope
  client_session:create and token scope client_catalog:read, with a separately
  controlled booking grant. Do not silently reinterpret this read token as
  expert financial authority or accept expert/user IDs from a request body.

The next runtime increment must include a real authenticated entry and trusted
expert-owner resolution, not merely quote/checkout routes with injected mocks.
Choose a reviewed dedicated expert session path or the existing authenticated
Telegram ingress and carry its server-derived identity to quote/checkout. Preserve
the client token's existing audience/scope. API and Telegram may share commands;
neither user-supplied IDs nor AI-produced text authorize an order or balance.

The YooKassa adapter already derives durable operation identity from order plus
command, checks receipt authority and uses its persisted operation idempotency key.
Do not replace it with direct HTTP or treat a newly stored local order as proof
that provider payment creation/receipt contact/reconciliation are wired and ready.

### Default-process Telegram trace

Read-only follow-up confirms a narrower integration option than creating a new
browser session system solely to unblock billing:

- `apps/api/src/routes/telegram-webhook.ts` authenticates the provider secret
  before reading the sender. Its `xr1.` callback path resolves the sender through
  `expertQueries.resolvePrincipal`, claims the durable inbox, then calls
  `processResidencyCheckout`. Callback delivery and financial mutation are separate.
- `PostgresExpertTelegramResidencyCallbackRepository` already binds callback
  claims to an active, verified expert, active owner and that owner's Telegram
  channel identity. It currently binds **tariffVersionId**, not the saved campaign
  quote. Do not reuse that binding as evidence of quote-bound price acceptance.
- `server.ts:createDefaultLifecycle` builds this ingress only when the optional
  `expertTelegramComposition` is supplied. The executable `main()` calls
  `createDefaultLifecycle()` without that option. A search of non-test API source
  found no other caller supplying it. Existing factory tests therefore do not
  establish a working default production entry.

For the next implementation, reuse the authenticated Telegram ingress rather
than silently promoting a client session to financial authority. Complete its
default-process dependencies and durable quote-bound callback contract together.
That does not close the separate browser-account requirement: any expert web
entry still needs its own explicit authorization contract. Verify the ordinary
server entrypoint, not only an injected factory. This is a source-supported
integration direction, not activation, deployed evidence or a claim that an
external process cannot use custom composition.

Do not read that direction as a Telegram-only activation shortcut:
`app.ts` rejects enabled `expertReferral` or `expertResidencyBilling` without
`expertApi`, independently of the Telegram ingress. The real composition must
therefore supply both interfaces and real expert authorization. Retain this
startup guard. A dummy bearer resolver which always denies, client-token
promotion, or flag-dependent bypass would leave the required browser/API path
unimplemented. The existing receipt-contact authority also reads encrypted,
consent-bound expert contacts; neither Telegram identity nor the owner's email
is a substitute for the paying expert's receipt contact.

## Arithmetic progress — 2026-10-12,18:43UTC

The domain now exports `calculateExpertCampaignPrice`;37 focused cases passed
after independent source review. Evidence:
`docs/test-evidence/expert-campaign-price-2026-10-12.md`.
This closes only the explicit arithmetic subtask: integer discounts, exact stages,
rounding, monthly floor and term multiplier. The following runtime composition
findings remain true: no persisted campaign anchor/quote or quote-bound checkout
exists yet. The helper must not be advertised as an active billing policy.

## Verified source behavior

`packages/db/src/repositories/test-expert-pricing-policy.ts`:
PostgresExpertTrialPricingPolicy.quote validates tariffKey (default BASE), selects
one currently active expert_residency_v2 row, and returns its price_minor unchanged.
No calculation timestamp, Energy stage, Start term or final floor is computed here.
Partner pricing uses a separate calculator; it is not authority for expert pricing.

`packages/contracts/src/expert-residency-tariffs.ts` retains the fixed V2 base
prices START390000, BASE590000 and PRO999000 minor RUB. The base policy document
also explicitly says campaign runtime composition is unverified. Base pricing
must not be confused with the new discounted quote result.

DEC-FIN-010 already accepts Energy stages [0,72h), [72,144h), [144,216h), then
full price, from calculation_timestamp. Update4 repeats40/30/20percent; this is
not a fresh owner conflict. DEC-FIN-011 owner clarification requires a final
500000minor RUB floor after all applicable discounts. Client4999RUB products and
historical paid expert snapshots are not targets of this clarification.

## Required implementation and proof

1. Reconcile exact applicability of Start versus tariff key START; do not conflate
   a campaign term with the fixed tariff name or infer campaign inputs from prompts.
2. Use a server-owned calculation timestamp and versioned quote snapshot. Define
   repeated calculation behavior from the accepted decision, not a resettable
   caller timestamp. Apply integer money arithmetic and explicit rounding.
3. Compute applicable Energy/Start discounts before final floor; retain breakdown
   and rule version. Do not mutate fixed historical tariff snapshots or bypass SQL
   tariff-combination constraints by rewriting their price in place.
4. Bind promo display, checkout/order and settlement to the same immutable quote.
   A display-only clamp is not completion. Revalidate expiry without changing an
   already accepted paid snapshot.
5. Test exact stage boundaries,5000minus15percent=5000final, valid term combinations,
   restart/replay, stale quotes, unauthorized timestamp/price input and historical
   order preservation. Include authenticated API and rendered promo evidence.

No claim is made that a similarly named helper in an old document exists in this
checkout: scoped source searches found no deriveEarlyEnergyStage implementation.
This evidence establishes the current promo quote gap, not every billing path.

## Source clarification — monthly floor and prepaid term

Read directly from `docs/source/ii-tonya-owner-main-2026-09-16.redacted.txt`,
lines8022–8115, and `ii-tonya-owner-offer-05-2026-09-16.txt`, lines123–129:

- The floor is5000RUB **per month**, not per order. A three-month expert
  Start order cannot cost less than15000RUB after all applicable discounts.
- For experts, Start is available during the first two Energy stages only:
  additional15percent before72h,10percent from72h until144h. Later stages
  must reject that term explicitly, not silently convert it to one month.
- The source pseudocode incorrectly ties multiplication by3 to a remaining
  package discount. When floor removes the discount, it returns a monthly
  amount for a requested three-month term. Do not copy this branch: term and
  discount eligibility are separate facts. Persist the chosen term with price.
- Space promotion is different: source specifies a10percent three-month
  supplement only in its first stage. Do not extend the expert15/10 schedule
  to spaces through an unqualified shared helper.
- Rounding, first-calculation persistence, recalculation and quote validity
  still need an explicit implementation contract. No missing helper or planned
  policy document establishes their current runtime behavior.

These are source-derived implementation constraints, not evidence of implemented
checkout, a changed live tariff, or permission to rewrite historical orders.

## Independent runtime trace — Hubble,2026-10-12

Read-only review confirmed that promo and financial quotes are separate paths:

| Path                                                  | Current authority                                           | Missing connection                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| TestExpertTelegramService                             | `policy.quote({segment})`; renders only priceMinor          | No expert, term, quote ID or financial checkout binding                         |
| ExpertResidencyCommands.quote                         | Authenticated expert + tariffVersionId                      | Calculates but does not persist a quote                                         |
| PostgresExpertResidencyRepository.createCheckoutOrder | Rereads tariff, reserves referral credit and persists order | Does not consume the displayed quote                                            |
| ResidencyCheckoutProvider                             | Uses order.cashMinor and order ID                           | Production server does not compose the complete residency service/provider path |
| Verified residency settlement                         | Checks stored cash/currency/deadline; uses saved duration   | Must preserve this snapshot authority when adding campaigns                     |

Relevant sources: `packages/application/src/expert-residency-service.ts`,
`packages/db/src/repositories/expert-residency-repository.ts`,
`packages/db/src/repositories/expert-residency-provider-inbox-repository.ts`,
`packages/integrations/src/yookassa/payment-adapter.ts`,
`apps/api/src/routes/expert-referral.ts`, `apps/api/src/server.ts`.
Telegram checkout and expert AI commands also currently use tariffVersionId,
not a quote ID; both must join the same new quote contract.

Migration0032 constrains V2 orders to390000/590000/999000 and2592000seconds.
A changed application calculator alone cannot create a500000 or three-month
order. Add a separately constrained campaign-order branch by new migration;
never edit historical SQL or weaken old-order invariants. Referral credit is
payment composition: cash+credit=price. The monthly price floor must not become
a new minimum cash requirement that silently removes accepted credit rights.

Review found no campaign anchor, immutable quote, term selection, expiry or
discount breakdown. Remaining design must specify first-calculation event and
scope, non-resettable recalculation, quote validity across stage boundaries,
rounding, applicable tariffs and duration semantics. Button TTL is not price TTL.
The intended integration proof is displayed quote → accepted quote → order →
provider cash amount → settlement, with historical snapshots unchanged.

## Further source findings — immutable quote planning

Independent source trace (Kant) found that expert orders through0046 have a
provider-deadline default trigger but no financial-snapshot immutability trigger.
Client-order protections from0042 do not cover expert orders. Campaign binding
must protect its own financial fields and enforce unique quote consumption.

Current settlement branches explicitly on v1/v2 policy strings. An unhandled new
campaign version could create the first-settlement marker without creating the
V2 reward maturity. The campaign order phase must carry the accepted referral
semantics through settlement and test them, not merely widen TypeScript unions.

Existing order money bound999999999999minor is stricter than signed bigint.
Persisted quotes must fit this bound even though the pure calculator accepts
larger mathematical inputs. Quote totals do not guarantee a cash/credit split;
credit is reserved only at checkout.

Source lines3260/3708/4697 explicitly describe included groups per month. Store
the original monthly entitlement facts; the longer term is not authority to
replace0..3 with a whole-term multiplied limit or silently omit later months.

Persistence plan: `docs/superpowers/plans/2026-10-12-expert-campaign-quotes.md`.
No billing or campaign activation follows from these findings.

## Checkout and settlement follow-up trace — 2026-10-12

Confirmed existing checkout is still tariff-bound, not quote-bound:
`expert-residency-repository.ts:254` accepts tariffVersionId and providerDeadline;
line299 rereads active tariff, line301 reads transaction_timestamp, and line362
inserts the tariff price/duration. Shared campaign request schemas do not alter
this behavior. They must not be presented as runtime price protection yet.

Additional settlement concurrency risk requires a focused reproduction before
the campaign branch is enabled. In
`expert-residency-provider-inbox-repository.ts`, settle locks the individual order
at line166, then computes max(residency_ends_at) at line234 and writes its interval
at line242. The inspected method contains no explicit isolation statement or
expert advisory lock before that aggregate. Later referral/control locks occur
after the interval computation. A wrapper named withSerializableRetry is not
itself evidence of transaction isolation. Migration0018 checks interval length
within each order; the source search did not find a cross-order interval exclusion.
Independent review is checking client defaults, triggers and other mitigations.
This is a source-supported risk, not a reproduced production incident.

Further inspection: `client.ts:createDb` passes only connectionString to Pool,
without a repository-owned isolation default. `message-repository.ts:189–211`
only retries SQLSTATE40001; it never sets transaction isolation. External database
defaults have not been used as proof of safety. The implementation must provide
its own guarantee and prove it with concurrent distinct-order settlement.

Required regression if confirmed: two distinct valid pending orders for the same
expert settle concurrently, both payments settle exactly once, and the two paid
periods are consecutive with their full stored durations. Include existing
unexpired residency and different-order lock ordering; do not only replay the
same provider event. No real payments or existing exhausted-suite reruns.

The same method reads transaction_timestamp after waiting on the order lock
(line191). Resolve processing-time versus verified provider-paid-time policy
before altering deadline logic; do not silently substitute one for the other.

Group allowance trace is also pending: application references found so far copy
or display groupEventLimit, not enforce monthly use. A separate reviewer is
tracing actual event publication and SQL before treating absence as established.
