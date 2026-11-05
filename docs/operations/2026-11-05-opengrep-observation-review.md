# OpenGrep observation review update — 2026-11-05

Agent security review on PR #148 (branch `codex/scrum-518-pilot-checkout`).
This is not human approval and not a finding-free scanner result. It extends
`2026-11-04-opengrep-observation-review.md`. Unchanged records keep their prior
rationale and evidence pointers.

## Inputs

- Head commit before this review: `cbf83a770d1ca254786f31c516f1bd7835ad4841`.
- Engine: Getzilla 2.3.1, `opengrep` binary SHA256
  `d3195b9d8d5ae93179f6aa5f5daaba6a920a5a09d38c5d5ae5e60924050210c4`.
- Raw scan: return code 1, empty stderr, 128 unique findings (was 126 on main).
- Manifest: `engineering/opengrep-reviewed-observations.json`, 128 entries.

## Why the manifest was stale

PR #148 registers the payments-pilot routes in `apps/api/src/app.ts`. That
shifted the three already-reviewed admin JSON proxy sinks and changed the file
hash, so classify failed with `stale source` before matching findings. The PR
also adds two new Fastify JSON response sinks in `payments-pilot.ts`.

## Reviewed changes

| Path:line                            | Rule suffix     | Category             | Reviewed behavior                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app.ts:877,899,921`    | `reflected-xss` | `json-or-cli-output` | Same admin JSON proxy sinks as the 2026-11-04 records at 859/881/903 (`reply.send(response.rawPayload)` with copied JSON headers). Line shift only; no new taint path.                                                                                           |
| `apps/api/src/payments-pilot.ts:168` | `reflected-xss` | `json-or-cli-output` | `reply.code(201).send({ paymentId, confirmationUrl, amountRub })`. Fastify serializes a plain object as JSON, not HTML. Fields are provider UUID, provider confirmation URL, and `formatRubMinor` of the capped pilot amount after `assertPaymentsPilotAllowed`. |
| `apps/api/src/payments-pilot.ts:195` | `reflected-xss` | `json-or-cli-output` | `reply.send({ paymentId, status, amountRub })` on the owner-only refresh route. JSON body from the ledger/provider refresh; not an HTML sink.                                                                                                                    |

## Decision and limits

No exploitable HTML reflection was found in these five records. No code change
was required for the sinks themselves; only the reviewed-observation manifest
and this evidence note. Local verification: sha-pinned engine plus `classify()`
returns `128 reviewed observations; raw scanner status=fail; 0 unresolved`.
Any new finding, changed file hash, or changed rule/path/line stays failing
until separately reviewed. No rules, ignores, or inline suppressions changed.

## 2026-11-05 follow-up: merged line shift

After #148 merged, the two `payments-pilot.ts` sinks moved by six lines (162 to 168, 189 to 195). The code at each line is the same Fastify JSON reply reviewed above. Only the line numbers changed.
