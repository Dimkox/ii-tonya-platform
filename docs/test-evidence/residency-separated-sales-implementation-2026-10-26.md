# Separated residency sales implementation evidence

Branch: `codex/separated-residency-sales-20261026`. Implementer baseline:
`5d08d835514c257ec6897fdb86a7c55d07676799`. Scope is the frozen
`docs/superpowers/implementation-artifacts/spec-residency-separated-sales.md`;
its non-frozen execution notes record the owner period and approval clarifications.
No live service, deployment, provider activation or real money operation was used.
Independent review and the final exact-commit coordinator gate remain separate.

## Result and authority

New v3 owner choices now flow through the real private Telegram webhook: immutable
base-only price, explicit positive response, separate promotion/base choice, explicit
period, the existing role-aware submitted form, actual fresh-MFA manager approval,
and a fixed 300000-minor onboarding invoice. Base refusal is monthly only. The base
floor is displayed before acceptance. Silence, objections, stale/foreign callbacks,
replay conflicts and day10 never authorize promotion, an invoice or access.

Migration 0059 adds immutable base/choice/selection/attempt/paid facts and the canonical
`resident_sales_application` projection of the existing form. The first paid winner
locks the exact selected total and period; main invoice, automatic renewal bill and
explicit renewal invoice use it even after the source tariff closes. Work-bot tariff
readout describes only that paid selection. Card, promo, main payment and publication
gates remain independent. Profile updates do not rewrite the first offered price.

The separate default-off held adapter persists exact encrypted receipt requests and
idempotency before disclosure. Supported bank cards use `capture:false`; actual GET
observations bind object, amount, mode and metadata before capture or cancellation.
Body bytes and read lifetime are bounded. First-send authority is checked after
asynchronous decryption/GET preparation under the subject barrier. Unknown POSTs
are never blindly replayed. The composed worker reconciles known objects, refreshes
finite checkouts/stages, and sends scoped reminders/new links when authorized.
Original quality approval remains valid for an unchanged frozen form after an
explicit monthly replacement; no second manager decision is invented.

Every proven success is retained. Expired, duplicate, erased or unproven-capture
success produces recovery work. Concurrent genuine captures yield one lock.
Form-only erasure was reproduced RED and fixed: delayed captured money cannot
readmit someone whose submitted form was deleted. Routing, request metadata,
notice receipts and encrypted receipt request bodies are scrubbed; necessary
opaque issued financial facts remain. The original form/document cleanup is reused.

## Executed verification

All listed test results are full-file runs except the explicitly labelled RED
form-erasure reproduction. No multi-file or full-suite Vitest run was used.

| Check                                                                                                                                                    | Result     | Raw file stem                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| Base/window/floor arithmetic                                                                                                                             | 10 passed  | domain-final                                         |
| Held request shapes, overflow cancellation and sanitized stream failures                                                                                 | 4 passed   | held-final                                           |
| Actual private ingress/form/manager fee, composed payment webhook, initial main, automatic and explicit renewal with retired tariff                      | 4 passed   | composition-final2                                   |
| State, privacy, checkout expiry, unknown create, reminders, original approval reuse, delayed capture and concurrent winner; actual worker reconciliation | 16 passed  | state-release-candidate                              |
| Existing v2 financial behavior                                                                                                                           | 4 passed   | legacy-offer-v2                                      |
| Existing flag-off form composition                                                                                                                       | 1 passed   | legacy-form-composition                              |
| Configuration, including strict new default-off dependencies                                                                                             | 25 passed  | config-env-final                                     |
| Existing personal offer application behavior                                                                                                             | 9 passed   | personal-offer-service                               |
| Exact new artifacts/provider origin/path/credential/relation negatives                                                                                   | 7 passed   | boundary-release-candidate                           |
| Contiguous journal, snapshots, exact hand SQL objects and declared tables                                                                                | 9 passed   | migration-history2                                   |
| Full tracked scope classifier                                                                                                                            | 130 passed | scope-boundary1                                      |
| API, actual worker, DB and tests typechecks                                                                                                              | exit 0     | *-types-final / tests-types-release-candidate        |
| Integration/application/database builds                                                                                                                  | exit 0     | integrations-final2 / application-final2 / db-final4 |
| Changed-file lint                                                                                                                                        | exit 0     | lint-release-candidate                               |

The normal payment GET fixture uses stable provider timestamps across deliveries.
The paid-cycle renewal test advances only the calendar fixture by 84 days while
preserving the full 90-day duration and production triggers. Campaign-window tests
explicitly suspend and restore only named immutable-clock triggers to arrange past
time; all tested transitions run with guards enabled. These are synthetic local
transport and isolated database checks, not live-provider evidence.

The PostgreSQL 17.5 replay used the existing loopback55483 task cluster, sequential
isolated temporary databases, and no extra cluster. Credentials came only from the
protected compose file in memory and were not printed. The full reconstructed state
contains 188 tables,101 functions,155 triggers,1285 constraints,487 indexes and two
extensions. The snapshot includes the canonical application view. The complete
input/state hashes are in `packages/db/migrations/state/0059_manifest.json`.

Raw selected RED/GREEN/build/type output is preserved byte-for-byte before an
explicit archival end marker under
`docs/test-evidence/residency-separated-sales-2026-10-26/raw/`; their file and original-capture lengths/digests are in
`raw-manifest.json` beside that directory. All intermediate failures additionally
remain in `.superpowers/sdd/separated-sales-20261026/`. The initial worker filter
matched no project and is explicitly excluded from typecheck evidence. An existing
configuration expectation omitted two existing false flags; the correction keeps
both strict false assertions. Failed attempts were retained, not relabelled green.

## Remaining release work

Independent adversarial review, final exact-commit repository gate and any push/PR
are coordinator-owned. All integrations and prompts remain inactive/default-off.
Actual provider capability and merchant activation still require separate review.
An ambiguous create without an object identity cannot be retried or recovered by
inventing an ID: operator-supplied authoritative identity is needed for GET recovery.
No automatic refunds are implemented; recovery work requests refund review.
