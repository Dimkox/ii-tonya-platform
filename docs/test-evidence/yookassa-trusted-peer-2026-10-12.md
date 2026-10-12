# YooKassa trusted peer — 2026-10-12

## Final coordinator verification

Euclid accepted the helper and scoped tests with no concrete finding. Coordinator
final3 session58443 at22:42:19 UTC passed52/52, exit0,1.23s. File budget3/3
exhausted. This verifies local parsing/route admission, not ordinary server wiring,
live nginx configuration, provider verification or publication. No provider calls.

Baseline: `690797db64fd80aa1aeccea8003543de470d8c16` on `codex/planerka-api`.
Spec: `docs/superpowers/implementation-artifacts/spec-yookassa-trusted-peer.md`.
Context frontmatter is empty. Scope is the helper, adjacent test and this evidence.
Development preflight passed: Node 24.21.0, pnpm 11.9.0, no failures/warnings.

## Execution ledger

- RED1 allocated: `pnpm exec vitest run apps/api/src/yookassa-peer.test.ts`.
  Tests precede implementation; initial compilable helper denies every request.
- RED1 result: 22:40:26 UTC, session92181, exit1; 13 failed / 39 passed (52).
  Failures were expected empty-string/403 denials for valid local proxy inputs;
  collection succeeded. Duration 1.32s.
- GREEN2: same focused command, 22:40:45 UTC, session70470, exit0;
  52/52 passed, duration 1.18s. Two of three executions consumed.
  Coordinator execution3 reserved after independent review; do not rerun here.

## Static verification

Coordinator reported workspace build78592 exit0 before these checks began.
That earlier build is not evidence for this helper. Sequential verification in
session3972 finished exit0 with no diagnostics:

- `pnpm --filter @ii-tonya/api typecheck`
- `pnpm exec tsc --noEmit -p tsconfig.tests.json`
- `pnpm exec eslint apps/api/src/yookassa-peer.ts apps/api/src/yookassa-peer.test.ts`
- `pnpm exec prettier --check apps/api/src/yookassa-peer.ts apps/api/src/yookassa-peer.test.ts docs/test-evidence/yookassa-trusted-peer-2026-10-12.md`
- `git diff --check`

## Implementation and handoff

`effectivePeerAddress(FastifyRequest)` validates only the immediate socket against
127.0.0.1/::1 after strict node:net validation and mapped IPv6 normalization.
It counts case-insensitive raw X-Real-IP occurrences, rejects malformed pairings,
duplicate/missing/array values and invalid IP syntax, and returns an empty string
on denial. IPv6 normalization uses node:net SocketAddress. Forwarding headers and
Fastify ip/ips are never authority. Existing allowlist and verification are unchanged.

The 52 tests cover socket spoofing, aliases, mapped addresses, IP syntax, duplicate
raw headers concealed by normalized headers, malformed pairs and real Fastify
route admission. Denied routes return403 with zero dependency calls. Accepted
routes reach claim/verify/complete; verification returns null deliberately, so
these tests do not claim provider verification or settlement evidence.

Stable handoff: only the three assigned files were changed by this implementer.
Independent adversarial review and coordinator execution3 remain pending; nested
agents are forbidden by the governing spec. No spec/status/sprint edits were made.
No old tests, full suite, provider calls, remote operations, commit, push or activation.
Ordinary server composition remains downstream. Local processes are inside the
explicit nginx trust boundary; this helper does not authenticate them or replace
authoritative provider GET verification. No production payment-flow claim.
Owner clarification: unpaid external API subscriptions are not a review-release
blocker; no payment states were relabelled.
