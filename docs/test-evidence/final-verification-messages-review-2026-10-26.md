# Final verification/messages independent review

Reviewed clean977c1b659e4ee101ac9af6a0126f058c66ad106d; implementation
27d4851c73aebd79b3c59040194f92f0a9d33509; baseline53df4d2f.
Three fresh context-free read-only reviewers were launched together. No reviewer
edited source, ran tests or contacted providers. Root inspected the cited source
after all three reports returned. Six concrete findings are accepted below; no
quota, destructive re-derivation or unrelated re-review is required.

| ID  | Severity / routing | Exact issue and required correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | high / bad_spec    | `expert-verification-repository.ts:152` omits rejected and most approved applications from the only browsable queue. `expert-verification-view.ts:236` recovery is available only in an opened detail. After terminal decision, ambiguous delivery and browser reload, the operator cannot reach recovery. Make terminal pending/ambiguous deliveries discoverable through the real protected interface, with bounded reads and no blind resend.                                                           |
| R2  | high / bad_spec    | `expert-verification-repository.ts:215` aggregates all historical answers/requests/messages; `resident-verification-repository.ts:324` accepts unbounded individually valid followups.100 answers of2900characters exceed the existing262144-character client envelope (`expert-verification-client.ts:164`), making a legitimate application unreviewable. Bound/paginate history end-to-end and preserve access to already accepted data; do not merely enlarge the client ceiling or silently truncate. |
| R3  | high / bad_spec    | `resident-review-repository.ts:261–275` expires globally selected requests in one transaction. A blocked original identity causes the application write guard to reject the status update, rolling back the batch; both manager reads and notification cycles invoke this routine. Isolate/skip ineligible subjects without weakening identity authority or starving valid due work. Test a blocked due subject alongside a valid one.                                                                     |
| R4  | high / patch       | `expert-verification-view.ts:354–379` invalidates a preview on editor change, but an earlier asynchronous response can restore it because only page generation is compared. Fence responses against the exact editor request/revision (or disable and correctly restore editor inputs); no obsolete action/question/tone may become confirmable. Exercise an actually delayed browser response with an intervening edit.                                                                                   |
| R5  | medium / bad_spec  | `resident-verification-v2.test.ts:378` proves independent SQL interval arithmetic, while line536 overwrites the actual event deadline. A production trigger changed to30days would survive those behavioral tests. Assert the genuine confirmed deadline; exercise month-end/leap/exact-boundary through production calculation/eligibility consumed by the real flow, without adding a production clock override.                                                                                         |
| R6  | medium / bad_spec  | `/answers_done` and `/reapply` service dispatch (`resident-verification-service.ts:458,650`) is not exercised: repository tests call mutations directly. Send both advertised commands through the actual applicant service/ingress with PostgreSQL and verify request identity, renewed generation/current attempt and preserved financial history.                                                                                                                                                       |

The blind reviewer suppliedR1/R2, edge reviewerR3/R4, verification-gap reviewerR5/R6.
The edge report's `guard_snippet` values describe proposed guards, not existing code;
root verified the actual missing guards directly. The current code already uses
calendar months;R5 is a real verification gap, not a claim of a known wrong deadline.
The existing tests' filtered counts and retained failures remain honestly recorded.

Root routes the corrections as one bounded batch to the original implementer. Keep
all passing versioned forms, immutable financial source, fixed fee/capture authority,
exact message bytes, privacy cleanup, unknown-send quarantine, source templates and
default-off composition. Reviewers will subsequently check only assigned closure
claims at the corrective SHA. Canonical gate and push remain pending.
