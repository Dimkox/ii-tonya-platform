# Expert campaign arithmetic evidence

Scope: new pure `calculateExpertCampaignPrice` domain function and barrel export.
Not a persisted quote, authenticated offer, order, provider amount or settlement.
No historical tariff/order or live configuration changed.

The calculation implements accepted Energy40/30/20percent exact72/144/216-hour
boundaries, expert three-month Start15/10percent before144hours, and the owner's
final5000RUB-per-month floor. Three-month totals remain at least15000RUB even
when the floor eliminates the discount. Late three-month requests reject.

Explicit engineering rules: bigint minor units, a single half-up rounding after
both factors, monthly floor after rounding,30-day duration units, signed-bigint
output bounds. Anchor persistence and financial authority are not supplied by the
caller merely because this helper validates input types/timestamps.

Focused command: `pnpm exec vitest run packages/domain/src/expert-campaign-price.test.ts`.

| Run | UTC start | Result |
| --- | --- | --- |
| 1 | 2026-10-12 18:40:34 | Collection failed: `%j` test name tried to serialize bigint;0 tests |
| 2 | 2026-10-12 18:40:55 | Behavioral RED35/35 against compileable unavailable scaffold |
| 3 | 2026-10-12 18:43:05 | GREEN37/37,560ms total |

McClintock independently source-reviewed calculation, arithmetic, bounds and
scope. No implementation defects found. Added the requested exact-floor rounding
boundary cases before run3:980391→499999→500000 and980392→500000 without floor
adjustment. Other coverage includes all millisecond stage boundaries, wrong term,
floor-multiplier preservation, intermediate-rounding regression, half-kopeck tie,
bigint overflow/precision, malformed timestamps and immutable output.

Domain typecheck and initial two-file lint passed; shared test typecheck passed
before the final two assertions. Final domain ESM/DTS build, three-file lint
including the barrel and diff check passed (session77283 exit0). No full/multi-path test suite was run. This new logical file has
used its planned three invocations; do not casually rerun it.

Required next: persist immutable quote and first-calculation anchor, bind rendered
promo and authenticated acceptance to quote identity, add constrained campaign
orders, conserve cash+credit and verify provider/settlement against the same
snapshot. No claim of commercial release or human acceptance.
